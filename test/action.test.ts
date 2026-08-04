import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { runMigration } from 'contentful-migration';
import { runAction } from '../src/action';
import { MAX_NUMBER_OF_TRIES } from '../src/constants';
import {
  asSpace,
  cleanupMigrationsDirs,
  makeAlias,
  makeApiKey,
  makeConfig,
  makeMigrationsDir,
  makeSpace,
  makeVersionEntry,
  setMergedPullRequestContext,
  setOpenPullRequestContext,
} from './helpers';

vi.mock('contentful-migration', () => ({ runMigration: vi.fn() }));

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  setOutput: vi.fn(),
}));

/**
 * runAction reuses (and mutates) one options object across every runMigration
 * call, so the recorded call arguments all point at the same object. Capture
 * the file path as each call happens instead.
 */
const recordMigrationRuns = (): string[] => {
  const filePaths: string[] = [];
  vi.mocked(runMigration).mockImplementation(async (options) => {
    filePaths.push((options as { filePath: string }).filePath);
  });
  return filePaths;
};

describe('runAction', () => {
  afterEach(() => {
    cleanupMigrationsDirs();
    vi.useRealTimers();
  });

  describe('running migrations', () => {
    beforeEach(() => {
      setOpenPullRequestContext('feature/x', 'main');
    });

    it('runs every migration after the stored version, in ascending order', async () => {
      const filePaths = recordMigrationRuns();
      const migrationsDir = makeMigrationsDir(['1.js', '2.js', '3.js', '4.js']);
      const space = makeSpace({ entries: [makeVersionEntry('2')] });

      await runAction(asSpace(space), makeConfig({ migrationsDir }));

      expect(filePaths).toEqual([
        path.join(migrationsDir, '3.js'),
        path.join(migrationsDir, '4.js'),
      ]);
    });

    it('sorts semver migrations rather than sorting them as strings', async () => {
      const filePaths = recordMigrationRuns();
      const migrationsDir = makeMigrationsDir([
        '1.js',
        '1.10.100.js',
        '1.1.101.js',
        '2.js',
      ]);
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await runAction(asSpace(space), makeConfig({ migrationsDir }));

      // 1.1.101 sorts before 1.10.100 by semver but after it as a string.
      expect(filePaths).toEqual([
        path.join(migrationsDir, '1.1.101.js'),
        path.join(migrationsDir, '1.10.100.js'),
        path.join(migrationsDir, '2.js'),
      ]);
    });

    it('runs nothing when the stored version is already the latest', async () => {
      const filePaths = recordMigrationRuns();
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const entry = makeVersionEntry('2');
      const space = makeSpace({ entries: [entry] });

      await runAction(asSpace(space), makeConfig({ migrationsDir }));

      expect(filePaths).toEqual([]);
      expect(entry.update).not.toHaveBeenCalled();
    });

    it('passes the space, token and environment to each migration', async () => {
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await runAction(
        asSpace(space),
        makeConfig({
          migrationsDir,
          spaceId: 'the-space',
          managementApiKey: 'the-token',
          featurePattern: 'sandbox-[branch]',
        })
      );

      expect(runMigration).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: 'the-space',
          accessToken: 'the-token',
          environmentId: 'sandbox-feature-x',
          yes: true,
        })
      );
    });

    it('publishes an updated version entry after each migration', async () => {
      recordMigrationRuns();
      const migrationsDir = makeMigrationsDir(['1.js', '2.js', '3.js']);
      const entry = makeVersionEntry('1');
      const space = makeSpace({ entries: [entry] });

      await runAction(asSpace(space), makeConfig({ migrationsDir }));

      expect(entry.update).toHaveBeenCalledTimes(2);
      expect(entry.publish).toHaveBeenCalledTimes(2);
      expect(entry.fields.version['en-US']).toBe('3');
    });

    it('writes back to the configured version field', async () => {
      recordMigrationRuns();
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const entry = makeVersionEntry('1', { field: 'versionCounter' });
      const space = makeSpace({ entries: [entry] });

      await runAction(
        asSpace(space),
        makeConfig({ migrationsDir, versionField: 'versionCounter' })
      );

      expect(entry.fields.versionCounter['en-US']).toBe('2');
      expect(entry.publish).toHaveBeenCalledTimes(1);
    });

    it('reads the stored version using the default locale', async () => {
      const filePaths = recordMigrationRuns();
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const entry = makeVersionEntry('1', { locale: 'de-DE' });
      const space = makeSpace({
        entries: [entry],
        locales: [
          { code: 'en-US', default: false },
          { code: 'de-DE', default: true },
        ],
      });

      await runAction(asSpace(space), makeConfig({ migrationsDir }));

      expect(filePaths).toEqual([path.join(migrationsDir, '2.js')]);
      expect(entry.fields.version['de-DE']).toBe('2');
    });

    it('queries the configured version content type', async () => {
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await runAction(
        asSpace(space),
        makeConfig({ migrationsDir, versionContentType: 'environmentVersion' })
      );

      const environment = space.environments.get('GH-feature-x');
      expect(environment.getEntries).toHaveBeenCalledWith({
        content_type: 'environmentVersion',
      });
    });
  });

  describe('version entry validation', () => {
    beforeEach(() => {
      setOpenPullRequestContext('feature/x', 'main');
    });

    it('throws when there is no version entry', async () => {
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({ entries: [] });

      await expect(
        runAction(
          asSpace(space),
          makeConfig({ migrationsDir, versionContentType: 'versionTracking' })
        )
      ).rejects.toThrowError(
        'Error occured, no entry of type "versionTracking" was found'
      );
    });

    it('throws when there is more than one version entry', async () => {
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({
        entries: [makeVersionEntry('1'), makeVersionEntry('1')],
      });

      await expect(
        runAction(asSpace(space), makeConfig({ migrationsDir }))
      ).rejects.toThrowError(
        'There should only be one entry of type "versionTracking"'
      );
    });

    it('throws when the stored version matches no migration', async () => {
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const space = makeSpace({ entries: [makeVersionEntry('9.9.9')] });

      await expect(
        runAction(asSpace(space), makeConfig({ migrationsDir }))
      ).rejects.toThrowError(
        'Version 9.9.9 is not matching with any known migration'
      );
    });

    it('does not run any migration when the stored version is unknown', async () => {
      const filePaths = recordMigrationRuns();
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const space = makeSpace({ entries: [makeVersionEntry('9.9.9')] });

      await expect(
        runAction(asSpace(space), makeConfig({ migrationsDir }))
      ).rejects.toThrowError();
      expect(filePaths).toEqual([]);
    });
  });

  describe('waiting for the environment', () => {
    beforeEach(() => {
      setOpenPullRequestContext('feature/x', 'main');
      vi.useFakeTimers();
    });

    it('keeps polling until the environment is ready', async () => {
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        statuses: ['queued', 'inProgress', 'ready'],
      });

      const promise = runAction(asSpace(space), makeConfig({ migrationsDir }));
      await vi.runAllTimersAsync();
      await promise;

      // One probe for the pre-create existence check (which rejects, as no
      // environment exists yet) plus one per poll.
      expect(space.getEnvironment).toHaveBeenCalledTimes(1 + 3);
    });

    it('stops polling as soon as creation is reported as failed', async () => {
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        statuses: ['failed'],
      });

      const promise = runAction(asSpace(space), makeConfig({ migrationsDir }));
      await vi.runAllTimersAsync();
      await promise;

      expect(space.getEnvironment).toHaveBeenCalledTimes(1 + 1);
    });

    // Documenting current behaviour: neither a 'failed' status nor exhausting
    // the retries aborts the run. The action carries on and migrates against an
    // environment that never became ready.
    it('gives up after MAX_NUMBER_OF_TRIES and continues anyway', async () => {
      const migrationsDir = makeMigrationsDir(['1.js', '2.js']);
      const filePaths = recordMigrationRuns();
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        statuses: ['inProgress'],
      });

      const promise = runAction(asSpace(space), makeConfig({ migrationsDir }));
      await vi.runAllTimersAsync();
      await promise;

      expect(space.getEnvironment).toHaveBeenCalledTimes(
        1 + MAX_NUMBER_OF_TRIES
      );
      expect(filePaths).toEqual([path.join(migrationsDir, '2.js')]);
    });
  });

  describe('api keys', () => {
    beforeEach(() => {
      setOpenPullRequestContext('feature/x', 'main');
    });

    it('grants every api key access to the new environment', async () => {
      const migrationsDir = makeMigrationsDir(['1.js']);
      const keys = [makeApiKey('key-1'), makeApiKey('key-2')];
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        apiKeys: keys,
      });

      await runAction(
        asSpace(space),
        makeConfig({ migrationsDir, featurePattern: 'sandbox-[branch]' })
      );

      keys.forEach((key) => {
        expect(key.update).toHaveBeenCalled();
        expect(key.environments).toEqual([
          {
            sys: {
              type: 'Link',
              linkType: 'Environment',
              id: 'sandbox-feature-x',
            },
          },
        ]);
      });
    });
  });

  describe('the master alias', () => {
    it('is repointed at the new environment on a merged pull request', async () => {
      setMergedPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const alias = makeAlias('master', 'previous-environment');
      const space = makeSpace({ entries: [makeVersionEntry('1')], alias });

      await runAction(
        asSpace(space),
        makeConfig({
          migrationsDir,
          masterPattern: 'prod-fixed',
          setAlias: true,
        })
      );

      expect(space.getEnvironmentAlias).toHaveBeenCalledWith('master');
      expect(alias.environment.sys.id).toBe('prod-fixed');
      expect(alias.update).toHaveBeenCalled();
    });

    it('is left alone when set_alias is off', async () => {
      setMergedPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await runAction(
        asSpace(space),
        makeConfig({
          migrationsDir,
          masterPattern: 'prod-fixed',
          setAlias: false,
        })
      );

      expect(space.getEnvironmentAlias).not.toHaveBeenCalled();
    });

    it('is left alone on a feature environment even when set_alias is on', async () => {
      setOpenPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await runAction(
        asSpace(space),
        makeConfig({ migrationsDir, setAlias: true })
      );

      expect(space.getEnvironmentAlias).not.toHaveBeenCalled();
    });

    it('does not fail the run when the alias update fails', async () => {
      setMergedPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const alias = makeAlias();
      alias.update.mockRejectedValue(new Error('nope'));
      const space = makeSpace({ entries: [makeVersionEntry('1')], alias });

      await expect(
        runAction(
          asSpace(space),
          makeConfig({
            migrationsDir,
            masterPattern: 'prod-fixed',
            setAlias: true,
          })
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('deleting the feature environment', () => {
    it('deletes it when delete_feature is on and the pull request was merged', async () => {
      setMergedPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        existingIds: ['sandbox-feature-x'],
      });
      const featureEnvironment = space.environments.get('sandbox-feature-x');

      await runAction(
        asSpace(space),
        makeConfig({
          migrationsDir,
          masterPattern: 'prod-fixed',
          featurePattern: 'sandbox-[branch]',
          deleteFeature: true,
        })
      );

      expect(featureEnvironment.delete).toHaveBeenCalled();
    });

    it('leaves it in place when delete_feature is off', async () => {
      setMergedPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        existingIds: ['sandbox-feature-x'],
      });
      const featureEnvironment = space.environments.get('sandbox-feature-x');

      await runAction(
        asSpace(space),
        makeConfig({
          migrationsDir,
          masterPattern: 'prod-fixed',
          featurePattern: 'sandbox-[branch]',
          deleteFeature: false,
        })
      );

      expect(featureEnvironment.delete).not.toHaveBeenCalled();
    });

    it('leaves it in place when the pull request is still open', async () => {
      setOpenPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      // flush_preview_env is off so that the feature environment survives
      // getEnvironment and any later delete would be unambiguous.
      const space = makeSpace({
        entries: [makeVersionEntry('1')],
        existingIds: ['sandbox-feature-x'],
      });
      const featureEnvironment = space.environments.get('sandbox-feature-x');

      await runAction(
        asSpace(space),
        makeConfig({
          migrationsDir,
          featurePattern: 'sandbox-[branch]',
          flushPreviewEnv: false,
          deleteFeature: true,
        })
      );

      expect(featureEnvironment.delete).not.toHaveBeenCalled();
    });

    it('does not fail the run when the environment cannot be deleted', async () => {
      setMergedPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      // No sandbox environment exists, so the lookup rejects.
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await expect(
        runAction(
          asSpace(space),
          makeConfig({
            migrationsDir,
            masterPattern: 'prod-fixed',
            featurePattern: 'sandbox-[branch]',
            deleteFeature: true,
          })
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('outputs', () => {
    it('exposes the environment name and url', async () => {
      setOpenPullRequestContext('feature/x', 'main');
      const migrationsDir = makeMigrationsDir(['1.js']);
      const space = makeSpace({ entries: [makeVersionEntry('1')] });

      await runAction(
        asSpace(space),
        makeConfig({ migrationsDir, featurePattern: 'sandbox-[branch]' })
      );

      expect(core.setOutput).toHaveBeenCalledWith(
        'environment_name',
        'sandbox-feature-x'
      );
      expect(core.setOutput).toHaveBeenCalledWith(
        'environment_url',
        'https://app.contentful.com/spaces/test-space-id/environments/sandbox-feature-x'
      );
    });
  });
});

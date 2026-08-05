import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FEATURE_PATTERN,
  DEFAULT_MASTER_PATTERN,
  DEFAULT_MIGRATIONS_DIR,
  DEFAULT_VERSION_CONTENT_TYPE,
  DEFAULT_VERSION_FIELD,
  getConfig,
} from '../src/constants';

/** @actions/core reads inputs from INPUT_<UPPERCASED_NAME>. */
const setInput = (name: string, value: string): void => {
  vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
};

describe('getConfig', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_WORKSPACE', '/workspace');
    setInput('space_id', 'a-space-id');
    setInput('management_api_key', 'a-management-api-key');
  });

  it('reads the required inputs', () => {
    const config = getConfig();

    expect(config.spaceId).toBe('a-space-id');
    expect(config.managementApiKey).toBe('a-management-api-key');
  });

  it('falls back to the documented defaults when optional inputs are absent', () => {
    const config = getConfig();

    expect(config).toMatchObject({
      versionContentType: DEFAULT_VERSION_CONTENT_TYPE,
      versionField: DEFAULT_VERSION_FIELD,
      featurePattern: DEFAULT_FEATURE_PATTERN,
      masterPattern: DEFAULT_MASTER_PATTERN,
      deleteFeature: false,
      setAlias: false,
      flushPreviewEnv: true,
      migrationsDir: path.join('/workspace', DEFAULT_MIGRATIONS_DIR),
    });
  });

  it('prefers provided optional inputs over the defaults', () => {
    setInput('version_content_type', 'environmentVersion');
    setInput('version_field', 'versionCounter');
    setInput('feature_pattern', 'sandbox-[branch]');
    setInput('master_pattern', 'prod-[YYYY]');
    setInput('migrations_dir', 'contentful/migrations');

    expect(getConfig()).toMatchObject({
      versionContentType: 'environmentVersion',
      versionField: 'versionCounter',
      featurePattern: 'sandbox-[branch]',
      masterPattern: 'prod-[YYYY]',
      migrationsDir: path.join('/workspace', 'contentful/migrations'),
    });
  });

  describe('head_ref', () => {
    it('is null when the input is not supplied', () => {
      expect(getConfig().headRef).toBeNull();
    });

    it('is null when the input is supplied empty', () => {
      setInput('head_ref', '');

      expect(getConfig().headRef).toBeNull();
    });

    it('is used as-is when given a bare branch name', () => {
      setInput('head_ref', 'feature/some-thing');

      expect(getConfig().headRef).toBe('feature/some-thing');
    });

    it('is reduced to a bare branch name when given a full ref', () => {
      setInput('head_ref', 'refs/heads/feature/some-thing');

      expect(getConfig().headRef).toBe('feature/some-thing');
    });

    it('strips only the leading refs/heads/', () => {
      setInput('head_ref', 'refs/heads/feature/refs/heads/x');

      expect(getConfig().headRef).toBe('feature/refs/heads/x');
    });
  });

  it('resolves the migrations directory against GITHUB_WORKSPACE', () => {
    vi.stubEnv('GITHUB_WORKSPACE', '/home/runner/work/repo/repo');
    setInput('migrations_dir', 'test-migrations');

    expect(getConfig().migrationsDir).toBe(
      '/home/runner/work/repo/repo/test-migrations'
    );
  });

  describe('boolean inputs', () => {
    it.each([
      ['true', true],
      ['false', false],
    ])('reads set_alias="%s" as %s', (input, expected) => {
      setInput('set_alias', input);

      expect(getConfig().setAlias).toBe(expected);
    });

    it.each(['', 'yes', 'TRUE', 'nonsense'])(
      'falls back to the default for the unrecognised value "%s"',
      (input) => {
        setInput('set_alias', input);
        setInput('flush_preview_env', input);

        const config = getConfig();

        // set_alias defaults to false, flush_preview_env to true, so this also
        // proves the fallback is per-input and not a blanket false.
        expect(config.setAlias).toBe(false);
        expect(config.flushPreviewEnv).toBe(true);
      }
    );

    it('reads flush_preview_env="false" as false', () => {
      setInput('flush_preview_env', 'false');

      expect(getConfig().flushPreviewEnv).toBe(false);
    });
  });

  describe('failure modes', () => {
    it.each(['space_id', 'management_api_key'])(
      'throws when the required input %s is missing',
      (input) => {
        vi.stubEnv(`INPUT_${input.toUpperCase()}`, '');

        expect(() => getConfig()).toThrowError(
          `Input required and not supplied: ${input}`
        );
      }
    );

    it('throws a descriptive error when GITHUB_WORKSPACE is not set', () => {
      vi.stubEnv('GITHUB_WORKSPACE', undefined);

      expect(() => getConfig()).toThrowError(/GITHUB_WORKSPACE is not set/);
    });
  });
});

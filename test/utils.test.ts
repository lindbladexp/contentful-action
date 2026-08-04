import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  branchNameToEnvironmentName,
  filenameToVersion,
  getBranchNames,
  getEnvironment,
  getNameFromPattern,
  versionToFilename,
} from '../src/utils';
import {
  asSpace,
  makeConfig,
  makeSpace,
  setContext,
  setMergedPullRequestContext,
  setOpenPullRequestContext,
  setPushContext,
} from './helpers';

describe('filenameToVersion', () => {
  it.each([
    ['1.js', '1'],
    ['2.js', '2'],
    ['1.0.1.js', '1.0.1'],
    ['2.0.1-alpha.js', '2.0.1-alpha'],
    ['2.0.1-rc.2.js', '2.0.1-rc.2'],
    ['1.10.102.js', '1.10.102'],
  ])('converts %s to %s', (filename, version) => {
    expect(filenameToVersion(filename)).toBe(version);
  });

  it('only strips a trailing .js', () => {
    expect(filenameToVersion('1.js.0.js')).toBe('1.js.0');
  });
});

describe('versionToFilename', () => {
  it.each([
    ['1', '1.js'],
    ['2', '2.js'],
    ['1.0.1', '1.0.1.js'],
    ['2.0.1-alpha', '2.0.1-alpha.js'],
    ['2.0.1-rc.2', '2.0.1-rc.2.js'],
    ['1.10.102', '1.10.102.js'],
  ])('converts %s to %s', (version, filename) => {
    expect(versionToFilename(version)).toBe(filename);
  });
});

describe('filenameToVersion / versionToFilename', () => {
  // runAction discovers versions from filenames and then rebuilds the filename
  // from the version to locate the script. If that round trip is not the
  // identity the migration is found and then cannot be opened.
  it.each([
    '1.js',
    '2.js',
    '1.0.1.js',
    '1.10.102.js',
    '2.0.1-alpha.js',
    '2.0.1-alpha.2.js',
    '2.0.1-rc.1.js',
    // Not a documented name, but it must still survive the round trip: the
    // alternative is discovering a version whose file cannot be opened.
    '1_0_1.js',
  ])('round-trips %s unchanged', (filename) => {
    expect(versionToFilename(filenameToVersion(filename))).toBe(filename);
  });
});

describe('branchNameToEnvironmentName', () => {
  it.each([
    ['main', 'main'],
    ['feature/some-thing', 'feature-some-thing'],
    ['feature/some_thing', 'feature-some-thing'],
    ['release/1.2.3', 'release-1-2-3'],
    ['a/b_c.d', 'a-b-c-d'],
  ])('converts %s to %s', (branchName, environmentName) => {
    expect(branchNameToEnvironmentName(branchName)).toBe(environmentName);
  });

  it('throws when there is no branch name', () => {
    expect(() => branchNameToEnvironmentName(undefined)).toThrowError();
  });
});

describe('getNameFromPattern', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deliberately an instant where the UTC date and the local date (the suite
    // runs in Pacific/Auckland) fall on different days.
    vi.setSystemTime(new Date('2026-03-04T23:06:07Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['[YYYY]', '2026'],
    ['[YY]', '26'],
    ['[MM]', '03'],
    ['[DD]', '04'],
    ['[hh]', '23'],
    ['[mm]', '06'],
    ['[ss]', '07'],
  ])('resolves %s in UTC to %s', (pattern, expected) => {
    expect(getNameFromPattern(pattern)).toBe(expected);
  });

  it('resolves the default master pattern', () => {
    expect(getNameFromPattern('master-[YYYY]-[MM]-[DD]-[mm][ss]')).toBe(
      'master-2026-03-04-0607'
    );
  });

  it('resolves [branch] to an environment-safe branch name', () => {
    expect(
      getNameFromPattern('GH-[branch]', { branchName: 'feature/some_thing' })
    ).toBe('GH-feature-some-thing');
  });

  it('resolves a pattern combining date parts and the branch', () => {
    expect(
      getNameFromPattern('sandbox-[branch]-[YYYY][MM][DD]', {
        branchName: 'feature/x',
      })
    ).toBe('sandbox-feature-x-20260304');
  });

  it('leaves a pattern without placeholders untouched', () => {
    expect(getNameFromPattern('staging')).toBe('staging');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(getNameFromPattern('env-[nope]-[YYYY]')).toBe('env-[nope]-2026');
  });

  it('replaces every occurrence of a placeholder', () => {
    expect(getNameFromPattern('[YYYY]-[YYYY]')).toBe('2026-2026');
  });

  it('throws when the pattern needs a branch name and none is given', () => {
    // master_pattern is resolved without a branch name, so a [branch]
    // placeholder there fails the whole run.
    expect(() => getNameFromPattern('master-[branch]')).toThrowError();
  });
});

describe('getBranchNames', () => {
  it('returns the head and base ref for a pull request', () => {
    setOpenPullRequestContext('feature/some-thing', 'main');

    expect(getBranchNames(makeConfig())).toEqual({
      headRef: 'feature/some-thing',
      baseRef: 'main',
      defaultBranch: 'main',
    });
  });

  it('reports the default branch independently of the base ref', () => {
    setContext('pull_request', {
      repository: { default_branch: 'main' },
      pull_request: {
        merged: false,
        head: { ref: 'feature/b' },
        base: { ref: 'feature/a' },
      },
    });

    expect(getBranchNames(makeConfig())).toEqual({
      headRef: 'feature/b',
      baseRef: 'feature/a',
      defaultBranch: 'main',
    });
  });

  it('returns a null head ref for a push', () => {
    setPushContext('refs/heads/main', 'main');

    expect(getBranchNames(makeConfig())).toEqual({
      headRef: null,
      baseRef: 'main',
      defaultBranch: 'main',
    });
  });

  it('strips only the leading refs/heads/ from a push ref', () => {
    setPushContext('refs/heads/feature/refs/heads/x', 'main');

    expect(getBranchNames(makeConfig()).baseRef).toBe('feature/refs/heads/x');
  });

  // Documenting a real limitation: the action assumes an event payload that
  // carries a branch and a repository, so anything else fails obscurely.
  it('throws for an event whose payload has no ref', () => {
    setContext('workflow_dispatch', { repository: { default_branch: 'main' } });

    expect(() => getBranchNames(makeConfig())).toThrowError();
  });

  it('throws when the payload has no repository', () => {
    setContext('push', { ref: 'refs/heads/main' });

    expect(() => getBranchNames(makeConfig())).toThrowError();
  });

  describe('with an explicit head_ref', () => {
    it('supplies a head ref for an event that has none', () => {
      setPushContext('refs/heads/main', 'main');

      expect(getBranchNames(makeConfig({ headRef: 'feature/some-thing' }))).toEqual({
        headRef: 'feature/some-thing',
        baseRef: 'main',
        defaultBranch: 'main',
      });
    });

    it('overrides the head ref a pull request already carries', () => {
      setOpenPullRequestContext('feature/from-event', 'main');

      expect(getBranchNames(makeConfig({ headRef: 'feature/from-input' }))).toEqual({
        headRef: 'feature/from-input',
        baseRef: 'main',
        defaultBranch: 'main',
      });
    });

    it('leaves the base ref and default branch alone', () => {
      // setOpenPullRequestContext ties default_branch to the base ref, and the
      // point here is that a base ref other than the default branch survives
      // the override untouched.
      setContext('pull_request', {
        repository: { default_branch: 'main' },
        pull_request: {
          merged: false,
          head: { ref: 'feature/b' },
          base: { ref: 'feature/a' },
        },
      });

      expect(getBranchNames(makeConfig({ headRef: 'feature/c' }))).toMatchObject({
        baseRef: 'feature/a',
        defaultBranch: 'main',
      });
    });
  });
});

describe('getEnvironment', () => {
  const branchNames = {
    headRef: 'feature/some-thing',
    baseRef: 'main',
    defaultBranch: 'main',
  };

  describe('on a merged pull request into the default branch', () => {
    beforeEach(() => {
      setMergedPullRequestContext('feature/some-thing', 'main');
    });

    it('creates an environment named from the master pattern', async () => {
      const space = makeSpace();
      const config = makeConfig({ masterPattern: 'prod-fixed' });

      const result = await getEnvironment(asSpace(space), branchNames, config);

      expect(result.environmentType).toBe('master');
      expect(result.environmentId).toBe('prod-fixed');
      expect(space.createEnvironmentWithId).toHaveBeenCalledWith('prod-fixed', {
        name: 'prod-fixed',
      });
      expect(result.environment).toBe(space.environments.get('prod-fixed'));
    });

    it('does not look for or flush an existing environment', async () => {
      const space = makeSpace({ existingIds: ['prod-fixed'] });
      const config = makeConfig({ masterPattern: 'prod-fixed' });

      await getEnvironment(asSpace(space), branchNames, config);

      expect(space.getEnvironment).not.toHaveBeenCalled();
    });

    it('reports the base and head environment names', async () => {
      const space = makeSpace();

      const result = await getEnvironment(
        asSpace(space),
        branchNames,
        makeConfig({ masterPattern: 'prod-fixed' })
      );

      expect(result.environmentNames).toEqual({
        base: 'main',
        head: 'feature-some-thing',
      });
    });
  });

  describe('on an open pull request', () => {
    beforeEach(() => {
      setOpenPullRequestContext('feature/some-thing', 'main');
    });

    it('creates a feature environment named from the feature pattern', async () => {
      const space = makeSpace();

      const result = await getEnvironment(
        asSpace(space),
        branchNames,
        makeConfig({ featurePattern: 'sandbox-[branch]' })
      );

      expect(result.environmentType).toBe('feature');
      expect(result.environmentId).toBe('sandbox-feature-some-thing');
      expect(space.createEnvironmentWithId).toHaveBeenCalledWith(
        'sandbox-feature-some-thing',
        { name: 'sandbox-feature-some-thing' }
      );
    });

    it('deletes and recreates an existing environment when flushing is enabled', async () => {
      const space = makeSpace({ existingIds: ['GH-feature-some-thing'] });
      const existing = space.environments.get('GH-feature-some-thing');

      const result = await getEnvironment(
        asSpace(space),
        branchNames,
        makeConfig({ flushPreviewEnv: true })
      );

      expect(existing.delete).toHaveBeenCalled();
      expect(space.createEnvironmentWithId).toHaveBeenCalledWith(
        'GH-feature-some-thing',
        { name: 'GH-feature-some-thing' }
      );
      expect(result.environmentId).toBe('GH-feature-some-thing');
    });

    it('reuses an existing environment when flushing is disabled', async () => {
      const space = makeSpace({ existingIds: ['GH-feature-some-thing'] });
      const existing = space.environments.get('GH-feature-some-thing');

      const result = await getEnvironment(
        asSpace(space),
        branchNames,
        makeConfig({ flushPreviewEnv: false })
      );

      expect(existing.delete).not.toHaveBeenCalled();
      expect(space.createEnvironmentWithId).not.toHaveBeenCalled();
      expect(result.environment).toBe(existing);
    });

    it('creates the environment when none exists yet', async () => {
      const space = makeSpace();

      const result = await getEnvironment(
        asSpace(space),
        branchNames,
        makeConfig({ flushPreviewEnv: false })
      );

      expect(space.createEnvironmentWithId).toHaveBeenCalledWith(
        'GH-feature-some-thing',
        { name: 'GH-feature-some-thing' }
      );
      expect(result.environment).toBe(
        space.environments.get('GH-feature-some-thing')
      );
    });

    it('throws when the environment cannot be created', async () => {
      const space = makeSpace({ createFails: true });

      await expect(
        getEnvironment(asSpace(space), branchNames, makeConfig())
      ).rejects.toThrowError(/Cannot create environment GH-feature-some-thing/);
    });
  });

  describe('on a push', () => {
    it('creates a feature environment and reports a null head name', async () => {
      setPushContext('refs/heads/main', 'main');
      const space = makeSpace();

      const result = await getEnvironment(
        asSpace(space),
        { headRef: null, baseRef: 'main', defaultBranch: 'main' },
        makeConfig({ featurePattern: 'sandbox-fixed' })
      );

      // A push to the default branch is still a "feature" environment: only a
      // merged pull request produces the master environment.
      expect(result.environmentType).toBe('feature');
      expect(result.environmentId).toBe('sandbox-fixed');
      expect(result.environmentNames).toEqual({ base: 'main', head: null });
    });
  });

  describe('on a push with an explicit head_ref', () => {
    it('names the feature environment from the supplied branch', async () => {
      setPushContext('refs/heads/main', 'main');
      const space = makeSpace();
      const config = makeConfig({
        headRef: 'feature/some-thing',
        featurePattern: 'sandbox-[branch]',
      });

      const result = await getEnvironment(
        asSpace(space),
        getBranchNames(config),
        config
      );

      expect(result.environmentType).toBe('feature');
      expect(result.environmentId).toBe('sandbox-feature-some-thing');
      expect(result.environmentNames.head).toBe('feature-some-thing');
    });
  });

  describe('on an unmerged pull request into a non-default branch', () => {
    it('creates a feature environment', async () => {
      setOpenPullRequestContext('feature/b', 'feature/a');
      const space = makeSpace();

      const result = await getEnvironment(
        asSpace(space),
        { headRef: 'feature/b', baseRef: 'feature/a', defaultBranch: 'main' },
        makeConfig()
      );

      expect(result.environmentType).toBe('feature');
      expect(result.environmentId).toBe('GH-feature-b');
    });
  });
});

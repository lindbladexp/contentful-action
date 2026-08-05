import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { vi } from 'vitest';
import * as github from '@actions/github';
import type { Space } from 'contentful-management';
import type { Config } from '../src/types';

/**
 * A Config with every input at its documented default, so a test only has to
 * state the inputs it actually cares about.
 */
export const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  spaceId: 'test-space-id',
  managementApiKey: 'test-management-api-key',
  versionContentType: 'versionTracking',
  versionField: 'version',
  headRef: null,
  featurePattern: 'GH-[branch]',
  masterPattern: 'master-[YYYY]-[MM]-[DD]-[mm][ss]',
  deleteFeature: false,
  setAlias: false,
  flushPreviewEnv: true,
  migrationsDir: '/workspace/migrations',
  ...overrides,
});

// --- github.context -------------------------------------------------------
// `github.context` is a singleton built at import time from the runner's env.
// Its `eventName` and `payload` are plain writable properties, so tests set
// them directly rather than mocking the whole module.

type MutableContext = { eventName: string; payload: typeof github.context.payload };

let savedContext: { eventName: string; payload: typeof github.context.payload } | null =
  null;

export const setContext = (
  eventName: string,
  payload: Record<string, unknown>
): void => {
  const context = github.context as unknown as MutableContext;
  if (!savedContext) {
    savedContext = { eventName: context.eventName, payload: context.payload };
  }
  context.eventName = eventName;
  context.payload = payload;
};

/** Called from the global afterEach in setup.ts. */
export const restoreContext = (): void => {
  if (!savedContext) {
    return;
  }
  const context = github.context as unknown as MutableContext;
  context.eventName = savedContext.eventName;
  context.payload = savedContext.payload;
  savedContext = null;
};

/**
 * A merged pull request. This is the "master" case only when baseRef is also
 * the default branch, which is the default here.
 */
export const setMergedPullRequestContext = (
  headRef = 'feature/some-thing',
  baseRef = 'main',
  defaultBranch = 'main'
): void =>
  setContext('pull_request', {
    repository: { default_branch: defaultBranch },
    pull_request: { merged: true, head: { ref: headRef }, base: { ref: baseRef } },
  });

/** An open pull request: always the "feature" case. */
export const setOpenPullRequestContext = (
  headRef = 'feature/some-thing',
  baseRef = 'main',
  defaultBranch = 'main'
): void =>
  setContext('pull_request', {
    repository: { default_branch: defaultBranch },
    pull_request: { merged: false, head: { ref: headRef }, base: { ref: baseRef } },
  });

/** A plain push: also the "feature" case, with no head ref. */
export const setPushContext = (ref = 'refs/heads/main', defaultBranch = 'main'): void =>
  setContext('push', {
    repository: { default_branch: defaultBranch },
    ref,
  });

// --- contentful-management fakes ------------------------------------------
// Hand-rolled stubs of just the surface the action touches. They are cast to
// the real types at the call site; a fake that drifts from the real API shows
// up as a type error in `pnpm typecheck`.

export interface FakeEntry {
  fields: Record<string, Record<string, string>>;
  update: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
}

/**
 * The version-tracking entry. `update()` and `publish()` resolve to the entry
 * itself, mirroring the real SDK, so the mutation loop in runAction keeps
 * working and the final field value stays inspectable.
 */
export const makeVersionEntry = (
  version: string,
  { field = 'version', locale = 'en-US' } = {}
): FakeEntry => {
  const entry: FakeEntry = {
    fields: { [field]: { [locale]: version } },
    update: vi.fn(),
    publish: vi.fn(),
  };
  entry.update.mockImplementation(async () => entry);
  entry.publish.mockImplementation(async () => entry);
  return entry;
};

export interface FakeEnvironment {
  sys: { id: string; status: { sys: { id: string } } };
  delete: ReturnType<typeof vi.fn>;
  getLocales: ReturnType<typeof vi.fn>;
  getEntries: ReturnType<typeof vi.fn>;
}

export const makeApiKey = (id: string) => {
  const key = { sys: { id }, environments: [] as unknown[], update: vi.fn() };
  key.update.mockImplementation(async () => key);
  return key;
};

export const makeAlias = (id = 'master', environmentId = 'previous-environment') => {
  const alias = {
    sys: { id },
    environment: { sys: { id: environmentId } },
    update: vi.fn(),
  };
  alias.update.mockImplementation(async () => alias);
  return alias;
};

export interface FakeSpaceOptions {
  /** Environment ids that already exist before the action runs. */
  existingIds?: string[];
  /** Locales returned by `environment.getLocales()`. */
  locales?: { code: string; default: boolean }[];
  /** Entries returned by `environment.getEntries()`. */
  entries?: FakeEntry[];
  /**
   * `sys.status` values handed out by successive `getEnvironment()` calls. The
   * last value repeats forever. Defaults to always-ready.
   */
  statuses?: string[];
  apiKeys?: ReturnType<typeof makeApiKey>[];
  alias?: ReturnType<typeof makeAlias>;
  /** Make `createEnvironmentWithId()` reject. */
  createFails?: boolean;
}

export const makeSpace = (options: FakeSpaceOptions = {}) => {
  const {
    existingIds = [],
    locales = [{ code: 'en-US', default: true }],
    entries = [],
    statuses = ['ready'],
    apiKeys = [],
    alias = makeAlias(),
    createFails = false,
  } = options;

  const remainingStatuses = [...statuses];
  const nextStatus = (): string =>
    remainingStatuses.length > 1 ? remainingStatuses.shift() : remainingStatuses[0];

  const environments = new Map<string, FakeEnvironment>();

  const makeEnvironment = (id: string): FakeEnvironment => {
    const environment: FakeEnvironment = {
      sys: { id, status: { sys: { id: 'ready' } } },
      delete: vi.fn().mockResolvedValue(undefined),
      getLocales: vi.fn().mockImplementation(async () => ({ items: locales })),
      getEntries: vi.fn().mockImplementation(async () => ({ items: entries })),
    };
    environments.set(id, environment);
    return environment;
  };

  existingIds.forEach((id) => makeEnvironment(id));

  const space = {
    sys: { id: 'test-space-id' },
    createEnvironmentWithId: vi.fn(async (id: string) => {
      if (createFails) {
        throw new Error(`Cannot create environment ${id}`);
      }
      return makeEnvironment(id);
    }),
    getEnvironment: vi.fn(async (id: string) => {
      const environment = environments.get(id);
      if (!environment) {
        throw new Error(`Environment not found: ${id}`);
      }
      // The action reads sys.status off whatever getEnvironment returns, so
      // the status sequence is applied here.
      environment.sys.status.sys.id = nextStatus();
      return environment;
    }),
    getApiKeys: vi.fn(async () => ({ items: apiKeys })),
    getEnvironmentAlias: vi.fn(async () => alias),
    /** Test-only view of the environments this space knows about. */
    environments,
  };

  return space;
};

export type FakeSpace = ReturnType<typeof makeSpace>;

/** Cast a fake through to the SDK type the production signature demands. */
export const asSpace = (space: FakeSpace): Space => space as unknown as Space;

/**
 * The environment a test expects the space to know about. `Map.get()` returns
 * `FakeEnvironment | undefined`, so asserting on a mock off the raw result is
 * both a type error under strictNullChecks and, when the id is wrong, a
 * "cannot read properties of undefined" that says nothing about the cause.
 */
export const environmentIn = (space: FakeSpace, id: string): FakeEnvironment => {
  const environment = space.environments.get(id);
  if (!environment) {
    const known = [...space.environments.keys()].join(', ') || '(none)';
    throw new Error(
      `Expected the space to have an environment "${id}". It has: ${known}`
    );
  }
  return environment;
};

// --- migrations directory -------------------------------------------------

const createdDirs: string[] = [];

/**
 * A real directory of real (empty) migration files. runAction reads the
 * directory with fs, so giving it real files is both simpler and more faithful
 * than mocking fs.
 */
export const makeMigrationsDir = (filenames: string[]): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'contentful-action-'));
  createdDirs.push(dir);
  filenames.forEach((filename) => {
    writeFileSync(path.join(dir, filename), 'module.exports = function () {};\n');
  });
  return dir;
};

export const cleanupMigrationsDirs = (): void => {
  while (createdDirs.length) {
    rmSync(createdDirs.pop(), { recursive: true, force: true });
  }
};

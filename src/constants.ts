import path from "path";
import * as core from '@actions/core';
import type { Config, EnvironmentTypeInput } from './types';

const booleanOr = (str: string, fallback: boolean): boolean => {
  switch (str) {
    case "true":
      return true;
    case "false":
      return false;
    default:
      return fallback;
  }
};

/**
 * `environment_type` is a closed set, and a typo in it would otherwise fall
 * through to the inferred behaviour and migrate the wrong environment — so an
 * unrecognised value is a hard error rather than a silent default.
 */
const environmentTypeOr = (
  str: string,
  fallback: EnvironmentTypeInput
): EnvironmentTypeInput => {
  if (!str) {
    return fallback;
  }
  if (str === 'auto' || str === 'master' || str === 'feature') {
    return str;
  }
  throw new Error(
    `environment_type must be one of "auto", "master" or "feature", got "${str}"`
  );
};

const getInputOr = (coreInput: string, fallback: string): string => {
  const input = core.getInput(coreInput);
  if (input) {
    return input;
  }
  return fallback;
}

/**
 * `refs/heads/foo` and `foo` name the same branch. Everything downstream of the
 * inputs and the event payload deals in bare branch names, because that is what
 * the `[branch]` pattern placeholder interpolates.
 */
export const stripRefsHeads = (ref: string): string =>
  ref.replace(/^refs\/heads\//, '');

export const DEFAULT_MIGRATIONS_DIR = "migrations";
export const DEFAULT_MASTER_PATTERN = "master-[YYYY]-[MM]-[DD]-[mm][ss]";
export const DEFAULT_FEATURE_PATTERN = "GH-[branch]";
export const DEFAULT_VERSION_CONTENT_TYPE = "versionTracking";
export const DEFAULT_VERSION_FIELD = "version";
export const DEFAULT_DELETE_FEATURE = false;
export const DEFAULT_SET_ALIAS = false;
export const DEFAULT_FLUSH_PREVIEW_ENV = true;
export const DEFAULT_ENVIRONMENT_TYPE: EnvironmentTypeInput = 'auto';

export const CONTENTFUL_ALIAS = "master";
export const DELAY = 32_000;
export const MAX_NUMBER_OF_TRIES = 10;

/**
 * Resolve the action inputs into a Config.
 *
 * This is deliberately a function and not a set of module-level constants: the
 * required inputs throw when missing, and as import-time side effects those
 * throws escaped the try/catch in index.ts and surfaced as an unhandled module
 * load failure instead of a `core.setFailed()` with a useful message.
 */
export const getConfig = (): Config => {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    throw new Error(
      'GITHUB_WORKSPACE is not set, cannot resolve the migrations directory'
    );
  }

  return {
    spaceId: core.getInput('space_id', { required: true }),
    managementApiKey: core.getInput('management_api_key', { required: true }),
    versionContentType: getInputOr(
      'version_content_type',
      DEFAULT_VERSION_CONTENT_TYPE
    ),
    versionField: getInputOr('version_field', DEFAULT_VERSION_FIELD),
    // Null, not "", so that "was a head branch supplied?" is a single check
    // both here and in getBranchNames().
    headRef: core.getInput('head_ref')
      ? stripRefsHeads(core.getInput('head_ref'))
      : null,
    featurePattern: getInputOr('feature_pattern', DEFAULT_FEATURE_PATTERN),
    masterPattern: getInputOr('master_pattern', DEFAULT_MASTER_PATTERN),
    deleteFeature: booleanOr(
      core.getInput('delete_feature'),
      DEFAULT_DELETE_FEATURE
    ),
    setAlias: booleanOr(core.getInput('set_alias'), DEFAULT_SET_ALIAS),
    environmentType: environmentTypeOr(
      core.getInput('environment_type'),
      DEFAULT_ENVIRONMENT_TYPE
    ),
    flushPreviewEnv: booleanOr(
      core.getInput('flush_preview_env'),
      DEFAULT_FLUSH_PREVIEW_ENV
    ),
    migrationsDir: path.join(
      workspace,
      getInputOr('migrations_dir', DEFAULT_MIGRATIONS_DIR)
    ),
  };
};

import path from "path";
import * as core from '@actions/core';

export const {
  GITHUB_WORKSPACE,
  LOG_LEVEL,
} = process.env;

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

const getInputOr = (coreInput: string, fallback: string): string => {
  if ( coreInput ) {
    return core.getInput(coreInput);
  }
  return fallback;
}

export const DEFAULT_MIGRATIONS_DIR = "migrations";
export const DEFAULT_MASTER_PATTERN = "master-[YYYY]-[MM]-[DD]-[mm][ss]";
export const DEFAULT_FEATURE_PATTERN = "GH-[branch]";
export const DEFAULT_VERSION_CONTENT_TYPE = "versionTracking";
export const DEFAULT_VERSION_FIELD = "version";
export const DEFAULT_DELETE_FEATURE = false;
export const DEFAULT_SET_ALIAS = false;

export const VERSION_CONTENT_TYPE = getInputOr('version_content_type', DEFAULT_VERSION_CONTENT_TYPE);
export const FEATURE_PATTERN = getInputOr('feature_pattern', DEFAULT_FEATURE_PATTERN);
export const MASTER_PATTERN = getInputOr('master_pattern', DEFAULT_MASTER_PATTERN);
export const VERSION_FIELD = getInputOr('version_field', DEFAULT_VERSION_FIELD);
export const DELETE_FEATURE = booleanOr(core.getInput('delete_feature'), DEFAULT_DELETE_FEATURE);
export const SET_ALIAS = booleanOr(core.getInput('set_alias'), DEFAULT_SET_ALIAS);
export const MIGRATIONS_DIR = path.join(GITHUB_WORKSPACE, getInputOr('migrations_dir', DEFAULT_MIGRATIONS_DIR));

export const CONTENTFUL_ALIAS = "master";
export const DELAY = 3000;
export const MAX_NUMBER_OF_TRIES = 10;

import * as github from '@actions/github';
import chalk from 'chalk';
import { Space } from 'contentful-management/dist/typings/entities/space';
import { CONTENTFUL_ALIAS, DELAY, FEATURE_PATTERN, LOG_LEVEL, MASTER_PATTERN } from './constants';
import { BranchNames, EnvironmentProps, EnvironmentType, EventNames, NameFromPatternArgs } from './types';

// Force colors on github
chalk.level = 3;

export const Logger = {
  log(message: string): void {
    console.log(chalk.white(message));
  },
  success(message: string): void {
    console.log('✅', chalk.green(message));
  },
  error(message: string): void {
    console.log('💩', chalk.red(message));
  },
  warn(message: string): void {
    console.log('⚠️', chalk.yellow(message));
  },
  verbose(message: string): void {
    if (LOG_LEVEL === 'verbose') {
      console.log(chalk.white(message));
    }
  },
};

/**
 * Promise based delay
 * @param time
 */
export const delay = (time = DELAY): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, time));

/**
 * Convert fileNames to versions
 * @example
 * filenameToVersion("1.js") // "1"
 * filenameToVersion("1.0.1.js") // "1.0.1"
 */
export const filenameToVersion = (file: string): string =>
  file.replace(/\.js$/, '').replace(/_/g, '.');

/**
 * Convert versions to filenames
 * @example
 * versionToFilename("1") // "1.js"
 * versionToFilename("1.0.1") // "1.0.1.js"
 */
export const versionToFilename = (version: string): string =>
  `${version.replace(/\\./g, '_')}.js`;

/**
 * Convert a branchName to a valid environmentName
 * @param branchName
 */
export const branchNameToEnvironmentName = (branchName: string): string =>
  branchName.replace(/[_.]/g, '-');

export enum Matcher {
  YY = 'YY',
  YYYY = 'YYYY',
  MM = 'MM',
  DD = 'DD',
  hh = 'hh',
  mm = 'mm',
  ss = 'ss',
  branch = 'branch',
}

export const matchers = {
  [Matcher.ss]: (date: Date): string =>
    `${date.getUTCSeconds()}`.padStart(2, '0'),
  [Matcher.hh]: (date: Date): string =>
    `${date.getUTCHours()}`.padStart(2, '0'),
  [Matcher.mm]: (date: Date): string =>
    `${date.getUTCMinutes()}`.padStart(2, '0'),
  [Matcher.YYYY]: (date: Date): string => `${date.getUTCFullYear()}`,
  [Matcher.YY]: (date: Date): string => `${date.getUTCFullYear()}`.substr(2, 2),
  [Matcher.MM]: (date: Date): string =>
    `${date.getUTCMonth() + 1}`.padStart(2, '0'),
  [Matcher.DD]: (date: Date): string => `${date.getDate()}`.padStart(2, '0'),
  [Matcher.branch]: (branchName: string): string =>
    branchNameToEnvironmentName(branchName),
};

/**
 *
 * @param pattern
 * @param branchName
 */
export const getNameFromPattern = (
  pattern: string,
  { branchName }: NameFromPatternArgs = {}
): string => {
  const date = new Date();
  return pattern.replace(
    /\[(YYYY|YY|MM|DD|hh|mm|ss|branch)]/g,
    (substring, match: Matcher) => {
      switch (match) {
        case Matcher.branch:
          return matchers[Matcher.branch](branchName);
        case Matcher.YYYY:
        case Matcher.YY:
        case Matcher.MM:
        case Matcher.DD:
        case Matcher.hh:
        case Matcher.mm:
        case Matcher.ss:
          return matchers[match](date);
        default:
          return substring;
      }
    }
  );
};

/**
 * Get the branchNames based on the eventName
 */
export const getBranchNames = (): BranchNames => {
  const { eventName, payload } = github.context;
  const { default_branch: defaultBranch } = payload.repository;

  Logger.verbose(`Getting branch names for "${eventName}"`);

  // Check the name of the event
  switch (eventName) {
    // If it is a Pull request we return the head and base ref
    case EventNames.pullRequest:
      return {
        headRef: payload.pull_request.head.ref,
        baseRef: payload.pull_request.base.ref,
        defaultBranch,
      };
    // If is not a Pull request we need work on the baseRef therefore head is null
    default:
      return {
        headRef: null,
        baseRef: payload.ref.replace(/^refs\/heads\//, ''),
        defaultBranch,
      };
  }
};

/**
 * Get the environment from a space
 * Checks if an environment already exists and then flushes it
 * @param space
 * @param branchNames
 */
export const getEnvironment = async (
  space: Space,
  branchNames: BranchNames
): Promise<EnvironmentProps> => {
  const environmentNames = {
    base: branchNameToEnvironmentName(branchNames.baseRef),
    head: branchNames.headRef
      ? branchNameToEnvironmentName(branchNames.headRef)
      : null,
  };

  // If the Pull Request is merged and the base is the repository default_name (master|main, ...)
  // Then create an environment name for the given master_pattern
  // Else create an environment name for the given feature_pattern

  Logger.verbose(
    `MASTER_PATTERN: ${MASTER_PATTERN} | FEATURE_PATTERN: ${FEATURE_PATTERN}`
  );

  let environmentType: EnvironmentType =
    branchNames.baseRef === branchNames.defaultBranch
      ? CONTENTFUL_ALIAS
      : 'feature';

  // If a headRef exists implying it is a Pull request then set type to feature
  if (environmentNames.head !== null) {
    environmentType = 'feature';
  }

  Logger.verbose(`Environment type: ${environmentType}`);

  const environmentId =
    environmentType === CONTENTFUL_ALIAS
      ? getNameFromPattern(MASTER_PATTERN)
      : getNameFromPattern(FEATURE_PATTERN, {
          branchName: branchNames.headRef,
        });

  Logger.verbose(`Environment id: "${environmentId}"`);

  // If environment matches ${CONTENTFUL_ALIAS} ("master")
  // Then return it without further actions
  if (environmentType === CONTENTFUL_ALIAS) {
    return {
      environmentType,
      environmentNames,
      environmentId,
      environment: await space.createEnvironmentWithId(environmentId, {
        name: environmentId,
      }),
    };
  }
  // Else we need to check for an existing environment and flush it
  Logger.log(
    `Checking for existing versions of environment: "${environmentId}"`
  );

  try {
    const environment = await space.getEnvironment(environmentId);
    await environment?.delete();
    Logger.success(`Environment deleted: "${environmentId}"`);
  } catch (e) {
    Logger.log(`Environment not found: "${environmentId}"`);
  }

  Logger.log(`Creating environment ${environmentId}`);

  return {
    environmentType,
    environmentNames,
    environmentId,
    environment: await space.createEnvironmentWithId(environmentId, {
      name: environmentId,
    }),
  };
};

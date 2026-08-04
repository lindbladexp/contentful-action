import * as github from '@actions/github';
import chalk from 'chalk';
import type { Space } from 'contentful-management';
import { CONTENTFUL_ALIAS, DELAY, stripRefsHeads } from './constants';
import {
  BranchNames,
  Config,
  EnvironmentProps,
  EventNames,
  NameFromPatternArgs,
} from './types';

// Force colors on github
chalk.level = 3;

const stringifyObject = (obj) => JSON.stringify(obj, null, 2)

export const Logger = {
  log(message) {
    console.log(chalk.white(message));
  },
  success(message) {
    console.log('✅', chalk.green(message));
  },
  error(message) {
    console.log('💩', chalk.red(message));
  },
  warn(message) {
    console.log('⚠️', chalk.yellow(message));
  },
  info(message) {
    console.log("ℹ️", chalk.blue(message));
  },
  verbose(message) {
    if (process.env.LOG_LEVEL === "verbose") {
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
export const filenameToVersion = (file: string): string => {
  Logger.success(`filenameToVersion function`)
  Logger.info(`file: ${file}`)
  return file.replace(/\.js$/, "").replace(/_/g, ".");
}

/**
 * Convert versions to filenames
 * @example
 * versionToFilename("1") // "1.js"
 * versionToFilename("1.0.1") // "1.0.1.js"
 */
export const versionToFilename = (version: string): string => {
  Logger.success(`versionToFilename function`)
  Logger.info(`version: ${version}`)
  return `${version.replace(/\\./g, "_")}.js`;
}

/**
 * Convert a branchName to a valid environmentName
 * @param branchName
 */
export const branchNameToEnvironmentName = (branchName: string): string => {
  Logger.success(`branchNameToEnvironmentName function`)
  Logger.info(`branchName: ${branchName}`)
  try {
    const newBranchName = branchName.replace(/[/_.]/g, "-");
    return newBranchName
  } catch (e) {
    console.trace('branchNameToEnvironmentName error', e)
    throw new Error(String(e), { cause: e })
  }
}

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
    `${date.getUTCMonth() + 1}`.padStart(2, "0"),
  [Matcher.DD]: (date: Date): string =>
    `${date.getUTCDate()}`.padStart(2, "0"),
  [Matcher.branch]: (branchName: string): string => {
    Logger.success('matchers[Matcher.branch]')
    Logger.info(`Matcher.branch ${Matcher.branch}`)
    Logger.info(`branchName: ${branchName}`)
    return branchNameToEnvironmentName(branchName);
  }
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
  Logger.success(`getNameFromPattern function`);
  Logger.info(`pattern: ${pattern}`);
  Logger.info(`branchName: ${branchName}`);
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
 * Get the branchNames based on the eventName, with the `head_ref` input taking
 * precedence over the event.
 */
export const getBranchNames = (config: Config): BranchNames => {
  const { eventName, payload } = github.context;
  const { default_branch: defaultBranch } = payload.repository;

  // Check the eventName
  Logger.success('getBranchNames function')
  Logger.info(`eventName: ${eventName}`)
  Logger.info(`payload: ${stringifyObject(payload)}`)
  const fromEvent = ((): BranchNames => {
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
          baseRef: stripRefsHeads(payload.ref),
          defaultBranch,
        };
    }
  })();

  // An explicit head_ref wins over the event. Without it a run triggered by
  // anything other than a pull request has no head branch at all, so it can
  // only ever resolve the master pattern; supplying one is what lets a manually
  // dispatched run target a feature environment.
  if (config.headRef) {
    Logger.info(`head_ref input overrides the event head ref: ${config.headRef}`);
    return { ...fromEvent, headRef: config.headRef };
  }

  return fromEvent;
};

/**
 * Get the environment from a space
 * Checks if an environment already exists and then flushes it
 * @param space
 * @param branchNames
 */
export const getEnvironment = async (
  space: Space,
  branchNames: BranchNames,
  config: Config
): Promise<EnvironmentProps> => {
  Logger.success('getEnvironment function')
  Logger.info(`space ${stringifyObject(space)}`)
  Logger.info(`branchNames ${stringifyObject(branchNames)}`)
  const environmentNames = {
    base: branchNameToEnvironmentName(branchNames.baseRef),
    head: branchNames.headRef
      ? branchNameToEnvironmentName(branchNames.headRef)
      : null,
  };
  // If the Pull Request is merged and the base is the repository default_name (master|main, ...)
  // Then create an environment name for the given master_pattern
  // Else create an environment name for the given feature_pattern
  Logger.info(
    `masterPattern: ${config.masterPattern} | featurePattern: ${config.featurePattern}`
  );
  Logger.info(`branchNames.baseRef: ${branchNames.baseRef}`);
  Logger.info(`branchNames.defaultBranch: ${branchNames.defaultBranch}`);
  Logger.info(`github.context.payload: ${stringifyObject(github.context.payload)}`)
  const environmentType =
    branchNames.baseRef === branchNames.defaultBranch &&
    github.context.payload.pull_request?.merged
      ? CONTENTFUL_ALIAS
      : "feature";
  Logger.info(`environmentType: ${environmentType}` );
  Logger.info(`flushPreviewEnv: ${config.flushPreviewEnv}`);
  Logger.info(`branchNames.headRef: ${branchNames.headRef}`);
  const environmentId =
    environmentType === CONTENTFUL_ALIAS
      ? getNameFromPattern(config.masterPattern)
      : getNameFromPattern(config.featurePattern, {
          branchName: branchNames.headRef,
        });
  Logger.info(`environmentId: "${environmentId}"`);

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
    if (config.flushPreviewEnv) {
      await environment?.delete();
      Logger.success(`Environment deleted: "${environmentId}"`);
    } else {
      Logger.log(
        `flush_preview_env is set to ${config.flushPreviewEnv}. Skipping flush.`
      );
      return {
        environmentType,
        environmentNames,
        environmentId,
        environment,
      };
    }
  } catch {
    Logger.log(`Environment not found: "${environmentId}"`);
  }

  try {
    Logger.log(`Creating environment ${environmentId}`);

    const newEnv = await space.createEnvironmentWithId(environmentId, {
      name: environmentId,
    });

    Logger.success(`New environment created: "${environmentId}"`);

    return {
      environmentType,
      environmentNames,
      environmentId,
      environment: newEnv,
    };
  } catch (e) {
    Logger.error(
      `Failed creating new environment with environmentId: "${environmentId}"`
    );
    throw new Error(String(e), { cause: e });
  }
};

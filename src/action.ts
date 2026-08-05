import * as core from '@actions/core';
import * as github from '@actions/github';
import { runMigration } from 'contentful-migration';
import { readdir } from 'fs';
import path from 'path';
import { promisify } from 'util';
import toSemver from 'to-semver';
import type { Space } from 'contentful-management';

import { CONTENTFUL_ALIAS, MAX_NUMBER_OF_TRIES } from './constants';
import type { Config } from './types';
import {
  delay,
  filenameToVersion,
  getBranchNames,
  getEnvironment,
  getNameFromPattern,
  Logger,
  versionToFilename,
} from './utils';

export const readdirAsync = promisify(readdir);

/**
 * Run the action
 * @param space
 * @param config
 */
export const runAction = async (
  space: Space,
  config: Config
): Promise<void> => {
  // Get base and if a pull request also the head ref
  const branchNames = getBranchNames(config);

  Logger.verbose(
    `Branch names for getting environment ${JSON.stringify(branchNames)}`
  );

  const { environmentId, environment, environmentType } = await getEnvironment(
    space,
    branchNames,
    config
  );

  Logger.verbose(`environment id: ${environmentId}`);
  Logger.verbose(`environment: ${JSON.stringify(environment)}`);
  Logger.verbose(`environment type: ${environmentType}`);

  // Counter to limit retries
  let count = 0;

  Logger.log('Waiting for environment processing...');

  while (count < MAX_NUMBER_OF_TRIES) {
    const env = await space.getEnvironment(environment.sys.id);
    const status = env.sys.status.sys.id;

    if (status === 'ready') {
      Logger.success(
        `Successfully processed new environment: "${environmentId}"`
      );
      break;
    } else if (status === 'failed') {
      Logger.warn('Environment creation failed');
      break;
    }

    await delay();
    count++;
  }

  Logger.verbose('Update API Keys to allow access to new environment');
  const newEnv = {
    sys: {
      type: 'Link',
      linkType: 'Environment',
      id: environmentId,
    },
  };

  const { items: keys } = await space.getApiKeys();
  await Promise.all(
    keys.map((key) => {
      Logger.verbose(`Updating: "${key.sys.id}"`);
      key.environments.push(newEnv);
      return key.update();
    })
  );

  Logger.verbose('Set default locale to new environment');
  const defaultLocale = (await environment.getLocales()).items.find(
    (locale) => locale.default
  ).code;

  Logger.verbose('Read all the available migrations from the file system');
  // Check for available migrations
  // Migration scripts need to be sorted in order to run without conflicts
  const availableMigrations = toSemver(
    (await readdirAsync(config.migrationsDir)).map((file) => filenameToVersion(file)),
    { clean: false }
  ).reverse();

  Logger.verbose(
    `versionOrder: ${JSON.stringify(availableMigrations, null, 4)}`
  );

  Logger.verbose('Find current version of the contentful space');
  const { items: versions } = await environment.getEntries({
    content_type: config.versionContentType,
  });

  // If there is no entry or more than one of CONTENTFUL_VERSION_TRACKING
  // Then throw an Error and abort
  if (versions.length === 0) {
    throw new Error(
      `Error occured, no entry of type "${config.versionContentType}" was found`
    );
  } else if (versions.length > 1) {
    throw new Error(
      `There should only be one entry of type "${config.versionContentType}"`
    );
  }

  const [storedVersionEntry] = versions;
  const currentVersionString =
    storedVersionEntry.fields[config.versionField][defaultLocale];

  Logger.verbose('Evaluate which migrations to run');
  const currentMigrationIndex = availableMigrations.indexOf(
    currentVersionString
  );

  // If the migration can't be found
  // Then abort
  if (currentMigrationIndex === -1) {
    throw new Error(
      `Version ${currentVersionString} is not matching with any known migration`
    );
  }

  const migrationsToRun = availableMigrations.slice(currentMigrationIndex + 1);
  const migrationOptions = {
    spaceId: config.spaceId,
    environmentId,
    accessToken: config.managementApiKey,
    yes: true,
  };

  Logger.verbose('Run migrations and update version entry');
  // Allow mutations
  let migrationToRun;
  let mutableStoredVersionEntry = storedVersionEntry;
  while ((migrationToRun = migrationsToRun.shift())) {
    const filePath = path.join(
      config.migrationsDir,
      versionToFilename(migrationToRun)
    );
    Logger.verbose(`Running ${filePath}`);
    await runMigration(
      Object.assign(migrationOptions, {
        filePath,
      })
    );
    Logger.success(`Migration script ${migrationToRun}.js succeeded`);

    mutableStoredVersionEntry.fields[config.versionField][defaultLocale] =
      migrationToRun;
    mutableStoredVersionEntry = await mutableStoredVersionEntry.update();
    mutableStoredVersionEntry = await mutableStoredVersionEntry.publish();

    Logger.success(
      `Updated field ${config.versionField} in ${config.versionContentType} entry to ${migrationToRun}`
    );
  }

  Logger.log(`Checking if we need to update ${CONTENTFUL_ALIAS} alias`);
  // If the environmentType is ${CONTENTFUL_ALIAS} ("master")
  // Then set the alias to the new environment
  // Else inform the user

  if (environmentType === CONTENTFUL_ALIAS && config.setAlias) {
    Logger.log(`Running on ${CONTENTFUL_ALIAS}.`);
    Logger.log(`Updating ${CONTENTFUL_ALIAS} alias.`);
    await space
      .getEnvironmentAlias(CONTENTFUL_ALIAS)
      .then((alias) => {
        alias.environment.sys.id = environmentId;
        return alias.update();
      })
      .then((alias) => Logger.success(`alias ${alias.sys.id} updated.`))
      .catch(Logger.error);
  } else {
    Logger.verbose('Running on feature branch');
    Logger.verbose('No alias changes required');
  }

  // If the sandbox environment should be deleted
  // And the baseRef is the repository default_branch (master|main ...)
  // And the Pull Request has been merged
  // Then delete the sandbox environment
  if (
    config.deleteFeature &&
    branchNames.baseRef === branchNames.defaultBranch &&
    github.context.payload.pull_request?.merged
  ) {
    try {
      const environmentIdToDelete = getNameFromPattern(config.featurePattern, {
        branchName: branchNames.headRef,
      });
      Logger.log(`Delete the environment: ${environmentIdToDelete}`);
      const environment = await space.getEnvironment(environmentIdToDelete);
      await environment?.delete();
      Logger.success(`Deleted the environment: ${environmentIdToDelete}`);
    } catch {
      Logger.error('Cannot delete the environment');
    }
  }

  // Set the outputs for further actions
  core.setOutput(
    'environment_url',
    `https://app.contentful.com/spaces/${space.sys.id}/environments/${environmentId}`
  );
  core.setOutput('environment_name', environmentId);
  Logger.success('🚀 All done 🚀');
};

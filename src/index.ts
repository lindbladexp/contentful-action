import * as core from '@actions/core';
import { createClient } from 'contentful-management';
import { runAction } from './action';
import { Logger } from './utils';
import { getConfig } from './constants';

async function main(): Promise<void> {
  try {
    const config = getConfig();
    // `legacy` is the nested client (space.getEnvironment(), entry.update(), ...)
    // that this action is built on. As of contentful-management v12 the plain
    // client is the default, so the nested one must be requested explicitly.
    const client = createClient(
      {
        accessToken: config.managementApiKey,
      },
      { type: 'legacy' }
    );
    const space = await client.getSpace(config.spaceId);
    await runAction(space, config);
  } catch (error) {
    Logger.error(error);
    core.setFailed(error.message);
  }
}

main();

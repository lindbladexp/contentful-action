import * as core from '@actions/core';
import { createClient } from 'contentful-management';
import { runAction } from './action';
import { Logger } from './utils';
import { MANAGEMENT_API_KEY, SPACE_ID } from './constants';

async function main(): Promise<void> {
  try {
    // `legacy` is the nested client (space.getEnvironment(), entry.update(), ...)
    // that this action is built on. As of contentful-management v12 the plain
    // client is the default, so the nested one must be requested explicitly.
    const client = createClient(
      {
        accessToken: MANAGEMENT_API_KEY,
      },
      { type: 'legacy' }
    );
    const space = await client.getSpace(SPACE_ID);
    await runAction(space);
  } catch (error) {
    Logger.error(error);
    core.setFailed(error.message);
  }
}

main();

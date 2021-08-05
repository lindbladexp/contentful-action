import * as core from "@actions/core";
import { createClient } from "contentful-management";
import { runAction } from "./action";
import { Logger } from "./utils";
import {
  MANAGEMENT_API_KEY,
  SPACE_ID,
} from './constants';

async function main(): Promise<void> {
  try {
    const client = createClient({
      accessToken: MANAGEMENT_API_KEY,
    });
    const space = await client.getSpace(SPACE_ID);
    await runAction(space);
  } catch (error) {
    Logger.error(error);
    core.setFailed(error.message);
  }
}

main();

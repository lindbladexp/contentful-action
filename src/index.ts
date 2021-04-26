import * as core from "@actions/core";
import { createClient } from "contentful-management";
import { runAction } from "./action";
import { Logger } from "./utils";

(async () => {
  try {
    const accessToken = core.getInput('management_api_key', { required: true });
    const spaceId = core.getInput('space_id', { required: true });
    const client = createClient({
      accessToken: accessToken,
    });
    const space = await client.getSpace(spaceId);
    await runAction(space);
  } catch (error) {
    Logger.error(error);
    core.setFailed(error.message);
  }
})();

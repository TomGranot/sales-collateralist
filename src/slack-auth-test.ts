import dotenv from "dotenv";
import { WebClient } from "@slack/web-api";
import { pathToFileURL } from "node:url";

dotenv.config({ path: ".env.local" });

export interface SlackAuthIdentity {
  teamName?: string;
  teamId: string;
  botUserId: string;
}

export async function fetchSlackIdentity(token: string): Promise<SlackAuthIdentity> {
  const slack = new WebClient(token);
  const auth = await slack.auth.test();

  if (!auth.ok || !auth.user_id || !auth.team_id) {
    throw new Error("Slack auth.test did not return the expected bot user or team id");
  }

  return {
    teamName: auth.team,
    teamId: auth.team_id,
    botUserId: auth.user_id,
  };
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing SLACK_BOT_TOKEN in the environment");
  }

  const auth = await fetchSlackIdentity(token);

  console.log("Slack token is valid.");
  console.log(`team: ${auth.teamName ?? ""}`);
  console.log(`team_id: ${auth.teamId}`);
  console.log(`bot_user_id: ${auth.botUserId}`);
  console.log("");
  console.log("Add these to your local env file:");
  console.log(`SLACK_TEAM_ID=${auth.teamId}`);
  console.log(`SLACK_BOT_USER_ID=${auth.botUserId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

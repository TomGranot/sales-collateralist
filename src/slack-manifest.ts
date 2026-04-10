import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";

dotenv.config({ path: ".env.local" });

export interface SlackManifestOptions {
  appName: string;
  requestUrl: string;
  output: string;
  publicOnly: boolean;
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Missing --request-url. Example: npm run slack:manifest -- --request-url https://your-app.onrender.com");
  }

  const url = new URL(trimmed);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildOptions(): SlackManifestOptions {
  const appName = readFlag("--app-name") ?? process.env.SLACK_APP_NAME ?? "Collateralist";
  const requestUrl = normalizeBaseUrl(
    readFlag("--request-url") ?? process.env.SLACK_MANIFEST_REQUEST_URL ?? ""
  );
  const output = readFlag("--output") ?? process.env.SLACK_MANIFEST_OUTPUT ?? ".data/slack-app-manifest.yaml";
  const publicOnly = hasFlag("--public-only");

  return { appName, requestUrl, output, publicOnly };
}

function yamlList(items: string[], indent = 0): string {
  const padding = " ".repeat(indent);
  return items.map((item) => `${padding}- ${item}`).join("\n");
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function buildManifest(options: SlackManifestOptions): string {
  const botScopes = [
    "app_mentions:read",
    "chat:write",
    "files:write",
    "users:read",
    "channels:history",
  ];
  const botEvents = ["app_mention", "message.channels"];

  if (!options.publicOnly) {
    botScopes.push("groups:history", "im:history", "mpim:history");
    botEvents.push("message.groups", "message.im", "message.mpim");
  }

  return [
    "_metadata:",
    "  major_version: 1",
    "  minor_version: 1",
    "display_information:",
    `  name: ${quote(options.appName)}`,
    '  description: "Managed-agents Slack bot for Collateralist"',
    '  background_color: "#111827"',
    "features:",
    "  bot_user:",
    `    display_name: ${quote(options.appName)}`,
    "    always_online: false",
    "oauth_config:",
    "  scopes:",
    "    bot:",
    yamlList(botScopes, 6),
    "settings:",
    "  event_subscriptions:",
    `    request_url: ${quote(options.requestUrl)}`,
    "    bot_events:",
    yamlList(botEvents, 6),
    "  interactivity:",
    "    is_enabled: false",
    "  org_deploy_enabled: false",
    "  socket_mode_enabled: false",
    "  token_rotation_enabled: false",
  ].join("\n");
}

export function printManifestNextSteps(options: SlackManifestOptions) {
  console.log("");
  console.log("Next steps");
  console.log(`1. Open https://api.slack.com/apps and choose "Create New App" -> "From an app manifest".`);
  console.log(`2. Paste ${options.output} into Slack's manifest editor.`);
  console.log("3. Install the app to your workspace.");
  console.log("4. Copy the bot token and signing secret into .env.local.");
  console.log("5. Run npm run slack:whoami to fetch SLACK_TEAM_ID and SLACK_BOT_USER_ID.");
  console.log("6. Start the server with npm run dev and mention the bot in Slack.");
  if (!options.publicOnly) {
    console.log("7. This manifest includes public channels, private channels, DMs, and group DMs for easier testing.");
  }
}

function main() {
  const options = buildOptions();
  const manifest = buildManifest(options);
  const outputPath = path.resolve(process.cwd(), options.output);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${manifest}\n`, "utf8");

  console.log(`Wrote Slack app manifest to ${outputPath}`);
  console.log(`Request URL: ${options.requestUrl}`);
  printManifestNextSteps(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

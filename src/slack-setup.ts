import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";
import { upsertEnvValues } from "./lib/env-file.js";
import { fetchSlackIdentity } from "./slack-auth-test.js";
import { buildManifest, normalizeBaseUrl, printManifestNextSteps, type SlackManifestOptions } from "./slack-manifest.js";

dotenv.config({ path: ".env.local" });

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

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function askRequired(rl: readline.Interface, prompt: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` (${fallback})` : "";
  while (true) {
    const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
    const value = answer || fallback || "";
    if (value) {
      return value;
    }
  }
}

async function askOptional(rl: readline.Interface, prompt: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || fallback || "";
}

async function askYesNo(rl: readline.Interface, prompt: string, fallback = false): Promise<boolean> {
  const label = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${prompt} [${label}]: `)).trim().toLowerCase();
  if (!answer) {
    return fallback;
  }

  return answer === "y" || answer === "yes";
}

function writeManifest(options: SlackManifestOptions): string {
  const outputPath = path.resolve(process.cwd(), options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${buildManifest(options)}\n`, "utf8");
  return outputPath;
}

async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("Collateralist Slack setup");
    console.log("This installer generates the Slack manifest, updates .env.local, and validates the Slack bot token.");
    console.log("");

    const appName =
      readFlag("--app-name") ??
      (await askRequired(rl, "Slack app display name", process.env.SLACK_APP_NAME || "Collateralist"));
    const requestUrl =
      readFlag("--request-url") ??
      (await askRequired(
        rl,
        "Public HTTPS request URL for Slack events",
        process.env.SLACK_MANIFEST_REQUEST_URL || ""
      ));
    const normalizedRequestUrl = normalizeBaseUrl(requestUrl);
    const publicOnly = hasFlag("--public-only")
      ? true
      : await askYesNo(rl, "Limit the app to public channels only", false);

    const manifestOptions: SlackManifestOptions = {
      appName,
      requestUrl: normalizedRequestUrl,
      output: ".data/slack-app-manifest.yaml",
      publicOnly,
    };

    const manifestPath = writeManifest(manifestOptions);
    console.log("");
    console.log(`Manifest written to ${manifestPath}`);
    printManifestNextSteps(manifestOptions);
    console.log("");

    const openSlackPage = await askYesNo(rl, "Open the Slack apps page in your browser", false);
    if (openSlackPage) {
      output.write("Open this URL manually if your terminal cannot launch a browser:\nhttps://api.slack.com/apps\n\n");
    }

    console.log("After you create and install the app, collect the bot token and signing secret.");
    const botToken = await askOptional(rl, "Slack bot token", process.env.SLACK_BOT_TOKEN);
    const signingSecret = await askOptional(rl, "Slack signing secret", process.env.SLACK_SIGNING_SECRET);

    const envUpdates: Record<string, string> = {};
    if (botToken) {
      envUpdates.SLACK_BOT_TOKEN = botToken;
    }
    if (signingSecret) {
      envUpdates.SLACK_SIGNING_SECRET = signingSecret;
    }

    if (Object.keys(envUpdates).length > 0) {
      const envPath = upsertEnvValues(envUpdates);
      console.log(`Updated ${envPath}`);
    }

    if (botToken) {
      console.log("");
      console.log("Validating Slack token...");
      const identity = await fetchSlackIdentity(botToken);
      const envPath = upsertEnvValues({
        SLACK_TEAM_ID: identity.teamId,
        SLACK_BOT_USER_ID: identity.botUserId,
      });
      console.log(`Slack token is valid for team ${identity.teamName ?? identity.teamId}.`);
      console.log(`Updated ${envPath} with SLACK_TEAM_ID and SLACK_BOT_USER_ID.`);
    } else {
      console.log("");
      console.log("Skipped Slack token validation because no bot token was provided.");
    }

    console.log("");
    console.log("Setup summary");
    console.log(`- app: ${appName}`);
    console.log(`- request URL: ${normalizedRequestUrl}`);
    console.log(`- scopes mode: ${publicOnly ? "public channels only" : "all conversation types for testing"}`);
    if (botToken) {
      console.log(`- bot token saved: ${maskSecret(botToken)}`);
    }
    if (signingSecret) {
      console.log(`- signing secret saved: ${maskSecret(signingSecret)}`);
    }
    console.log("");
    console.log("Next steps");
    console.log("1. Fill in the Anthropic and Moda MCP values in .env.local.");
    console.log("2. Run npm run auth:moda if you still need Moda MCP OAuth credentials.");
    console.log("3. Start the app with npm run dev.");
    console.log("4. Mention the bot in Slack and confirm it reacts with :eyes: and replies in-thread.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

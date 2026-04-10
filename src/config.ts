import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  slackBotToken: required("SLACK_BOT_TOKEN"),
  slackSigningSecret: required("SLACK_SIGNING_SECRET"),
  slackTeamId: process.env.SLACK_TEAM_ID ?? "",
  slackBotUserId: process.env.SLACK_BOT_USER_ID ?? "",
  slackAllowedChannelIds: (process.env.SLACK_ALLOWED_CHANNEL_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  slackAllowedUserIds: (process.env.SLACK_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  stateFile: path.resolve(process.cwd(), process.env.STATE_FILE ?? ".data/state.json"),
  managedAgentName: process.env.MANAGED_AGENT_NAME ?? "Collateralist",
  managedAgentModel: process.env.MANAGED_AGENT_MODEL ?? "claude-sonnet-4-6",
  managedAgentEnvName: process.env.MANAGED_AGENT_ENV_NAME ?? "slack-moda-cloud",
  managedAgentVaultName: process.env.MANAGED_AGENT_VAULT_NAME ?? "slack-moda-mcp",
  modaMcpServerUrl: process.env.MODA_MCP_SERVER_URL ?? "https://mcp.moda.app",
  modaOrgId: process.env.MODA_ORG_ID ?? "",
  modaTeamId: process.env.MODA_TEAM_ID ?? "",
  modaAuthMode: process.env.MODA_MCP_AUTH_MODE ?? "oauth",
  modaAccessToken: process.env.MODA_MCP_ACCESS_TOKEN ?? "",
  modaRefreshToken: process.env.MODA_MCP_REFRESH_TOKEN ?? "",
  modaClientId: process.env.MODA_MCP_CLIENT_ID ?? "",
  modaClientSecret: process.env.MODA_MCP_CLIENT_SECRET ?? "",
  modaTokenEndpoint: process.env.MODA_MCP_TOKEN_ENDPOINT ?? "",
  modaScope: process.env.MODA_MCP_SCOPE ?? "",
  modaResource: process.env.MODA_MCP_RESOURCE ?? "",
  modaExpiresAt: process.env.MODA_MCP_EXPIRES_AT ?? "",
  modaTokenEndpointAuth: process.env.MODA_MCP_TOKEN_ENDPOINT_AUTH ?? "client_secret_post",
  modaBearerToken: process.env.MODA_MCP_BEARER_TOKEN ?? "",
};

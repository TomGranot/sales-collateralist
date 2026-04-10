import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsCredential } from "@anthropic-ai/sdk/resources/beta/vaults/credentials.js";
import { config } from "../config.js";
import { AGENT_SYSTEM_PROMPT } from "./agent-prompt.js";
import { logger } from "./logger.js";
import { stateStore } from "./state.js";
import type { AgentResponsePayload, PersistentState, ThreadState } from "../types.js";

const MCP_SERVER_NAME = "moda";

function buildModaCredential() {
  if (config.modaAuthMode === "oauth") {
    if (!config.modaAccessToken || !config.modaClientId || !config.modaRefreshToken || !config.modaTokenEndpoint) {
      throw new Error(
        "OAuth mode requires MODA_MCP_ACCESS_TOKEN, MODA_MCP_REFRESH_TOKEN, MODA_MCP_CLIENT_ID, and MODA_MCP_TOKEN_ENDPOINT."
      );
    }

    if (
      (config.modaTokenEndpointAuth === "client_secret_basic" ||
        config.modaTokenEndpointAuth === "client_secret_post") &&
      !config.modaClientSecret
    ) {
      throw new Error("OAuth token endpoint auth requires MODA_MCP_CLIENT_SECRET.");
    }

    const tokenEndpointAuth =
      config.modaTokenEndpointAuth === "client_secret_basic"
        ? {
            type: "client_secret_basic" as const,
            client_secret: config.modaClientSecret,
          }
        : config.modaTokenEndpointAuth === "none"
          ? { type: "none" as const }
          : {
              type: "client_secret_post" as const,
              client_secret: config.modaClientSecret,
            };

    return {
      auth: {
        type: "mcp_oauth" as const,
        access_token: config.modaAccessToken,
        mcp_server_url: config.modaMcpServerUrl,
        expires_at: config.modaExpiresAt || null,
        refresh: {
          client_id: config.modaClientId,
          refresh_token: config.modaRefreshToken,
          token_endpoint: config.modaTokenEndpoint,
          token_endpoint_auth: tokenEndpointAuth,
          scope: config.modaScope || null,
          resource: config.modaResource || null,
        },
      },
      display_name: "Moda MCP OAuth",
    };
  }

  if (!config.modaBearerToken) {
    throw new Error("static_bearer mode requires MODA_MCP_BEARER_TOKEN.");
  }

  return {
    auth: {
      type: "static_bearer" as const,
      token: config.modaBearerToken,
      mcp_server_url: config.modaMcpServerUrl,
    },
    display_name: "Moda MCP Bearer",
  };
}

function credentialAuthType() {
  return config.modaAuthMode === "oauth" ? "mcp_oauth" : "static_bearer";
}

function threadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

function sanitizeFilename(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "moda-export";
}

function normalizeUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function extractJson(text: string): AgentResponsePayload {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Agent did not return JSON: ${trimmed}`);
  }

  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as AgentResponsePayload;
  if (!parsed.summary) {
    throw new Error("Agent JSON is missing summary.");
  }
  return parsed;
}

export class ManagedSlackModaAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async bootstrap(): Promise<void> {
    const state = await stateStore.read();

    state.bootstrap.environmentId = await this.ensureEnvironment(state);
    state.bootstrap.agentId = await this.ensureAgent(state);
    state.bootstrap.vaultId = await this.ensureVault(state);
    state.bootstrap.credentialId = await this.ensureModaCredential(state);

    await stateStore.write(state);
  }

  private async ensureEnvironment(state: PersistentState): Promise<string> {
    if (state.bootstrap.environmentId) {
      return state.bootstrap.environmentId;
    }

    const environment = await this.client.beta.environments.create({
      name: config.managedAgentEnvName,
      description: "Cloud environment for the Slack Moda managed agent",
      config: {
        type: "cloud",
        networking: {
          type: "limited",
          allow_mcp_servers: true,
          allow_package_managers: false,
          allowed_hosts: [],
        },
        packages: {
          type: "packages",
          apt: [],
          cargo: [],
          gem: [],
          go: [],
          npm: [],
          pip: [],
        },
      },
    });

    logger.info("Created managed-agents environment", { environmentId: environment.id });
    return environment.id;
  }

  private async ensureAgent(state: PersistentState): Promise<string> {
    if (state.bootstrap.agentId) {
      return state.bootstrap.agentId;
    }

    const agent = await this.client.beta.agents.create({
      name: config.managedAgentName,
      description: "Slack-based Moda collateral assistant using Moda MCP",
      model: config.managedAgentModel,
      system: AGENT_SYSTEM_PROMPT,
      mcp_servers: [{ type: "url", name: MCP_SERVER_NAME, url: config.modaMcpServerUrl }],
      tools: [
        {
          type: "mcp_toolset",
          mcp_server_name: MCP_SERVER_NAME,
          default_config: {
            enabled: true,
            permission_policy: { type: "always_allow" },
          },
        },
      ],
    });

    logger.info("Created managed agent", { agentId: agent.id });
    return agent.id;
  }

  private async ensureVault(state: PersistentState): Promise<string> {
    if (state.bootstrap.vaultId) {
      return state.bootstrap.vaultId;
    }

    const vault = await this.client.beta.vaults.create({
      display_name: config.managedAgentVaultName,
    });

    logger.info("Created vault", { vaultId: vault.id });
    return vault.id;
  }

  private async ensureModaCredential(state: PersistentState): Promise<string> {
    if (!state.bootstrap.vaultId) {
      throw new Error("Vault must exist before creating credentials.");
    }

    const desired = buildModaCredential();
    const credentials: BetaManagedAgentsCredential[] = [];
    for await (const credential of this.client.beta.vaults.credentials.list(state.bootstrap.vaultId, {
      include_archived: false,
    })) {
      credentials.push(credential);
    }

    const modaMcpUrl = normalizeUrl(config.modaMcpServerUrl);
    const existing = credentials.find(
      (credential) =>
        credential.archived_at === null &&
        normalizeUrl(credential.auth.mcp_server_url) === modaMcpUrl
    );

    if (existing) {
      if (existing.id === state.bootstrap.credentialId && existing.auth.type === credentialAuthType()) {
        logger.info("Reusing existing Moda MCP credential", { credentialId: existing.id });
        return existing.id;
      }

      await this.client.beta.vaults.credentials.archive(existing.id, {
        vault_id: state.bootstrap.vaultId,
      });
      logger.info("Archived existing Moda MCP credential", { credentialId: existing.id });
    }

    const created = await this.client.beta.vaults.credentials.create(state.bootstrap.vaultId, desired);
    logger.info("Created Moda MCP credential", { credentialId: created.id });
    return created.id;
  }

  private async ensureSession(channel: string, threadTs: string, requesterUserId: string, requesterName: string): Promise<ThreadState> {
    const key = threadKey(channel, threadTs);
    const current = await stateStore.getThread(key);
    if (current) {
      return current;
    }

    const state = await stateStore.read();
    if (!state.bootstrap.agentId || !state.bootstrap.environmentId || !state.bootstrap.vaultId) {
      throw new Error("Managed agent bootstrap is incomplete.");
    }

    const session = await this.client.beta.sessions.create({
      agent: state.bootstrap.agentId,
      environment_id: state.bootstrap.environmentId,
      vault_ids: [state.bootstrap.vaultId],
      title: `Slack ${channel} ${threadTs}`,
      metadata: {
        slack_channel: channel,
        slack_thread_ts: threadTs,
        requester_user_id: requesterUserId,
        requester_name: requesterName,
      },
    });

    const now = new Date().toISOString();
    const threadState: ThreadState = {
      channel,
      threadTs,
      sessionId: session.id,
      requesterUserId,
      requesterName,
      createdAt: now,
      updatedAt: now,
    };

    await stateStore.update((draft) => {
      draft.threads[key] = threadState;
    });

    logger.info("Created managed-agent session for thread", { sessionId: session.id, channel, threadTs });
    return threadState;
  }

  async handleSlackMessage(input: {
    channel: string;
    threadTs: string;
    requesterUserId: string;
    requesterName: string;
    text: string;
  }): Promise<AgentResponsePayload> {
    const thread = await this.ensureSession(
      input.channel,
      input.threadTs,
      input.requesterUserId,
      input.requesterName
    );

    const existingEvents = new Set<string>();
    for await (const event of this.client.beta.sessions.events.list(thread.sessionId, { order: "asc" })) {
      existingEvents.add(event.id);
    }

    const prompt = [
      `Slack requester: ${input.requesterName} (${input.requesterUserId})`,
      `Slack channel: ${input.channel}`,
      `Slack thread_ts: ${input.threadTs}`,
      "",
      "User request:",
      input.text.trim(),
    ].join("\n");

    await this.client.beta.sessions.events.send(thread.sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: prompt }],
        },
      ],
    });

    const response = await this.waitForTurnCompletion(thread.sessionId, existingEvents);

    await stateStore.update((draft) => {
      const key = threadKey(input.channel, input.threadTs);
      const current = draft.threads[key];
      if (!current) {
        return;
      }

      current.updatedAt = new Date().toISOString();
      if (response.primary_canvas?.id) {
        current.lastCanvasId = response.primary_canvas.id;
        current.lastCanvasName = response.primary_canvas.name;
      }
    });

    return response;
  }

  async handleLocalPrompt(input: { sessionKey: string; requesterName: string; text: string }): Promise<AgentResponsePayload> {
    const syntheticChannel = "local-test";
    const syntheticUserId = "local-user";
    const thread = await this.ensureSession(
      syntheticChannel,
      input.sessionKey,
      syntheticUserId,
      input.requesterName
    );

    const existingEvents = new Set<string>();
    for await (const event of this.client.beta.sessions.events.list(thread.sessionId, { order: "asc" })) {
      existingEvents.add(event.id);
    }

    const prompt = [
      `Requester: ${input.requesterName} (${syntheticUserId})`,
      `Source: local CLI harness`,
      `Synthetic thread key: ${input.sessionKey}`,
      "",
      "User request:",
      input.text.trim(),
    ].join("\n");

    await this.client.beta.sessions.events.send(thread.sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: prompt }],
        },
      ],
    });

    const response = await this.waitForTurnCompletion(thread.sessionId, existingEvents);

    await stateStore.update((draft) => {
      const key = threadKey(syntheticChannel, input.sessionKey);
      const current = draft.threads[key];
      if (!current) {
        return;
      }

      current.updatedAt = new Date().toISOString();
      if (response.primary_canvas?.id) {
        current.lastCanvasId = response.primary_canvas.id;
        current.lastCanvasName = response.primary_canvas.name;
      }
    });

    return response;
  }

  private async waitForTurnCompletion(sessionId: string, existingEvents: Set<string>): Promise<AgentResponsePayload> {
    const startedAt = Date.now();
    let latestAgentMessage = "";

    while (Date.now() - startedAt < 6 * 60 * 1000) {
      let idleReached = false;

      for await (const event of this.client.beta.sessions.events.list(sessionId, { order: "asc" })) {
        if (existingEvents.has(event.id)) {
          continue;
        }

        existingEvents.add(event.id);

        if (event.type === "agent.message") {
          latestAgentMessage = event.content.map((block) => block.text).join("\n");
        }

        if (event.type === "session.error") {
          throw new Error(`Managed agent session error: ${event.error.type} ${event.error.message}`);
        }

        if (event.type === "session.status_terminated") {
          if (!latestAgentMessage) {
            throw new Error("Session terminated before producing a response.");
          }
          return extractJson(latestAgentMessage);
        }

        if (event.type === "session.status_idle") {
          if (event.stop_reason.type !== "end_turn") {
            throw new Error(`Session paused unexpectedly with stop reason: ${event.stop_reason.type}`);
          }
          idleReached = true;
        }
      }

      if (idleReached) {
        if (!latestAgentMessage) {
          throw new Error("Agent finished without a final message.");
        }
        return extractJson(latestAgentMessage);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Timed out waiting for managed agent turn to finish.");
  }
}

export function buildFallbackErrorPayload(error: unknown): AgentResponsePayload {
  const message = error instanceof Error ? error.message : String(error);
  return {
    summary: `I hit an error while working with Moda: ${message}`,
    exports: [],
    assets: [],
    follow_up: "Check the server logs and MCP credentials, then retry.",
    primary_canvas: null,
  };
}

export function normalizeExports(payload: AgentResponsePayload): AgentResponsePayload {
  if (!payload.exports) {
    return payload;
  }

  payload.exports = payload.exports.map((item) => ({
    ...item,
    filename: item.filename || `${sanitizeFilename(item.title)}.pdf`,
  }));

  return payload;
}

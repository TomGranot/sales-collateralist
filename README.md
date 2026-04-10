# Collateralist

Collateralist is a Slack-to-Moda service built on Anthropic Managed Agents and Moda MCP.

The core idea is simple: a rep asks for collateral in Slack, a managed agent handles the reasoning and tool use, Moda MCP does the asset work, and the app sends the result back into the same thread.

Useful links:

- [Moda](https://moda.app)
- [Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
- [Moda MCP getting started](https://docs.moda.app/mcp/getting-started)

## What it can do

- answer free-form questions about collateral in a Moda workspace
- list one-pagers, agents, lists, and related canvases
- export canvases to PDF
- clone and personalize a canvas before exporting the updated version
- keep context per Slack thread through a persistent managed-agent session

## How it works

1. A user mentions the bot in Slack or continues an existing bot thread.
2. The server maps that Slack thread to a persistent Anthropic Managed Agents session.
3. Claude uses Moda MCP tools inside that session.
4. The server downloads any export URLs and uploads the resulting PDF back to Slack.

The server stays intentionally thin. It owns the security boundary and Slack plumbing, while the managed agent owns the conversational workflow and tool orchestration.

## Architecture

- Anthropic Managed Agents for session memory and tool use
- Anthropic Vaults for Moda MCP runtime credentials
- Moda remote MCP for search, clone, update, and export actions
- Slack Events API and Slack Web API for the chat interface
- Node.js + TypeScript + Express for the service layer

## Security model

- Slack signature verification is required on every incoming webhook request.
- `SLACK_TEAM_ID` can be enforced to limit events to a specific workspace.
- Optional allowlists are available with `SLACK_ALLOWED_CHANNEL_IDS` and `SLACK_ALLOWED_USER_IDS`.
- Moda credentials are attached through Anthropic Vaults at runtime instead of being sent from Slack.
- `.env.local` is for local development only and must never be committed.

## Quick start

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Configure Slack

```bash
npm run slack:setup
```

That setup flow generates a Slack manifest, helps you install the app, and can write the Slack values into `.env.local`.

If you want the lower-level commands directly:

```bash
npm run slack:manifest -- --request-url https://your-service.example.com/
npm run slack:whoami
```

### 3. Authenticate Moda MCP

```bash
npm run auth:moda
```

This runs the Moda OAuth flow for the hosted MCP server and writes the required OAuth fields into `.env.local`.

### 4. Validate locally before Slack

```bash
npm run local:test -- --prompt "list all one-pagers"
```

Use a stable session key to simulate a Slack thread:

```bash
npm run local:test -- --session rep-alex --prompt "find the enterprise one-pager"
npm run local:test -- --session rep-alex --prompt "update it for Alex Johnson and export a PDF"
```

To verify that export URLs are actually downloadable:

```bash
npm run local:test -- --prompt "export the latest enterprise one-pager to PDF" --download
```

### 5. Run the server

```bash
npm run dev
```

## Required environment variables

Core:

- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_TEAM_ID`
- `SLACK_BOT_USER_ID`

Moda MCP OAuth:

- `MODA_MCP_AUTH_MODE=oauth`
- `MODA_MCP_ACCESS_TOKEN`
- `MODA_MCP_REFRESH_TOKEN`
- `MODA_MCP_CLIENT_ID`
- `MODA_MCP_CLIENT_SECRET`
- `MODA_MCP_TOKEN_ENDPOINT`
- `MODA_MCP_RESOURCE`

Optional:

- `SLACK_ALLOWED_CHANNEL_IDS`
- `SLACK_ALLOWED_USER_IDS`
- `MODA_MCP_SCOPE`
- `MODA_MCP_EXPIRES_AT`
- `MODA_MCP_TOKEN_ENDPOINT_AUTH`

See `.env.example` for the full template.

## Local state

Bootstrap IDs and Slack thread mappings are stored in:

```text
.data/state.json
```

That state file can contain operational IDs for your Anthropic environment, agent, vault, credential, and thread mappings. It should stay local to the runtime environment.

## Deployment

Render is the default target. This repo includes a `render.yaml` blueprint for a single web service.

Recommended flow:

1. Push the repo to GitHub.
2. Create a Render Blueprint from the repo.
3. Fill in the secret environment variables in Render.
4. Deploy the service.
5. Use the Render URL as the Slack Events request URL.

Important:

- Use real Moda MCP OAuth values in production, not a Moda REST API key.
- If Moda MCP credentials expire or rotate, update the Render environment variables.
- Test the Moda path locally before blaming Slack. Most integration issues show up there first.

## Useful commands

```bash
npm run dev
npm run slack:setup
npm run slack:manifest -- --request-url https://your-service.example.com/
npm run slack:whoami
npm run auth:moda
npm run local:test -- --prompt "list all agents"
npm run build
npm run typecheck
```

## Key links

- [Anthropic Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Anthropic MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector)
- [Anthropic Vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- [Moda MCP getting started](https://docs.moda.app/mcp/getting-started)
- [Moda API docs](https://docs.moda.app/api)
- [Slack app management](https://api.slack.com/apps)
- [Slack Events API](https://api.slack.com/apis/events-api)
- [Slack request signing](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Render docs](https://render.com/docs)

# AGENTS.md

This repo is a standalone Slack-to-Moda service built on Anthropic Managed Agents and Moda MCP.

## What matters

- Slack webhook server: `src/server.ts`
- Slack app setup helpers: `src/slack-manifest.ts` and `src/slack-auth-test.ts`
- Anthropic bootstrap and session orchestration: `src/lib/anthropic.ts`
- Moda MCP OAuth bootstrap helper: `src/auth-moda.ts`
- Local non-Slack test harness: `src/local-test.ts`
- Runtime config: `src/config.ts`

## Expected workflow for agents

1. Start with the local harness, not Slack.
2. Confirm Moda MCP auth works with `npm run local:test`.
3. Only after local success, validate Slack webhook behavior.
4. Prefer the repo-local Slack setup skill at `.codex/skills/slack-bot-setup/SKILL.md` when wiring a new Slack app.
5. Preserve the security model:
   - Slack signature verification stays mandatory
   - `SLACK_TEAM_ID` stays enforced
   - Moda credentials stay in Anthropic Vaults for runtime use

## Commands

```bash
npm install
npm run slack:manifest -- --request-url https://your-service.example.com/
npm run slack:whoami
npm run auth:moda
npm run local:test -- --prompt "list all one-pagers"
npm run typecheck
npm run build
npm run dev
```

## Editing rules

- Keep this repo deployable as a standalone service.
- Prefer fixing behavior in the managed-agents path instead of reintroducing direct Moda REST orchestration.
- If changing Slack behavior, avoid broadening event intake without a clear security reason.
- If changing MCP auth, keep URLs normalized to avoid duplicate Anthropic vault credentials.

## Deployment

- Render is the target deployment platform.
- `render.yaml` is in this repo root.
- The deployed service must use environment variables. Do not commit `.env.local` or any runtime secrets.

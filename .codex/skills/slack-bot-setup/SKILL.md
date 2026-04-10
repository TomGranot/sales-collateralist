---
name: slack-bot-setup
description: Use when setting up or debugging the Slack app for Collateralist. Generates the Slack app manifest, walks through installation and env wiring, and helps troubleshoot Slack event, scope, signing-secret, team-id, and bot-id issues.
---

# Slack Bot Setup

Use this skill for the Collateralist repo when the goal is to create, install, or debug the Slack bot.

## Workflow

1. Run the installer first:

```bash
npm run slack:setup
```

This script:

- asks for the Slack app name
- asks for the public request URL
- generates `.data/slack-app-manifest.yaml`
- tells the user exactly where to paste it in Slack
- can write `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` into `.env.local`
- validates the bot token
- writes `SLACK_TEAM_ID` and `SLACK_BOT_USER_ID` automatically

2. If the user wants a non-interactive flow, use:

```bash
npm run slack:manifest -- --request-url https://your-service.example.com/
npm run slack:whoami
```

3. Start the service:

```bash
npm run dev
```

4. Validate in Slack:

- mention the bot in a channel
- confirm the server returns `200`
- confirm the bot reacts with `:eyes:`
- confirm the thread gets either a status message or a result

## Troubleshooting

- `Invalid Slack signature`: verify the Request URL points to the correct deployment and that `SLACK_SIGNING_SECRET` matches the installed app.
- `Unexpected Slack team`: rerun `npm run slack:whoami` and update `SLACK_TEAM_ID`.
- Bot does not respond to mentions: confirm the app was reinstalled after manifest changes and that `SLACK_BOT_USER_ID` is populated.
- Replies in threads are ignored: confirm the manifest includes the right `message.*` events for the conversation type you are testing.
- Files do not upload: verify `files:write` is still present in the bot scopes.

## Operating Rules

- Prefer `npm run slack:setup` over manually editing Slack settings or `.env.local`.
- Prefer rerunning the installer or manifest generator instead of hand-editing Slack settings one by one.
- Prefer `npm run slack:whoami` over manually guessing bot ids from the Slack UI.
- If setup still fails, inspect app logs and compare them with `src/server.ts` and `src/lib/slack.ts` before changing scopes.

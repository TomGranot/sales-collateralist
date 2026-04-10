# Security

If you discover a security issue, do not open a public GitHub issue with exploit details, tokens, or screenshots that contain secrets.

Please report it privately to the repository owner through a direct channel first.

## Operational guidance

- Treat `.env.local` as local-only and never commit it.
- Rotate any exposed Anthropic, Slack, or Moda credentials immediately.
- If a secret is committed, revoke or rotate it first, then remove it from git history.
- Prefer Anthropic Vaults for Moda MCP runtime access instead of moving credentials through Slack or client-side code.

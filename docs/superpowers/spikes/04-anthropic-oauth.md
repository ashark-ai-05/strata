# Spike 04: Anthropic OAuth Public Availability

**Status:** Complete · 2026-05-01
**Decision:** no-go

## Question
Is Anthropic's OAuth flow publicly available for third-party desktop apps,
or restricted to Anthropic's own clients?

## Method
1. Searched docs.anthropic.com (redirects to platform.claude.com) for OAuth-related documentation.
2. Inspected Claude Code's local config for client_id patterns.
3. Reviewed Anthropic SDK READMEs for auth flow documentation.
4. Web-searched for community signals on third-party OAuth.
5. (Pending user verification) Anthropic Console UI inspection.

## Observations

### Documentation findings

- **https://platform.claude.com/docs/en/api/overview** (checked 2026-05-01): Authentication section documents only `x-api-key` header auth. No OAuth endpoints, no client registration, no third-party auth flows mentioned. Prerequisites listed as "A Claude Console account" + "An API key".
- **https://platform.claude.com/docs/en/release-notes/overview** (checked 2026-05-01): Scanned full release history back to mid-2024. Zero mentions of a public OAuth endpoint for third-party apps. The only OAuth mention in release notes is "Claude in Microsoft Foundry" (Nov 18, 2025) — OAuth is Azure's IAM layer, not an Anthropic-issued OAuth flow for external clients.
- **https://platform.claude.com/docs/en/api/admin-api**: Page returned 404/loading error at time of check.

### Claude Code auth pattern

Claude Code uses OAuth against `claude.ai` / `platform.claude.com` for subscriber auth (Claude Free/Pro/Max). The credentials are Anthropic-issued tokens tied to the user's `claude.ai` subscription account — not a public OAuth client registration. Key signals from `~/.claude/`:

- `cache/changelog.md` contains dozens of `claude auth login` OAuth references — this is the user-facing `claude.ai` subscriber login, not an open third-party OAuth server.
- No `client_id` visible in Claude Code's own credential files (sessions, backups, downloads) — confirming the OAuth client registration is not public/discoverable.
- The MCP auth reference at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/mcp-server-dev/skills/build-mcp-server/references/auth.md` explicitly states that `oauth_anthropic_creds` (where Anthropic holds the client_id/secret) requires contacting `mcp-review@anthropic.com` — confirming it is a partner program, not a public self-service registration.

### SDK docs

- `anthropics/anthropic-sdk-typescript` README: auth is `apiKey: process.env['ANTHROPIC_API_KEY']` — API key only, no OAuth.
- `anthropics/anthropic-sdk-python` README: same pattern, API key only.
- No OAuth client registration path mentioned in either SDK.

### Community signals

- **The Register, 2026-02-20** — "Anthropic clarifies ban on third-party tool access to Claude": Anthropic updated its compliance page to state "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted." OAuth is explicitly reserved for Claude Code and Claude.ai. Source: https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/
- **Hacker News, 2026-02** — "Anthropic officially bans using subscription auth for third party use": Community confirmed enforcement of the ban; GitHub issue `anthropics/claude-code#28091` documents the blocking of `sk-ant-oat01-*` workspace tokens from third-party clients. Source: https://news.ycombinator.com/item?id=47069299
- **Medium, @em.mcconnell, Mar 2026** — "The Missing Piece in Anthropic's Ecosystem: Third-Party OAuth": Author confirms "Anthropic doesn't have a sanctioned OAuth flow for third-party applications" and describes the manual API-key-paste workaround developers must currently use. Source: https://medium.com/@em.mcconnell/the-missing-piece-in-anthropics-ecosystem-third-party-oauth-ccb5addb8810
- **Lobste.rs** — "Anthropic blocks third-party tools using Claude Code OAuth tokens": corroborates the enforcement story. Source: https://lobste.rs/s/mhgog9/anthropic_blocks_third_party_tools_using

### Anthropic Console
**Requires user verification** — see "Open follow-ups" below. Based on Steps 1–4 the Console check is unlikely to reveal a self-service OAuth registration page (there is no such page documented anywhere), but the user should confirm.

## Outcome

As of May 2026, Anthropic has no public OAuth flow for third-party desktop apps. The OAuth tokens that Claude Code uses are tied to the user's claude.ai subscription account and are explicitly restricted to Anthropic's own clients (Claude Code, Claude.ai). Anthropic actively enforced this in February 2026 by blocking third-party use of subscriber OAuth tokens and updating its Terms of Service. The only documented authentication path for third-party developers is an API key from the Console. A partner-level `oauth_anthropic_creds` mode exists for MCP directory entries but requires contacting `mcp-review@anthropic.com` — it is not self-service and is not available to arbitrary desktop apps. The decision for llm-wiki v1 is therefore **no-go** on OAuth: implement API-key-only auth for Anthropic and revisit if/when Anthropic opens a public third-party OAuth registration.

## Implications for v1

- LLM provider config schema for Anthropic:
  - **no-go** applies: support `auth.type = 'apiKey'` only for the Anthropic provider
  - Revisit OAuth in v1.1 if Anthropic launches a public third-party OAuth program
  - The `apiKey` path aligns with both the official Anthropic SDK (`ANTHROPIC_API_KEY`) and the provider schemas used by AWS Bedrock / Vertex AI / Azure Foundry (those use their respective IAM, not Anthropic OAuth)

## Open follow-ups

1. **Console UI verification (user action required):** Log into https://platform.claude.com, go to Settings → (look for "OAuth applications", "Client registration", or "Developer Apps"). Based on all other evidence there should be no such section, but confirming this removes the last uncertainty.
2. **Monitor Anthropic announcements:** The Medium article from March 2026 argues publicly for Anthropic to add third-party OAuth. Watch for any future `platform.claude.com` release notes announcing an OAuth client registration feature — that would change the decision to `go` for v1.1.

## Artifacts

- (none — research-only spike)

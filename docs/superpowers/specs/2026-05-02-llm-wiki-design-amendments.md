# Design Spec Amendments — Post-Spikes

Amendments to `2026-05-02-llm-wiki-design.md` driven by Plan 0 outcomes.
Each amendment names the affected section and the new decision.

---

## Amendment 1: Anthropic *direct-API* OAuth removed; OAuth re-enters via Claude Agent SDK

**Affected sections:** §1 (v1 ships — LLM layer bullet), §5 (Two-environment
reality table; LLM provider abstraction table), §8 (Pre-v1 spikes — spike #4)

**Spike that drove this:** [04 — Anthropic OAuth public availability](../spikes/04-anthropic-oauth.md)
**User direction:** "oauth works with claude sdk. wire that in as well."

### Part A — direct-API OAuth: removed

**Original wording (§1, v1 ships):**

> Anthropic (API key today; OAuth when publicly available)

**New wording:**

> Anthropic direct-API (API key only). OAuth against the public
> Anthropic API is not available to third-party apps; Anthropic's
> Feb 2026 ToS bans third-party use of subscriber OAuth tokens with
> the *direct API*. The OAuth path is preserved via the Claude Agent
> SDK provider — see Part B.

**Original wording (§5, LLM provider table row):**

> | `AnthropicOAuthAdapter`| `model` | OAuth via system browser; tokens in keychain | If/when publicly available                |

**New wording:**

> *(row removed — direct-API OAuth not viable; OAuth lives in the
> Claude Agent SDK adapter instead, see Part B)*

### Part B — Claude Agent SDK: a new `kind: 'agent'` provider with OAuth

A new provider adapter, `ClaudeAgentSdkAdapter`, is added. It uses the
Anthropic Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, formerly
the Claude Code SDK) — the same engine that powers Claude Code.

**New row in §5 LLM provider table:**

| Adapter | Kind | Auth | Notes |
|---|---|---|---|
| `ClaudeAgentSdkAdapter` | `agent` | OAuth (Claude.ai subscriber) **or** `ANTHROPIC_API_KEY` | Uses `@anthropic-ai/claude-agent-sdk`; the SDK owns the agent loop, tool calling, and MCP integration. OAuth is handled inside the SDK; our app never holds the OAuth tokens directly. |

**Why this works where direct-API OAuth doesn't:** the Claude Agent SDK
is Anthropic's own product. OAuth handled inside the SDK is sanctioned
because the SDK is the very surface Anthropic intends OAuth users to
consume. Our app uses the SDK as an opaque agent runtime — we hand it
tasks, it returns structured streaming responses (much like Amp). We
never extract or relay the OAuth tokens to a non-Anthropic surface.

**Implications:**

- v1 ships **two** `kind: 'agent'` providers: `AmpAdapter` and
  `ClaudeAgentSdkAdapter`. The agent-loop branch (§6.5) handles both
  uniformly via the `kind: 'agent'` interface.
- `ClaudeAgentSdkAdapter` becomes the recommended **home profile** when
  the user has a Claude.ai Pro/Max subscription — no API key handling,
  uses existing billing.
- The SDK's MCP integration interacts with our spike-01 question:
  expose vs. hide MCP from the SDK. Apply the same decision that
  spike 01 reaches for Amp; the agent-mode pattern is shared.
- ResultEnvelope contract (§3) extends to apply to `ClaudeAgentSdkAdapter`
  output too — our envelope-parser-with-retry path is reused.

**Reason for revising Amendment 1:** Spike 04's `no-go` finding stands
for the **direct Anthropic API**. But it didn't consider the Claude
Agent SDK as a separate path. The user identified that OAuth-via-SDK
is a sanctioned route, so we add the SDK adapter and revise the
amendment. The SDK-based OAuth is sanctioned by virtue of the SDK
being an Anthropic product; the ToS ban applies to direct-API OAuth
token misuse, not to SDK-internal OAuth.

---

## Amendment 2: Space-agent integration is "hybrid", not "fork"

**Affected sections:** §1 (Vision), §2 (architecture mention), §8 (spike #5)

**Spike that drove this:** [05 — Space-agent fork strategy](../spikes/05-space-agent-fork.md)

**Original wording (§1):**

> Built on a forked space-agent runtime.

**New wording:**

> Built on a patched space-agent base — clone at a pinned upstream commit
> and maintain a small set of patches against `server/jobs/job_runner.js`
> (the only files needing core edits). Most of our work lands as
> drop-in extensions: new modules, YAML widgets/templates, and SKILL.md
> packs.

**Reason:** Spike 05 found space-agent's extension surface (L0/L1/L2
layers, `space.extend()` hooks, YAML widgets, SKILL.md skills) is
rich enough that 8 of 10 required v1 changes drop in cleanly. Only
2 need core edits, and they're in zero-churn files. Hybrid avoids
the maintenance cost of a hard fork while preserving the velocity
of direct edits where extensions can't reach.

---

## Amendment 3: ONNX cold-start mitigation is mandatory, not optional

**Affected sections:** §4 (Initial-sync UX), §5 (embedding provider table)

**Spike that drove this:** [03 — Bundled ONNX viability](../spikes/03-onnx-bundled.md)

**Addition to §4 — Initial-sync UX section:**

Add a step before "Connect MCP servers first":

> **0. Pre-warm the embedder.** On app launch, kick off a background
> embed of a single throw-away string immediately. The first embed call
> takes ~4.5s on M-series Mac CPU; users should never feel this latency.

**Addition to §5 — bundled ONNX row:**

Append: "Cold start ~4.5s; pre-warm on app launch is mandatory."

**Reason:** Spike 03 measured cold-start at 4551 ms (M-series arm64
CPU). Throughput is fine (272 chunks/sec, 5.4× headroom). Without
pre-warming, the first user query after launch would inherit the
~4.5s cold-start, which feels broken. Pre-warming is cheap and
hides this entirely.

---

## Pending amendments (post-Amp-spikes)

The following will be added once spikes 01 and 02 complete:

- **Amendment 4 (pending):** Agent-mode `AgentExecutor` shape — whether
  Amp gets MCP exposed or pre-fetched context (driven by spike 01).
- **Amendment 5 (pending):** ResultEnvelope parser strictness —
  whether retry+fallback is required or strict-mode is acceptable
  (driven by spike 02).

---

*Last updated: 2026-05-02 (after spikes 03, 04, 05; Amendment 1 revised
to add Claude Agent SDK provider with OAuth per user direction).*

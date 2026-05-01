# Design Spec Amendments — Post-Spikes

Amendments to `2026-05-02-llm-wiki-design.md` driven by Plan 0 outcomes.
Each amendment names the affected section and the new decision.

---

## Amendment 1: Anthropic OAuth removed from v1

**Affected sections:** §1 (v1 ships — LLM layer bullet), §5 (Two-environment
reality table; LLM provider abstraction table), §8 (Pre-v1 spikes — spike #4)

**Spike that drove this:** [04 — Anthropic OAuth public availability](../spikes/04-anthropic-oauth.md)

**Original wording (§1, v1 ships):**

> Anthropic (API key today; OAuth when publicly available)

**New wording:**

> Anthropic (API key only). OAuth is not available to third-party apps;
> Anthropic's Feb 2026 ToS update explicitly bans third-party use of
> subscriber OAuth tokens. No v1.x roadmap entry for OAuth.

**Original wording (§5, table row):**

> | `AnthropicOAuthAdapter`| `model` | OAuth via system browser; tokens in keychain | If/when publicly available                |

**New wording:**

> *(row removed — Anthropic OAuth is not viable for third-party apps in
> the foreseeable future; do not build the adapter)*

**Reason:** Spike 04 found three independent confirmations that
Anthropic's OAuth flow is reserved for Anthropic's own clients
(`platform.claude.com`, Claude Code, Claude.ai) and explicitly forbidden
for third-party use as of February 2026. SDK READMEs, official docs, and
news coverage of the ToS update align. Speculative OAuth scaffolding in
v1 would be wasted work.

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

*Last updated: 2026-05-02 (after spikes 03, 04, 05).*

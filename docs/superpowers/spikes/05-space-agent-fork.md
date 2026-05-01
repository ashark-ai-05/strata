# Spike 05: Space-agent Fork Strategy

**Status:** Complete · 2026-05-02
**Decision:** hybrid — pin a known-good upstream commit, maintain a small patch set targeting only core files that cannot be overridden via the extension model

## Question

Fork space-agent and own the changes, or install/embed it and contribute
customizations as external modules?

## Method

- Cloned upstream at commit `9c26f9f` (HEAD of `main`, 2026-05-01)
- Installed with `npm install` (clean, 151 packages, ~1 s)
- Created admin user via CLI, started server on port 3456; verified `302 → /login` response
- Mapped extension points via all 20 AGENTS.md files + module structure under `app/L0/_all/mod/_core/`
- Classified each required v1 change as extension / extension+wiring / fork-required
- Measured upstream activity: commits last 3 months, last 1 month, breaking signals, file churn

## Observations

### Build

- Install: `npm install` succeeded in ~1 s; 151 packages, 1 high-severity vuln (glob deprecation — not blocking).
- Server start: `PORT=3456 node space serve` responded in under 2 s with `HTTP/1.1 302 Found → /login`. No native module issues on macOS arm64.
- Notes: Port 3000 was already in use on the test machine; port override via env var worked without any friction. No build step required — pure ES module Node.js runtime.

### Extension surface

Space-agent is genuinely designed for external extensibility. The `app/L0/_all/mod/` layer is **firmware** (never written at runtime); all customization lands in `L1/` (group) or `L2/` (user) layers, which are a first-class runtime concept. The system uses two complementary seam styles: **HTML extension anchors** (`<x-extension id="some/path">`) and **JS hook functions** (`space.extend(import.meta, async fn)`). Any module placed in a readable layer under `mod/<author>/<repo>/` can contribute `ext/html/<seam>/*.html` and `ext/js/<seam>/*.js` files that compose into existing seams without patching core files.

The `open_router/` module is the canonical example of a new LLM provider added entirely via extension hooks: two JS files that hook `prepareOnscreenAgentApiRequest/end` and `prepareAdminAgentApiRequest/end`, plus a shared `request.js` helper — zero core edits. The `spaces/` module shows that even deep agent-prompt shaping (system prompt sections, transient sections, execution validation) is done through named extension points on `_core/onscreen_agent/llm.js` and `_core/onscreen_agent/execution.js`. New skills are pure metadata files (`SKILL.md` with YAML frontmatter); no core registration code is needed.

The server-side extension surface is more limited: the `server/api/` folder uses a file-based auto-registry (one file = one endpoint, loaded by name), so new API endpoints are pure additions with no core edits needed. The customware layer (`server/lib/customware/`) handles all file permissions, module inheritance, and extension resolution and is explicitly designed to be the single source of truth — but its rules do not need to change for our use case.

Widgets are defined via YAML files under `~/spaces/<id>/widgets/`, rendered by a JS `renderer` function string in each file. New widget types require no registration; they live in the user or group file layer and are replayed by the existing engine. Canvas templates are just sets of widget YAML files that can be copied via `space.spaces.upsertWidgets(...)`.

### Required-change classification

| Required change                                   | Classification        | Notes |
|---------------------------------------------------|-----------------------|-------|
| MCP transport adapter                             | extension+wiring      | Add a new `server/api/mcp_*.js` endpoint (auto-registered) + a frontend store module that calls it. Core `space.api` fetch infrastructure is already in place. Needs a new mod under our `L0` or `L1` and possibly a new `ext/js` hook to inject MCP sources into the agent context. No core edits needed, but wiring a transport into the request path requires a new server endpoint. |
| Source registry + capability introspection        | extension+wiring      | Define a registry module in our `L1/_all/mod/` tree. The agent-prompt transient sections seam (`buildOnscreenAgentTransientSections/end`) is already extensible; we drop in an extension hook. No core edits. Needs a new frontend mod + matching server API. |
| Profile config + activation probe (LLM/embed/sources) | extension+wiring | Can live as a YAML file under `~/conf/` (the existing config path convention) + a headless frontend module that reads it on login via `_core/login_hooks/any_login` extension hook. No core edits; the login hook seam is published. |
| 14 widgets in our catalog                         | extension             | Pure drop-in: each widget is a YAML file with a `renderer` string. Deliver via onboarding preset folder under our mod's `onboarding/examples/` or via a dashboard skill that installs them. Zero core edits. |
| 4 canvas templates                                | extension             | Same as widgets: YAML bundles installed via `space.spaces.upsertWidgets(...)` from an extension hook or skill. No core changes. |
| Cross-source link resolver                        | extension+wiring      | Runs as a headless browser module; inject into agent transient context via `buildOnscreenAgentTransientSections/end` hook. If resolution needs server-side indexing, add a `server/api/link_resolve.js` endpoint (auto-registered). No core edits to agent loop. |
| LLM provider abstraction (model + agent kinds)    | extension+wiring      | The `open_router/` module shows the exact pattern: add `ext/js/.../prepareOnscreenAgentApiRequest/end/our-provider.js`. Config shape follows `~/conf/onscreen-agent.yaml` convention. Wiring = one extension JS file per surface (onscreen + admin). No core edits to `llm.js`. |
| Index orchestrator + indexers                     | fork-required         | Space-agent has no server-side semantic indexing concept. A background job that runs indexers and maintains a search index would need to hook into the server's job runner (`server/jobs/job_runner.js`) or run as a sidecar process. `job_runner.js` does not currently expose an extension API; adding our index jobs requires editing that file or adding a new server-startup hook, neither of which exists as a published seam. |
| Result/Capability/Skill schemas                   | extension             | Our schemas are data-layer artifacts. Define them as TypeScript/JSON schema files in our own module tree. The existing `SKILL.md` convention already provides a lightweight schema for skills. New capability and result types can be defined under our mod without touching core. |
| Bundled ONNX embedder integration                 | extension+wiring      | The embedder process runs as a Node.js child or worker. Wiring it in requires either a new server job or a CLI command. CLI commands (`commands/`) are file-discovered; adding `commands/embed.js` is a pure addition. Server-side wiring to expose embedding as an API endpoint needs a new `server/api/embed.js` (auto-registered). No core edits, but server-startup or job scheduling may need a small hook if we want continuous background indexing. |

Summary counts: **2 fork-required**, **5 extension+wiring**, **3 extension**.

The two fork-required items both relate to the **server-side job/indexing layer**, not to the UI, agent loop, or widget engine. The core agent loop, LLM provider dispatch, widget system, canvas templates, and skill delivery are all cleanly extensible without touching L0 firmware.

### Upstream cadence

- Commits last 3 months: **100**
- Commits last 1 month: **86** (heavy sprint in progress — ~20 commits/week peak)
- Breaking-change signals: 3 commits with "refactor" in message, including one that touched `userSelfInfo` contract and prompt architecture. No `BREAKING` tags.
- High-churn source files (last 3 months, excluding docs):
  - `app/L0/_all/mod/_core/onscreen_agent/store.js` — 23 changes (agent loop — **we do not touch this**)
  - `server/pages/login.html` — 24 changes (login UI — not in our scope)
  - `packaging/desktop/main.js` — 20 changes (Electron host — not in our scope)
  - `package.json` — 19 changes (dependency churn)
  - `server/app.js` — 15 changes (server startup — low risk for us)
  - `app/L0/_all/mod/_core/spaces/store.js` — 15 changes (spaces — we extend, not modify)
  - `app/L0/_all/mod/_core/admin/views/agent/store.js` — 15 changes

The two files we would actually need to touch for the fork-required items (`server/jobs/job_runner.js`) had **0 churn** in the last 3 months — it is a stable, low-churn file. This significantly reduces the merge friction estimate.

## Decision

**Hybrid**: pin a known-good upstream commit, maintain a thin patch set confined to the two server-side files that cannot be reached via the extension model (`server/jobs/job_runner.js` and possibly `server/app.js` startup ordering), and deliver all other v1 functionality as modules and extension hooks in our own `L1/_all/mod/` or `L0` layer. Upstream is active (86 commits/month right now) but the churn is concentrated in areas we do not touch: the Electron host, login shell, and agent chat UI. Our two fork-required touch points live in low-churn, stable server infrastructure. A full fork would mean absorbing 20 commits/week indefinitely; `embed+extend` is insufficient because it leaves the index orchestrator with no clean server integration point. Hybrid gives us freedom to wire the index layer into the server job runner once, while taking all future upstream updates cleanly via `git merge` or cherry-pick against our pinned base.

## Implications for v1

- **Plan 1 (Foundation) starts with:** `git clone` then `git checkout 9c26f9f` to pin our working base, then apply our two small server patches as a committed diff on top
- **Update strategy:** track upstream `main`; merge or cherry-pick monthly, resolving the two patched files manually (they are stable, so conflicts will be rare). Run `node space serve` smoke test after each merge.
- **Risk areas:** `onscreen_agent/store.js` (high churn, but we only hook it via extension points, so upstream changes should not conflict). `package.json` dependency updates may require re-running `npm install`. The `userSelfInfo` contract refactor (seen in churn) is something to watch — our profile config module reads it at login.

## Artifacts

- `spikes/05-space-agent-fork/inspect.sh`
- `spikes/05-space-agent-fork/space-agent/` (gitignored — too large to commit)

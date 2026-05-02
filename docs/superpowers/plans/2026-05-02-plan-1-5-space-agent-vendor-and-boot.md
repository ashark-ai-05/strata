# Plan 1.5 — Space-agent Vendor and Boot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor `agent0ai/space-agent` at a pinned commit, expose it as runnable from this repo via `pnpm setup` and `pnpm dev`, and lay down a `customware/` skeleton with one proof-of-wire extension so we know our customization seam is loaded by the runtime.

**Architecture:** Space-agent is cloned into `vendor/space-agent/` (gitignored — too large to commit, ~150 packages, 24h-stale upstream churn). The pin is recorded as a SHA in `scripts/setup-space-agent.sh`. Our customizations live under `customware/L1/_all/mod/krunal/llm-wiki/` per Spike 05's findings: this directory is passed to space-agent via `CUSTOMWARE_PATH` env var, and space-agent's `customware` runtime layer auto-loads any `ext/html/<seam>/*.html` or `ext/js/<seam>/*.js` files we drop in. A "hello from llm-wiki" admin-banner extension proves the seam is wired without needing to understand the full chat/agent runtime yet.

**Tech Stack:** Node.js (whatever space-agent requires — currently runs on Node 20+; our pnpm scripts add a delegate from `pnpm` to the underlying `node space ...` CLI) · zsh / bash for setup scripts · existing pnpm/TypeScript/Vitest infrastructure for the rest of the repo.

**Pinned upstream commit:** `9c26f9f` (HEAD of `main` on 2026-05-01, per Spike 05). The setup script captures this in a constant.

**References:**
- Spike 05: `docs/superpowers/spikes/05-space-agent-fork.md` — extension model, classification of v1 changes, decision rationale
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §2 (architecture: forked space-agent runtime), §1 (vision: built on space-agent base)
- Spec amendments: `docs/superpowers/specs/2026-05-02-llm-wiki-design-amendments.md` Amendment 2 (hybrid integration, not fork)
- Space-agent README: `spikes/05-space-agent-fork/space-agent/README.md` (already cloned to disk by Spike 05)

**Out of scope (deferred):**
- Wiring our `LLMProvider` adapter into space-agent's chat surface (Plan 1.6 — needs the `prepareOnscreenAgentApiRequest/end/<provider>.js` extension hook, paralleling the upstream `open_router/` module)
- Embedder pre-warm at app launch (Plan 1.6 — needs the `_core/login_hooks/any_login` extension hook)
- Profile config bridge — exposing our `Profile` to space-agent's chat (Plan 1.6 — `~/conf/` YAML hook)
- The two `server/jobs/job_runner.js` patches identified as "fork-required" by Spike 05 (Plan 3 — only needed when indexers ship)
- 14 widgets and 4 canvas templates (Plans 5–7)
- MCP integration (Plan 2)

This plan is intentionally minimal: prove the seam, then build on it.

---

## File structure

### New files

```
scripts/
  setup-space-agent.sh           # idempotent: clone if missing, pin, npm install, create admin
  dev-space-agent.sh             # boots space-agent with CUSTOMWARE_PATH set, signals on exit
customware/
  L1/
    _all/
      mod/
        krunal/
          llm-wiki/
            mod.yaml             # space-agent module manifest (name, owner, description)
            ext/
              html/
                _core/admin/views/index/end/
                  llm-wiki-banner.html   # PROOF-OF-WIRE: a yellow banner saying "Loaded from llm-wiki customware"
__tests__/
  customware.test.ts             # unit-tests the manifest + banner files exist with expected content
```

### Modified files

```
package.json                     # add scripts: setup, dev, dev:check
.gitignore                       # add vendor/ (cloned space-agent is too large to commit)
README.md                        # Setup section: pnpm setup, pnpm dev, what to expect
```

### Files explicitly NOT modified

`src/**`, `__tests__/storage.test.ts`, `__tests__/embedder.test.ts`, `__tests__/provider.test.ts`, `__tests__/config.test.ts`, `__tests__/envelope.test.ts` — Plan 1 and Plan 1' deliverables stay stable. This plan only adds boot/vendor scaffolding.

---

## Task 0: Add `vendor/` to `.gitignore` and configure pnpm scripts

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Update `.gitignore`**

Read the current `.gitignore`. Append (or insert under a "vendored deps" header):

```
# Vendored space-agent runtime (cloned by scripts/setup-space-agent.sh).
# Pinned commit lives in the setup script; do not commit the working tree.
vendor/
```

- [ ] **Step 2: Add `setup`, `dev`, `dev:check` scripts to `package.json`**

Edit `package.json`'s `scripts` section. Existing scripts: `cli`, `test`, `test:watch`, `typecheck`. Add:

```json
"setup": "bash scripts/setup-space-agent.sh",
"dev": "bash scripts/dev-space-agent.sh",
"dev:check": "bash scripts/dev-space-agent.sh --smoke"
```

`dev:check` runs the dev launcher with a `--smoke` flag that exits cleanly after one HTTP probe — used by tests and CI.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add .gitignore package.json
git commit -m "chore: gitignore vendor/ and add space-agent scripts"
```

---

## Task 1: Setup script — clone, pin, install, admin user

**Files:**
- Create: `scripts/setup-space-agent.sh`

This script is idempotent: safe to run multiple times. It clones space-agent if `vendor/space-agent/` is missing, checks out the pinned SHA, installs dependencies, and creates a default admin user.

- [ ] **Step 1: Create `scripts/setup-space-agent.sh`**

```bash
#!/usr/bin/env bash
# Sets up vendor/space-agent/ at a pinned commit and creates a default admin user.
# Idempotent: re-running is safe.

set -euo pipefail

PINNED_SHA="9c26f9f"            # space-agent main HEAD as of 2026-05-01 (per Spike 05)
REPO_URL="https://github.com/agent0ai/space-agent.git"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$PROJECT_ROOT/vendor"
SPACE_AGENT_DIR="$VENDOR_DIR/space-agent"

mkdir -p "$VENDOR_DIR"

if [ ! -d "$SPACE_AGENT_DIR/.git" ]; then
  echo "==> Cloning space-agent into $SPACE_AGENT_DIR"
  git clone "$REPO_URL" "$SPACE_AGENT_DIR"
fi

echo "==> Pinning space-agent to $PINNED_SHA"
cd "$SPACE_AGENT_DIR"
git fetch origin
git checkout "$PINNED_SHA"

if [ ! -d "$SPACE_AGENT_DIR/node_modules" ]; then
  echo "==> Installing space-agent dependencies (this can take ~30s)"
  npm install
else
  echo "==> space-agent node_modules already present (skipping npm install)"
fi

# Create a default admin user if one does not already exist.
# `node space user list` returns non-zero when there are no users; we tolerate that.
USERS_OUT="$(node space user list 2>/dev/null || true)"
if echo "$USERS_OUT" | grep -q "^admin$"; then
  echo "==> Admin user already exists"
else
  echo "==> Creating default admin user (password: change-me-now)"
  node space user create admin \
    --password "change-me-now" \
    --full-name "Admin (llm-wiki dev)" \
    --groups _admin
fi

echo ""
echo "==> Setup complete."
echo "    Space-agent: $SPACE_AGENT_DIR"
echo "    Pinned to:   $PINNED_SHA"
echo "    Run:         pnpm dev"
```

- [ ] **Step 2: Make it executable**

```bash
cd /Users/krunal/Development/llm-wiki
chmod +x scripts/setup-space-agent.sh
```

- [ ] **Step 3: Run it**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm setup
```

Expected (first run):
- Clones into `vendor/space-agent/`
- Pins to `9c26f9f`
- `npm install` produces `~150 packages`
- Creates admin user
- Final line: "Setup complete." with paths

If clone fails (network, GitHub auth), report BLOCKED. If pinned SHA can't be checked out (upstream history rewritten — unlikely but possible), update `PINNED_SHA` to the current `main` HEAD and document it in the commit message.

- [ ] **Step 4: Run it a second time**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm setup
```

Expected: idempotent. Output should say:
- "Pinning space-agent to 9c26f9f" (no clone)
- "node_modules already present (skipping npm install)"
- "Admin user already exists"

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add scripts/setup-space-agent.sh
git commit -m "feat: setup script vendors space-agent at pinned 9c26f9f"
```

---

## Task 2: Dev script — boot space-agent with CUSTOMWARE_PATH

**Files:**
- Create: `scripts/dev-space-agent.sh`

- [ ] **Step 1: Create `scripts/dev-space-agent.sh`**

```bash
#!/usr/bin/env bash
# Boots space-agent in dev mode with our customware/ directory mounted.
# Use --smoke to run a one-shot HTTP probe and exit cleanly (for tests/CI).

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPACE_AGENT_DIR="$PROJECT_ROOT/vendor/space-agent"
CUSTOMWARE="$PROJECT_ROOT/customware"

if [ ! -d "$SPACE_AGENT_DIR" ]; then
  echo "Error: vendor/space-agent not found. Run 'pnpm setup' first." >&2
  exit 1
fi

if [ ! -d "$CUSTOMWARE" ]; then
  echo "Error: customware/ directory not found in project root." >&2
  exit 1
fi

# Default to a non-3000 port so it does not collide with common dev servers.
PORT="${PORT:-3456}"
HOST="${HOST:-127.0.0.1}"

cd "$SPACE_AGENT_DIR"

if [ "${1:-}" = "--smoke" ]; then
  echo "==> Booting space-agent (smoke mode) on $HOST:$PORT"
  CUSTOMWARE_PATH="$CUSTOMWARE" PORT="$PORT" HOST="$HOST" \
    node space serve &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

  # Wait up to 10 seconds for the server to come up.
  for i in $(seq 1 10); do
    if curl -sf "http://$HOST:$PORT/" -o /dev/null -w "%{http_code}\n" 2>&1 | grep -qE "^(2|3)"; then
      echo "==> Smoke check passed."
      exit 0
    fi
    sleep 1
  done

  echo "==> Smoke check FAILED after 10 seconds." >&2
  exit 1
fi

echo "==> Booting space-agent on http://$HOST:$PORT"
echo "    Customware: $CUSTOMWARE"
echo "    Press Ctrl-C to stop."
echo ""

exec env CUSTOMWARE_PATH="$CUSTOMWARE" PORT="$PORT" HOST="$HOST" \
  node space serve
```

- [ ] **Step 2: Make it executable**

```bash
cd /Users/krunal/Development/llm-wiki
chmod +x scripts/dev-space-agent.sh
```

- [ ] **Step 3: Test the smoke mode (will fail because customware/ doesn't exist yet)**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm dev:check
```

Expected: FAIL with "customware/ directory not found in project root." That's correct — we add `customware/` in Task 3.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add scripts/dev-space-agent.sh
git commit -m "feat: dev script boots space-agent with CUSTOMWARE_PATH"
```

---

## Task 3: customware skeleton — module manifest

**Files:**
- Create: `customware/L1/_all/mod/krunal/llm-wiki/mod.yaml`

The module manifest tells space-agent's customware runtime that this directory is a module. Per Spike 05, modules under `L1/_all/mod/<author>/<repo>/` are auto-discovered.

- [ ] **Step 1: Create the manifest**

```bash
mkdir -p /Users/krunal/Development/llm-wiki/customware/L1/_all/mod/krunal/llm-wiki
```

Create `customware/L1/_all/mod/krunal/llm-wiki/mod.yaml`:

```yaml
name: llm-wiki
owner: krunal
description: |
  llm-wiki extensions for space-agent. Provides config-driven LLM
  provider routing, embedder integration, and MCP source connectors.
  See https://github.com/<owner>/llm-wiki for the host repository.
version: 0.1.0
```

If space-agent's manifest schema requires additional fields (e.g. `repo_url`, `requires`), the smoke test in Task 5 will surface a validation error in the boot logs. If that happens, add the missing fields per the upstream module-manifest convention (look at `vendor/space-agent/app/L0/_all/mod/_core/*.mod.yaml` or similar for examples — Spike 05 confirmed manifest files exist on existing modules).

- [ ] **Step 2: Verify the manifest parses (sanity check)**

```bash
cd /Users/krunal/Development/llm-wiki && node -e "console.log(require('yaml').parse(require('fs').readFileSync('customware/L1/_all/mod/krunal/llm-wiki/mod.yaml', 'utf8')))"
```

Expected: prints the parsed object with `name`, `owner`, `description`, `version` fields.

If `yaml` isn't installed at the repo root, install it:

```bash
cd /Users/krunal/Development/llm-wiki && pnpm add yaml
```

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add customware/L1/_all/mod/krunal/llm-wiki/mod.yaml
git commit -m "feat(customware): module manifest for krunal/llm-wiki"
```

---

## Task 4: Proof-of-wire HTML extension

**Files:**
- Create: `customware/L1/_all/mod/krunal/llm-wiki/ext/html/_core/admin/views/index/end/llm-wiki-banner.html`

Per Spike 05, space-agent's HTML extension seam works by placing files at `ext/html/<seam>/<position>/<filename>.html`. The `_core/admin/views/index/end` seam appends content to the bottom of the admin index view. Any logged-in admin will see the banner.

This is the proof that our customware layer is loaded.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /Users/krunal/Development/llm-wiki/customware/L1/_all/mod/krunal/llm-wiki/ext/html/_core/admin/views/index/end
```

- [ ] **Step 2: Create the banner**

Create `customware/L1/_all/mod/krunal/llm-wiki/ext/html/_core/admin/views/index/end/llm-wiki-banner.html`:

```html
<!--
  PROOF-OF-WIRE: this banner is loaded from llm-wiki's customware/.
  Source: customware/L1/_all/mod/krunal/llm-wiki/ext/html/_core/admin/views/index/end/llm-wiki-banner.html
  If you can see this banner in the space-agent admin UI, our extension layer is working.
-->
<div style="
  margin: 1.5rem 0;
  padding: 1rem 1.25rem;
  border: 2px solid #fcd34d;
  border-radius: 0.5rem;
  background: #fffbeb;
  color: #78350f;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 0.95rem;
">
  <strong>llm-wiki</strong> · customware loaded successfully.
  <span style="opacity: 0.75; margin-left: 0.5rem;">
    Extensions live at <code>customware/L1/_all/mod/krunal/llm-wiki/</code>.
  </span>
</div>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add customware/L1/_all/mod/krunal/llm-wiki/ext/html/
git commit -m "feat(customware): proof-of-wire admin banner"
```

---

## Task 5: Boot smoke test

**Files:** (none new; tests existing scripts)

- [ ] **Step 1: Run the smoke test**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm dev:check
```

Expected output:

```
==> Booting space-agent (smoke mode) on 127.0.0.1:3456
==> Smoke check passed.
```

The script exits 0 within 10 seconds.

If the boot fails:
- **HTTP request times out:** check whether `node space serve` works directly from `vendor/space-agent/`. If it does, the issue is the `--smoke` shell loop (curl missing, port collision). Document and proceed.
- **Customware validation error:** the `mod.yaml` may need additional fields. Inspect `vendor/space-agent/app/L0/_all/mod/` for sample manifests and add the missing keys.
- **Port in use:** override `PORT=3457 pnpm dev:check`.

- [ ] **Step 2: Manual visual verification (optional)**

Boot interactively:

```bash
cd /Users/krunal/Development/llm-wiki && pnpm dev
```

Open http://127.0.0.1:3456/ in a browser, log in as `admin` / `change-me-now`, navigate to the admin view. Confirm the yellow "llm-wiki · customware loaded successfully" banner is visible.

If the banner does NOT appear:
- The HTML extension may not be at the right seam path. The path `_core/admin/views/index/end` is the assumed seam name from Spike 05. If space-agent has renamed or restructured this seam, find the actual seam by inspecting `vendor/space-agent/app/L0/_all/mod/_core/admin/views/index/index.html` (or similar) for `<x-extension id="...">` tags. Update our path to match.
- Document the actual seam path used in the commit message and in the README.

Stop the server with `Ctrl-C`.

- [ ] **Step 3: Add a tiny unit test that verifies the customware files exist**

Create `__tests__/customware.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

describe('customware skeleton', () => {
  it('module manifest exists and has required fields', () => {
    const manifestPath = join(
      root,
      'customware/L1/_all/mod/krunal/llm-wiki/mod.yaml'
    );
    expect(existsSync(manifestPath)).toBe(true);
    const content = readFileSync(manifestPath, 'utf8');
    expect(content).toMatch(/^name:\s*llm-wiki/m);
    expect(content).toMatch(/^owner:\s*krunal/m);
  });

  it('proof-of-wire banner exists', () => {
    const bannerPath = join(
      root,
      'customware/L1/_all/mod/krunal/llm-wiki/ext/html/_core/admin/views/index/end/llm-wiki-banner.html'
    );
    expect(existsSync(bannerPath)).toBe(true);
    const content = readFileSync(bannerPath, 'utf8');
    expect(content).toMatch(/llm-wiki.*customware loaded successfully/);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test customware
```

Expected: 2 tests pass.

- [ ] **Step 5: Run all tests to confirm no regression**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all tests pass (50 from Plan 1 + 2 new = 52 passing, 1 skipped).

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add __tests__/customware.test.ts
git commit -m "test(customware): verify module manifest and banner exist"
```

---

## Task 6: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Running the desktop app shell" section**

Read current `README.md`. Insert this section after the existing CLI/Storage/Embedders sections (or wherever fits the existing structure):

```markdown
## Running the desktop app shell

The desktop app is built on a vendored copy of [space-agent](https://github.com/agent0ai/space-agent), pinned to commit `9c26f9f`. It is cloned into `vendor/space-agent/` (gitignored) on first setup, with our extensions mounted from `customware/`.

### First-time setup

\`\`\`bash
pnpm setup
\`\`\`

This clones space-agent (~150 packages, ~30s), pins it to the recorded SHA, runs `npm install` inside it, and creates a default admin user (username `admin`, password `change-me-now`).

The script is idempotent — re-running is safe.

### Boot

\`\`\`bash
pnpm dev
\`\`\`

This starts space-agent on http://127.0.0.1:3456 with `CUSTOMWARE_PATH` pointing at our `customware/` directory. Override the port with `PORT=3457 pnpm dev`.

Log in as `admin` / `change-me-now`. You should see a yellow banner at the bottom of the admin view confirming our extension layer is loaded.

### Smoke check (no UI)

\`\`\`bash
pnpm dev:check
\`\`\`

Boots the server, makes one HTTP request, and exits 0 on success. Used by CI.

### What's wired in v1.5

- Vendored space-agent at a pinned upstream commit
- `customware/` directory mounted via `CUSTOMWARE_PATH`
- One proof-of-wire HTML extension (admin-view banner)

### What's NOT wired yet (Plan 1.6 and later)

- LLM provider integration — chat currently uses space-agent's defaults, not our `LLMProvider` adapter
- Embedder pre-warm on launch
- Profile config bridge (our `~/.llm-wiki/config.json` does not yet flow into space-agent's chat surface)
- MCP source connectors (Plan 2)
- Widgets and canvas templates (Plans 5–7)

### Updating the pinned commit

Edit `PINNED_SHA` in `scripts/setup-space-agent.sh`, run `pnpm setup`, then `pnpm dev:check` to verify boot still works. Per Spike 05, upstream churn is concentrated in areas we don't extend (Electron host, login UI, agent chat), so pin updates should be low-friction. Commit the pin update with the SHA in the message.
```

(In the actual README, replace the escaped backticks with real triple-backticks.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: pnpm setup/dev/dev:check and customware overview"
```

---

## Spec coverage check

| Spec / amendment | Implemented in |
| --- | --- |
| Spec §1 — built on space-agent | Tasks 1–2 (vendor + boot) |
| Spec §1 — extensions over fork | Tasks 3–4 (customware skeleton, banner extension) |
| Amendment 2 — hybrid integration (pin + customware) | Tasks 1, 3 |
| Spike 05 decision: pin `9c26f9f`, customware-first | Tasks 1, 3 |
| Spike 05: `_core/admin/views/index/end` is a real seam | Task 4 |

**Out of scope (deferred — explicitly stated above):**
- `LLMProvider` extension hook (Plan 1.6)
- Embedder pre-warm hook (Plan 1.6)
- Profile config bridge (Plan 1.6)
- `server/jobs/job_runner.js` patches (Plan 3 — only needed for indexers)
- MCP source connectors (Plan 2)

All Plan 1.5 deliverables traced.

---

## Verification before declaring complete

- [ ] `pnpm setup` runs cleanly (clones, pins, installs, creates admin)
- [ ] `pnpm setup` is idempotent (second run skips clone, install, and admin creation)
- [ ] `pnpm dev:check` exits 0 within 10 seconds
- [ ] `pnpm dev` boots interactively; admin login works; yellow banner visible at bottom of admin view
- [ ] `pnpm test` passes (52 tests, 1 skipped)
- [ ] `pnpm typecheck` exits 0
- [ ] `vendor/` is in `.gitignore` and not tracked
- [ ] No accidental `node_modules`, `*.onnx`, `*.sqlite`, or `vendor/space-agent/` files committed
- [ ] `git log --oneline` shows ~6 new commits

---

*End of Plan 1.5.*

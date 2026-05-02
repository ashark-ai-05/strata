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
# Space-agent stores users under CUSTOMWARE_PATH/L2/<username>/ (when CUSTOMWARE_PATH is set)
# or app/L2/<username>/ otherwise. Check the app-relative path as a fallback.
CUSTOMWARE_PATH="${CUSTOMWARE_PATH:-}"
if [ -n "$CUSTOMWARE_PATH" ]; then
  ADMIN_DIR="$CUSTOMWARE_PATH/L2/admin"
else
  ADMIN_DIR="$SPACE_AGENT_DIR/app/L2/admin"
fi

if [ -d "$ADMIN_DIR" ]; then
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

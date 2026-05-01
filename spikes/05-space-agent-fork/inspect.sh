#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d space-agent ]; then
  git clone https://github.com/agent0ai/space-agent.git
fi

cd space-agent
echo "=== recent commits ==="
git log --oneline -20

echo "=== AGENTS.md files ==="
find . -name "AGENTS.md" -not -path "./node_modules/*" -not -path "./.git/*" | head -20

echo "=== module structure ==="
ls app/L0/_all/mod/ 2>/dev/null || echo "module path not found"
ls app/L0/_all/mod/_core/ 2>/dev/null || echo "_core module path not found"

echo "=== upstream cadence (last 3 months) ==="
git log --since="3 months ago" --oneline | wc -l

echo "=== upstream cadence (last 1 month) ==="
git log --since="1 month ago" --oneline | wc -l

echo "=== breaking-change signals (last 3 months) ==="
git log --since="3 months ago" --oneline | grep -iE "refactor|rename|breaking|BREAKING|major|migrate" | head -20

echo "=== file churn (last 3 months, top 15) ==="
git log --since="3 months ago" --pretty=format: --name-only | grep -v "^$" | sort | uniq -c | sort -rn | head -15

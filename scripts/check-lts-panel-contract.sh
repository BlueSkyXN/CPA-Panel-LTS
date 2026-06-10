#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

failures=0

fail() {
  printf 'LTS panel contract violation: %s\n' "$1" >&2
  failures=$((failures + 1))
}

require_path() {
  local path="$1"
  if [ ! -e "$path" ]; then
    fail "missing path: $path"
  fi
}

require_file_contains() {
  local file="$1"
  local pattern="$2"
  if [ ! -f "$file" ]; then
    fail "missing file: $file"
    return
  fi
  if ! grep -Fq -- "$pattern" "$file"; then
    fail "missing marker '$pattern' in $file"
  fi
}

require_repo_contains() {
  local pattern="$1"
  if ! grep -R -F -q --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist -- "$pattern" .; then
    fail "missing repository marker: $pattern"
  fi
}

for path in \
  src/router/MainRoutes.tsx \
  src/pages/UsagePage.tsx \
  src/pages/UsagePage.module.scss \
  src/components/usage \
  src/components/usage/AGENTS.md \
  src/services/api/usage.ts \
  src/stores/useUsageStatsStore.ts \
  src/types/usage.ts \
  src/utils/usage.ts \
  src/utils/usageIndex.ts \
  src/utils/usage \
  docs/lts/panel-protected-deltas.yaml \
  docs/lts/sync-runbook.md \
  .github/workflows/release.yml \
  package-lock.json
do
  require_path "$path"
done

require_file_contains src/router/MainRoutes.tsx "path: '/usage'"
require_file_contains src/router/MainRoutes.tsx "UsagePage"
require_file_contains src/components/layout/MainLayout.tsx "path: '/usage'"
require_file_contains src/services/api/usage.ts "'/usage'"
require_file_contains src/services/api/usage.ts "'/usage/export'"
require_file_contains src/services/api/usage.ts "'/usage/import'"
require_file_contains src/stores/useUsageStatsStore.ts "usageApi.getUsage"
require_file_contains src/utils/constants.ts "USAGE: '/usage'"
require_file_contains src/services/api/config.ts "'/usage-statistics-enabled'"
require_file_contains src/services/api/index.ts "export * from './usage'"
require_file_contains .github/workflows/release.yml "management.html"
require_file_contains .github/workflows/release.yml "v*-tls-*"
require_file_contains docs/lts/panel-protected-deltas.yaml "full-usage-statistics-ui"
require_file_contains docs/lts/panel-protected-deltas.yaml "cpa-core-lts-management-api-compatibility"
require_file_contains docs/lts/panel-protected-deltas.yaml "panel-release-contract"
require_file_contains docs/lts/sync-runbook.md "protected selective-port"

require_repo_contains "CPA-Core-LTS"
require_repo_contains "usage-statistics-enabled"
require_repo_contains "management.html"

for lockfile in bun.lock yarn.lock pnpm-lock.yaml; do
  if [ -e "$lockfile" ]; then
    fail "unexpected secondary package-manager lockfile: $lockfile"
  fi
done

if [ "$failures" -ne 0 ]; then
  printf 'LTS panel contract check failed with %s violation(s).\n' "$failures" >&2
  exit 1
fi

printf 'LTS panel contract check passed.\n'

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
GENERATOR="$ROOT_DIR/scripts/generate-lts-release-notes.sh"

fail() {
  printf 'release notes generator test failed: %s\n' "$*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "$expected" "$file"; then
    printf 'expected %s to contain: %s\n' "$file" "$expected" >&2
    sed -n '1,120p' "$file" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    printf 'expected %s not to contain: %s\n' "$file" "$unexpected" >&2
    sed -n '1,120p' "$file" >&2
    exit 1
  fi
}

expect_failure() {
  local expected="$1"
  local tag="$2"
  local stdout_file="$FIXTURE_DIR/stdout"
  local stderr_file="$FIXTURE_DIR/stderr"

  if PATH="$MOCK_BIN:$PATH" GH_MOCK_LOG="$GH_MOCK_LOG" \
    bash "$FIXTURE_DIR/repo/scripts/generate-lts-release-notes.sh" \
      --tag "$tag" >"$stdout_file" 2>"$stderr_file"; then
    fail "$tag unexpectedly succeeded"
  fi
  assert_contains "$stderr_file" "$expected"
}

FIXTURE_DIR=$(mktemp -d)
trap 'rm -rf "$FIXTURE_DIR"' EXIT
MOCK_BIN="$FIXTURE_DIR/bin"
GH_MOCK_LOG="$FIXTURE_DIR/gh.log"
mkdir -p "$FIXTURE_DIR/repo/scripts" "$MOCK_BIN"
cp "$GENERATOR" "$FIXTURE_DIR/repo/scripts/"

cat >"$MOCK_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${GH_MOCK_LOG:?}"
if [[ "${1:-}" == "api" ]]; then
  if [[ "${GH_MOCK_FAIL:-false}" == "true" ]]; then
    exit 1
  fi
  cat <<'NOTES'
## What's Changed
* fix(panel): keep the final behavior by @maintainer in https://example.invalid/pull/1

**Full Changelog**: https://example.invalid/compare
NOTES
  exit 0
fi
exit 1
EOF
chmod +x "$MOCK_BIN/gh"

cd "$FIXTURE_DIR/repo"
git init -q
git config user.name fixture
git config user.email fixture@example.invalid

printf 'base\n' >fixture.txt
git add fixture.txt
git commit -qm base
git tag -a v1-lts-0.0.1 \
  -m 'Panel LTS: base release' \
  -m 'Companion-Core: v1-lts-0.0.1'

printf 'upstream\n' >>fixture.txt
git commit -qam upstream
git tag -a v1.99.0 -m 'upstream v1.99.0'

printf 'release\n' >>fixture.txt
git commit -qam release
git tag -a v1-lts-0.0.2 \
  -m 'Panel LTS: explicit summary survives release ordering' \
  -m 'Companion-Core: v1-lts-0.0.2'

output_file="$FIXTURE_DIR/release-notes.md"
title_file="$FIXTURE_DIR/release-title.txt"
PATH="$MOCK_BIN:$PATH" GH_MOCK_LOG="$GH_MOCK_LOG" \
  bash scripts/generate-lts-release-notes.sh \
    --tag v1-lts-0.0.2 \
    --notes-file "$output_file" \
    --title-file "$title_file"

assert_contains "$output_file" 'Panel LTS: explicit summary survives release ordering'
assert_contains "$output_file" 'CPA-Core-LTS：[v1-lts-0.0.2]'
assert_contains "$output_file" '## What'"'"'s Changed'
assert_not_contains "$output_file" '## 本版要点'
assert_contains "$title_file" 'v1-lts-0.0.2 — Panel LTS: explicit summary survives release ordering'
assert_contains "$GH_MOCK_LOG" 'previous_tag_name=v1-lts-0.0.1'
assert_not_contains "$GH_MOCK_LOG" 'previous_tag_name=v1.99.0'

fallback_file="$FIXTURE_DIR/release-notes-fallback.md"
PATH="$MOCK_BIN:$PATH" GH_MOCK_LOG="$GH_MOCK_LOG" GH_MOCK_FAIL=true \
  bash scripts/generate-lts-release-notes.sh \
    --tag v1-lts-0.0.2 \
    --notes-file "$fallback_file"
assert_contains "$fallback_file" 'Panel LTS: explicit summary survives release ordering'
assert_contains "$fallback_file" 'CPA-Panel-LTS/compare/v1-lts-0.0.1...v1-lts-0.0.2'

printf 'lightweight\n' >>fixture.txt
git commit -qam lightweight
git tag v1-lts-0.0.3
expect_failure 'must be an annotated tag' v1-lts-0.0.3

printf 'placeholder\n' >>fixture.txt
git commit -qam placeholder
git tag -a v1-lts-0.0.4 \
  -m 'CPA Panel LTS v1-lts-0.0.4' \
  -m 'Companion-Core: v1-lts-0.0.4'
expect_failure 'meaningful user-facing summary' v1-lts-0.0.4

printf 'missing companion\n' >>fixture.txt
git commit -qam missing-companion
git tag -a v1-lts-0.0.5 -m 'Panel LTS: missing companion fixture'
expect_failure 'exactly one Companion-Core' v1-lts-0.0.5

printf 'invalid companion\n' >>fixture.txt
git commit -qam invalid-companion
git tag -a v1-lts-0.0.6 \
  -m 'Panel LTS: invalid companion fixture' \
  -m 'Companion-Core: core-latest'
expect_failure 'must match v*-lts-*' v1-lts-0.0.6

printf 'duplicate companion\n' >>fixture.txt
git commit -qam duplicate-companion
git tag -a v1-lts-0.0.7 \
  -m 'Panel LTS: duplicate companion fixture' \
  -m $'Companion-Core: v1-lts-0.0.6\nCompanion-Core: v1-lts-0.0.7'
expect_failure 'exactly one Companion-Core' v1-lts-0.0.7

printf 'release notes generator tests passed.\n'

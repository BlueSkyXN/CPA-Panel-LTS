# scripts navigation card

LTS guards, browser smokes, quota helpers, and userscripts.
Read before modifying any file in this directory.
Contract work also requires `docs/lts/AGENTS.md`; userscript behavior is separate from Panel build coverage.

## Local invariants

- `check-lts-panel-contract.sh` is the implementation behind `npm run check:lts`; it must agree with `panel-feature-contracts.yaml`.
- `smoke-lts-panel.py` proves mock-Core browser behavior, not deployment acceptance.
- `smoke-lts-panel-core.py` targets sibling Core and may write only temporary smoke config.
- Userscripts are outside Vite and app `build`, `lint`, and `type-check`.
- `/backend-api/wham/*` behavior must come from verified semantics, not guessed fields.

## Local rules

- Prefer behavior assertions over fragile presentational strings, except when an exact string is itself a protected contract marker.
- Userscript metadata (`@version`, URLs, `@match`, `@grant`) changes are release-surface changes.
- Keep `CONFIG.MANUAL_ACCESS_TOKEN` empty in committed userscript source.
- Export summaries only; never export access tokens, management keys, raw auth data, or sensitive raw responses.

## Do not

- Do not hardcode/log credentials, account IDs, JWTs, raw payloads, or management config.
- Do not broaden userscript permissions/origins without a concrete user-facing requirement.
- Do not persist access tokens in browser storage.
- Do not claim userscript validation from a passing Panel build.
- Do not run real-Core write smoke against a non-temporary or live configuration.

## Validation

- Contract: `npm run check:lts`; broad changes: `npm run validate:lts`.
- Mock browser smoke: `npm run smoke:lts` — requires Python Playwright and Chromium.
- Real-Core smoke: `npm run smoke:lts:core` — requires sibling Core, Go, credentials, Python Playwright, and Chromium; use `-- --no-write-smoke` when writes are not intended.
- No package script validates userscripts; report actual browser/Tampermonkey smoke.

# scripts navigation card

Helper scripts, LTS checks, browser smokes, and quota userscripts.
Read this before editing contract scripts, smoke scripts, or quota userscripts.
Key docs: `docs/lts/panel-feature-contracts.yaml`, `docs/lts/panel-protected-deltas.yaml`.

## Local invariants

- `check-lts-panel-contract.sh` is `npm run check:lts`; keep it aligned with `docs/lts/panel-feature-contracts.yaml`.
- `smoke-lts-panel.py` is mock browser smoke, not live deployment validation.
- `smoke-lts-panel-core.py` targets local `CPA-Core-LTS` and may write temp config.
- Userscripts are standalone browser scripts and are not covered by `npm run build`, `npm run lint`, or `npm run type-check`.
- Quota helpers touch ChatGPT `/backend-api/wham/*`; verify semantics before changing parsers or estimates.

## Local rules

- When adding a protected marker, update `docs/lts/panel-feature-contracts.yaml` and the shell guard together.
- Keep smoke assertions behavior-oriented where possible.
- For public userscript changes, update `@version` and metadata URLs deliberately.
- `CONFIG.MANUAL_ACCESS_TOKEN` must stay empty in committed userscript files.
- Exported JSON from userscripts should contain summaries, not credentials or raw account tokens.

## Do not

- Do not hardcode personal tokens, management keys, account ids, or raw auth responses.
- Do not log tokens, raw `/usage` responses, or raw analytics payloads.
- Do not broaden userscript `@grant` or `@match` without explaining scope.
- Do not persist access tokens in localStorage/sessionStorage.
- Do not treat a passing app build as proof that scripts or userscripts work.

## Validation

- `npm run check:lts` — shell guard plus feature-contract checks.
- `npm run smoke:lts` — mock browser smoke; requires Python Playwright and Chromium.
- `npm run smoke:lts:core` — authenticated local Core smoke; requires local Core and credentials.
- There is no package script that fully validates userscripts. If no browser/Tampermonkey smoke test was run, say so in the final report.

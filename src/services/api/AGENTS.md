# src/services/api navigation card

Browser clients, transforms, and errors for the Core `/v0/management` API.
Read before changing endpoints, headers, request/response shapes, connection lifecycle, `/api-call`, usage/config/auth/plugin clients, or exports.
Key files: `client.ts`, `apiError.ts`, `transformers.ts`, `apiCall.ts`, `index.ts`, domain client, matching `src/types/` and stores.

## Local invariants

- `apiClient` owns base URL, Bearer header, timeout, connection generation, capability headers, and 401 signaling.
- Responses from an obsolete connection generation must not mutate current connection state.
- Domain clients return stable Panel-facing shapes; external `unknown` data is narrowed/transformed at the boundary.
- `/api-call` is the managed proxy for supported outbound calls; direct browser calls require an explicit contract.
- Endpoint and schema truth comes from current `CPA-Core-LTS` source or live endpoint, not neighboring APIs or memory.

## Local rules

- Add helpers to the relevant domain module and export through `index.ts` where callers use the barrel.
- Preserve raw response access only where headers/download/text semantics require it.
- Preserve error status/code/details semantics; sanitize logs and fixtures.
- When Core changes fields, inspect corresponding types, transforms, stores, pages, and cache invalidation in the same change path.

## Do not

- Do not log/persist keys, Authorization values, OAuth tokens, auth files, or sensitive raw responses.
- Do not reset global client state from a stale request.
- Do not silently rename/drop fields to make TypeScript compile.
- Do not add undocumented endpoints or guess HTTP methods.

## Validation

- `npm run test:api-client`
- Run the relevant domain test aggregator, such as `npm run test:usage`, `test:providers`, or `test:auth-files`.
- `npm run type-check`, `npm run build`, and `npm run lint` for shared client/transform changes.
- Core-dependent behavior requires current Core source/live readback.

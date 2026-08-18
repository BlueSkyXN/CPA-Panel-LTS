# src/services/storage navigation card

Browser persistence for management connection data.
Read before changing stored keys, format, migration, obfuscation, retention, or any new sensitive value.
Key file: `secureStorage.ts`; related consumers live in auth/config stores and connection utilities.

## Why this is high-risk

- Existing storage is reversible obfuscation, not encryption or an authentication boundary.
- Format/key changes can lock users out of saved connections or leave stale credentials behind.
- Browser storage is same-origin readable; new secrets change exposure and cleanup requirements.

## Required before changes

- Find every reader, writer, migration, and removal path for the affected key.
- Preserve legacy read compatibility or define a bounded migration and rollback path.
- Confirm logout/clear behavior removes values that should no longer persist.
- Stop for a product/security decision before increasing credential retention.

## Do not

- Do not describe obfuscation as encryption or secure-at-rest protection.
- Do not add OAuth refresh/access tokens, raw auth JSON, plugin credentials, or unrelated provider keys to persistent storage without explicit scope.
- Do not log stored/deobfuscated values or put real secrets in tests/snapshots.

## Validation

- `npm run test:config` for connection/API-key storage changes.
- `npm run type-check` and `npm run build`.
- Manually verify legacy read, new write, removal/logout, and corrupted-value fallback when format or migration changes.

---
checked: 2026-10-05
paths:
  - "features/pc-browser/**"
  - "app/api/pc-browser/**"
  - "public/pc-browser-extension/**"
  - "scripts/pc-browser*.test.*"
---

# The owner's Chrome tab

One explicitly shared web tab on the owner's computer receives bounded commands from the
hosted assistant. A shared tab can remain in the background while the owner uses Thursday.

## Start here
- `features/pc-browser/bridge.ts` — hashed device key, pinned command relay and status.
- `app/api/pc-browser/bridge/route.ts` — bearer validation for polls and command results.
- `app/api/pc-browser/status/route.ts` — authenticated heartbeat status for Settings.
- `features/pc-browser/components/pc-browser-setting.tsx` — pairing and connection status.
- `public/pc-browser-extension/worker.js` — selected-tab execution, polling, Pause and Stop.
- `public/pc-browser-extension/popup.js` — server-specific pairing and optional website access.
- `features/ai/tools/pc-browser.tool.ts` — the assistant's bounded browser actions.

## How it fits
Pairing stores only the random key's hash on the server. The extension long-polls its configured
HTTPS server, verifies its key before claiming pairing, and declares ready only with a shared,
unpaused web tab. Commands stay within that
tab; cross-site navigation needs Chrome's optional website permission. Timeout is an uncertain
action, so a click or fill is never automatically repeated. Replacing or revoking a key cancels
pending server commands. Chrome must remain open; no browser cookies or profiles are exported.

## Check
`pnpm test:pc-browser` checks key revocation, pairing races and background-tab readiness.
Live verification uses a harmless tab and distinguishes local sharing from server connection.

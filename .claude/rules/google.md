---
checked: 2026-10-05
paths:
  - "features/google/**"
  - "features/reach/gmail.ts"
  - "app/api/reach/gmail/**"
  - "scripts/google.test.mts"
  - "scripts/reach-gmail.test.mts"
---

# Google account access

The owner connects Google for Gmail HTTPS sending, primary Calendar events and read-only Drive.

## Start here
- `features/reach/gmail.ts` — scoped OAuth, one-time PKCE state, token refresh and Gmail sending.
- `app/api/reach/gmail/callback/route.ts` — callback tied to the state and configured mailbox.
- `features/google/google.ts` — fixed API origins and explicit revoked-access errors.
- `features/google/calendar.ts` — bounded event lists, creation without invitations and deletion.
- `features/google/drive.ts` — bounded file search and supported file reads.
- `features/ai/tools/google.tool.ts` — Google tools and the configured mailbox inbox reader.

## How it fits
The OAuth client has the hosted HTTPS callback registered with Google. Credentials are sealed
in the deployment's own data store. Sending uses Gmail HTTPS when hosting blocks SMTP. Inbox
reads and monitoring use the separately configured IMAP mailbox. Provider refusal is returned
explicitly; no result is fabricated and access requires reconnection after revocation.

## Check
`pnpm test:google` checks state/PKCE, mailbox binding, fixed origins, scoped inputs and revocation.
Live checks report API acceptance separately from inbox delivery, with private data kept out of
the public repository. External Testing grants expire after seven days for these scopes.

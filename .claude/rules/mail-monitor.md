---
checked: 2026-10-05
paths:
  - "features/mail-monitor/**"
  - "app/api/mail-monitor/**"
  - "scripts/mail-monitor.test.mts"
---

# Inbox monitoring

The configured mailbox is read without changing messages. A text model assesses new mail and
important messages enter the durable owner notification ledger.

## Start here
- `features/mail-monitor/inbox.ts` — bounded, read-only IMAP search and message reads.
- `features/mail-monitor/monitor.ts` — UID cursor, semantic importance assessment and server clock.
- `features/reminder/reminder.query.ts` — stable message IDs and independent Telegram/call deliveries.
- `app/api/mail-monitor/route.ts` — status without mail content or credentials.

## How it fits
Boot starts one pinned clock. Monitoring is opt-in in Settings › API keys › Phone. The first check
records the current mailbox position; later checks assess only new UIDs. Email content is untrusted
input to a tool-free classification call. Classification failure leaves the cursor for the next
check and reports an error. A stable mailbox/UID ID prevents duplicate alert creation after restart.
The delivery ledger and call safety cap are shared with requested reminders.

## Check
`pnpm test:mail-monitor` checks baselining, unimportant mail, classification failure and duplicate
alert suppression with no providers. `pnpm test:reminder` checks independent delivery and restart
semantics. Live checks use a separate data folder and report provider acceptance separately from
recipient confirmation.

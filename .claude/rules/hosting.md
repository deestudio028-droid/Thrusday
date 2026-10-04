---
checked: 2026-10-04
paths:
  - "hosting/**"
  - "scripts/hosting-access.test.mjs"
  - "guide/hosting.md"
  - ".railway/**"
  - "Dockerfile"
  - ".dockerignore"
---

# Hosted access boundary

The hosted app listens privately. Only the access gateway listens on the public port.

## Start here
- `hosting/access-gateway.mjs` — validated host/origin, password sign-in, revocable sessions,
  streaming HTTP proxy, protected upgrades and public status-only readiness.
- `hosting/config.ts` — password-work cost, request/state bounds and connection deadlines.
- `hosting/hash-password.mjs` — an offline password hash from standard input.
- `hosting/start.mjs` — starts the private app and public gateway, then stops both together.
- `Dockerfile` — builds the Linux app, tools and browser without putting data in the image.
- `.railway/railway.ts` — source, service settings and durable volume.
- `scripts/hosting-access.test.mjs` — access, CSRF, header and streaming boundary checks.
- `guide/hosting.md` — what changes for a person using a hosted instance.

## How it fits

HTTPS terminates at the hosting platform. The gateway requires a configured HTTPS origin,
password hash and session secret before listening. It checks the actual Host instead of
trusting client-supplied forwarding headers, then rebuilds the headers for the loopback app.
The status endpoint probes the app and returns only readiness; it accepts the platform's
health-check Host. Sessions stay in gateway memory, so a process restart signs browsers out.
The app's data and its own secret-sealing key are stored separately on the durable volume.
Railway keeps one replica running and disables sleep; secret variable values stay on
Railway and are represented as `preserve()` in the checked-in plan.

## Check

`node --test scripts/hosting-access.test.mjs` exercises anonymous denial, sign-in/out,
origin checks, secure cookies, rate limits, forwarding headers, live response/request
streaming and protected WebSocket upgrades without providers or real user data. Deployment
verification also checks the external HTTPS endpoint and persistent volume settings.

/**
 * Hosting access limits. More password work resists guessing but consumes more CPU/memory.
 * Longer sessions reduce sign-ins while extending a stolen cookie's lifetime. The other
 * bounds cap unauthenticated work and retained state; shorter deadlines fail stalled
 * handshakes/health checks sooner without timing out Thursday's ongoing streams.
 */
export const HOSTING_ACCESS = {
  scrypt: { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
  passwordMinBytes: 14,
  passwordMaxBytes: 1024,
  secretMinBytes: 32,
  secretMaxBytes: 4096,
  loginBodyBytes: 8192,
  sessionSeconds: 86400,
  sessionMinSeconds: 900,
  sessionMaxSeconds: 604800,
  sessionLimit: 1000,
  loginAttempts: 10,
  loginWindowMs: 10 * 60 * 1000,
  loginAddressLimit: 10000,
  simultaneousPasswordChecks: 2,
  upstreamSockets: 64,
  upgradeMs: 15000,
  readinessMs: 3000,
  headersMs: 20000,
  keepAliveMs: 65000,
  shutdownMs: 10000,
  // These GET routes change app presence or call state. Cross-site navigation must
  // not reach them; keep aligned with proxy.ts ACTING_READS.
  actingReads: ["/api/events", "/api/favicon", "/api/thursday/call/plan"],
};

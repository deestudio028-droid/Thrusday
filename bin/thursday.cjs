#!/usr/bin/env node
// `npx thursday-agent` and `pnpm start` begin here. CommonJS, in syntax any Node parses, so the
// version check runs before thursday.mjs is parsed: an older Node is told what to do instead of
// dying on something it lacks.

require("./node-check.cjs");
import("./thursday.mjs");

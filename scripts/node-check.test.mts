import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// What an older Node is told. Only the choosing is tested here, on every system's paths from this
// one; that the check runs before anything else on Node 10 and up is CI's `old-node` job.

type Update = { from: string; lines: string[]; note: string | null } | null;
const { againFor, message, updateFor } = createRequire(import.meta.url)(
  "../bin/node-check.cjs",
) as {
  updateFor: (
    node: string,
    platform: string,
    env: Record<string, string>,
    home: string,
  ) => Update;
  againFor: (
    argv: string[],
    env: Record<string, string>,
    dir: string,
    entry: boolean,
  ) => string | null;
  message: (
    need: string,
    have: string,
    update: Update,
    again: string | null,
    platform: string,
  ) => string;
};

const HOMES: Record<string, string> = {
  darwin: "/Users/sam",
  linux: "/home/sam",
  win32: "C:\\Users\\Sam",
};

const home = await mkdtemp(join(tmpdir(), "thursday-node-check-"));
after(() => rm(home, { recursive: true, force: true }));

test("an older Node is told the commands of the tool that installed it", () => {
  const nvm = ["nvm install --lts", "nvm alias default 'lts/*'"];
  const fnm = ["fnm install --lts --use", "fnm default lts-latest"];
  const cases: [string, string, Record<string, string>, string, string[]][] = [
    [
      "darwin",
      "/Users/sam/.nvm/versions/node/v20.19.0/bin/node",
      {},
      "nvm",
      nvm,
    ],
    [
      "linux",
      "/opt/nvm/versions/node/v18.19.1/bin/node",
      { NVM_DIR: "/opt/nvm" },
      "nvm",
      nvm,
    ],
    [
      "linux",
      "/home/sam/.local/share/fnm/node-versions/v20.19.0/installation/bin/node",
      {},
      "fnm",
      fnm,
    ],
    [
      "darwin",
      "/Users/sam/Library/Application Support/fnm/node-versions/v20.19.0/installation/bin/node",
      {},
      "fnm",
      fnm,
    ],
    [
      "darwin",
      "/Users/sam/.volta/tools/image/node/20.19.0/bin/node",
      {},
      "Volta",
      ["volta install node@lts"],
    ],
    [
      "linux",
      "/home/sam/.local/share/mise/installs/node/20.19.0/bin/node",
      {},
      "mise",
      ["mise use -g node@lts"],
    ],
    [
      "darwin",
      "/opt/homebrew/Cellar/node/21.7.3/bin/node",
      {},
      "Homebrew",
      ["brew upgrade node"],
    ],
    [
      "linux",
      "/home/linuxbrew/.linuxbrew/Cellar/node/21.7.3/bin/node",
      {},
      "Homebrew",
      ["brew upgrade node"],
    ],
    [
      "win32",
      "C:\\Users\\Sam\\AppData\\Local\\nvm\\v20.19.0\\node.exe",
      {
        NVM_HOME: "C:\\Users\\Sam\\AppData\\Local\\nvm",
        NVM_SYMLINK: "C:\\nvm4w\\nodejs",
      },
      "nvm for Windows",
      ["nvm install lts", "nvm use lts"],
    ],
    // Linked where the installer puts its Node, as nvm for Windows once did by default
    [
      "win32",
      "C:\\Program Files\\nodejs\\node.exe",
      {
        NVM_HOME: "C:\\Users\\Sam\\AppData\\Roaming\\nvm",
        NVM_SYMLINK: "C:\\Program Files\\nodejs",
        ProgramFiles: "C:\\Program Files",
      },
      "nvm for Windows",
      ["nvm install lts", "nvm use lts"],
    ],
    [
      "win32",
      "c:\\program files\\nodejs\\node.exe",
      { ProgramFiles: "C:\\Program Files" },
      "the Node.js installer",
      ["winget install OpenJS.NodeJS.LTS"],
    ],
    [
      "win32",
      "C:\\Users\\Sam\\scoop\\apps\\nodejs-lts\\20.19.0\\node.exe",
      { USERPROFILE: "C:\\Users\\Sam" },
      "Scoop",
      ["scoop update nodejs-lts"],
    ],
    [
      "win32",
      "C:\\Users\\Sam\\scoop\\apps\\nodejs\\21.7.3\\node.exe",
      { USERPROFILE: "C:\\Users\\Sam" },
      "Scoop",
      ["scoop update nodejs"],
    ],
    [
      "win32",
      "C:\\Users\\Sam\\AppData\\Roaming\\fnm\\node-versions\\v20.19.0\\installation\\node.exe",
      { APPDATA: "C:\\Users\\Sam\\AppData\\Roaming" },
      "fnm",
      fnm,
    ],
    [
      "win32",
      "C:\\Users\\Sam\\AppData\\Local\\Volta\\tools\\image\\node\\20.19.0\\node.exe",
      { LOCALAPPDATA: "C:\\Users\\Sam\\AppData\\Local" },
      "Volta",
      ["volta install node@lts"],
    ],
  ];
  for (const [platform, node, env, from, lines] of cases) {
    const update = updateFor(node, platform, env, HOMES[platform]);
    assert.equal(update?.from, from, node);
    assert.deepEqual(update?.lines, lines, node);
  }
  // Only the installer's may be missing its tool: winget is not on every Windows
  assert.match(
    updateFor(
      "C:\\Program Files\\nodejs\\node.exe",
      "win32",
      { ProgramFiles: "C:\\Program Files" },
      "C:\\Users\\Sam",
    )?.note ?? "",
    /nodejs\.org\/en\/download/,
  );
});

test("a Node no known tool installed is sent to Node's download page for its system", () => {
  for (const [platform, node, env] of [
    // A system's own package, or one put on the PATH by hand
    ["linux", "/usr/bin/node", {}],
    ["darwin", "/usr/local/bin/node", {}],
    // A versioned formula: upgrading `node` would not change it
    ["darwin", "/opt/homebrew/Cellar/node@20/20.19.0/bin/node", {}],
    // A folder that only starts like a tool's
    ["darwin", "/Users/sam/.nvm-old/versions/node/v20.19.0/bin/node", {}],
    // Nothing set on Windows is nothing matched, not a relative folder
    ["win32", "C:\\tools\\node\\node.exe", {}],
  ] as [string, string, Record<string, string>][])
    assert.equal(updateFor(node, platform, env, HOMES[platform]), null, node);

  const text = message("22.18", "12.22.9", null, "npx thursday-agent", "linux");
  assert.match(
    text,
    /Thursday needs Node 22\.18 or newer, and this is 12\.22\.9\./,
  );
  assert.match(text, /LTS for Linux from https:\/\/nodejs\.org\/en\/download/);
  assert.match(text, /\n {4}npx thursday-agent\n/);
});

test("the commands to type come as one block: the update, then the line that started it", () => {
  const nvm = updateFor(
    "/Users/sam/.nvm/versions/node/v20.19.0/bin/node",
    "darwin",
    {},
    "/Users/sam",
  );
  assert.equal(
    message(
      "22.18",
      "20.19.0",
      nvm,
      "npx thursday-agent --port 5000",
      "darwin",
    ),
    [
      "",
      "  Thursday needs Node 22.18 or newer, and this is 20.19.0.",
      "",
      "  This Node came from nvm. Update it, and start again:",
      "",
      "    nvm install --lts",
      "    nvm alias default 'lts/*'",
      "    npx thursday-agent --port 5000",
      "",
    ].join("\n"),
  );
  // Nothing to start again from the background job's launcher
  assert.doesNotMatch(
    message("22.18", "20.19.0", nvm, null, "darwin"),
    /start again/,
  );
});

test("the line that starts it again is the one that started it", () => {
  const bin = "/usr/lib/node_modules/thursday-agent/bin";
  assert.equal(
    againFor(["--port", "5000"], { npm_lifecycle_event: "npx" }, bin, true),
    "npx thursday-agent --port 5000",
  );
  // npm 6's npx sets no lifecycle event, and keeps the package in a folder of its own
  assert.equal(
    againFor(
      [],
      {},
      "/Users/sam/.npm/_npx/4213/lib/node_modules/thursday-agent/bin",
      true,
    ),
    "npx thursday-agent",
  );
  assert.equal(
    againFor(
      [],
      {
        npm_lifecycle_event: "dev",
        npm_config_user_agent: "pnpm/10.15.1 npm/? node/v20.19.0",
      },
      "/src/thursday/bin",
      false,
    ),
    "pnpm run dev",
  );
  assert.equal(
    againFor(["--home", "/Users/sam/My Data"], {}, bin, true),
    'thursday --home "/Users/sam/My Data"',
  );
  // Run by the background job's launcher, not by anything typed
  assert.equal(againFor([], {}, bin, false), null);
});

test("on a Node the app takes, the check says nothing and the command runs", () => {
  const env = { ...process.env, THURSDAY_HOME: home };
  const root = join(import.meta.dirname, "..");
  const check = spawnSync(
    process.execPath,
    [join(root, "bin", "node-check.cjs")],
    {
      env,
      encoding: "utf8",
    },
  );
  assert.equal(check.status, 0);
  assert.equal(check.stderr, "");
  const { version } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const run = spawnSync(
    process.execPath,
    [join(root, "bin", "thursday.cjs"), "--version"],
    {
      env,
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), version);
});

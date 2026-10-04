// Whether this Node is new enough, before anything else of the command runs: thursday.cjs
// requires it first, `pnpm dev` runs it before it starts, and the background job's launcher runs
// it on each Node it tries. CommonJS, in syntax Node 10 parses: an ES module is parsed and linked
// with everything it imports before any of it runs, so while thursday.mjs imported this first,
// Node 16 and older died on a module or syntax they lack (`node:readline/promises`, top-level
// await) without being told why, and Ubuntu 22.04 and Debian 11 install Node 12. The version it
// asks for is package.json's `engines`. Too old, it prints the commands that update the Node that
// ran it, with the tool whose folder that Node lives in, and the line that starts it again.

const fs = require("fs");
const path = require("path");
const os = require("os");

/** Node's own page, for every system and way to install: what is said when the way is not known. */
const DOWNLOAD = "https://nodejs.org/en/download";

/**
 * How to update the Node at `node` to the current LTS with the tool that installed it, known by
 * the folder that tool keeps its Nodes in; null for a Node none of these installed.
 */
function updateFor(node, platform, env, home) {
  const windows = platform === "win32";
  const p = windows ? path.win32 : path.posix;
  const at = (base, ...rest) => (base ? p.join(base, ...rest) : null);
  // One file on Windows whatever the case its path is written in
  const same = (text) => (windows ? text.toLowerCase() : text);
  const inside = (roots) =>
    roots.some(
      (root) =>
        root &&
        same(node).startsWith(
          same(p.normalize(root).replace(/[\\/]+$/, "") + p.sep),
        ),
    );
  const fnm = ["fnm install --lts --use", "fnm default lts-latest"];
  const tools = windows
    ? [
        // Before the installer's folder: nvm for Windows linked its Node there by default once
        {
          from: "nvm for Windows",
          roots: [env.NVM_HOME, env.NVM_SYMLINK],
          lines: ["nvm install lts", "nvm use lts"],
        },
        {
          from: "Volta",
          roots: [
            at(
              env.VOLTA_HOME || at(env.LOCALAPPDATA, "Volta"),
              "tools",
              "image",
              "node",
            ),
          ],
          lines: ["volta install node@lts"],
        },
        {
          from: "fnm",
          roots: [
            at(env.FNM_DIR, "node-versions"),
            at(env.APPDATA, "fnm", "node-versions"),
          ],
          lines: fnm,
        },
        {
          from: "Scoop",
          roots: [
            at(env.SCOOP || at(env.USERPROFILE, "scoop"), "apps", "nodejs-lts"),
          ],
          lines: ["scoop update nodejs-lts"],
        },
        {
          from: "Scoop",
          roots: [
            at(env.SCOOP || at(env.USERPROFILE, "scoop"), "apps", "nodejs"),
          ],
          lines: ["scoop update nodejs"],
        },
        {
          // Its installer replaces the version in this folder with the one installed over it
          from: "the Node.js installer",
          roots: [at(env.ProgramFiles, "nodejs")],
          lines: ["winget install OpenJS.NodeJS.LTS"],
          note: `Without winget, the installer is on ${DOWNLOAD}.`,
        },
      ]
    : [
        {
          from: "nvm",
          roots: [
            p.join(env.NVM_DIR || p.join(home, ".nvm"), "versions", "node"),
          ],
          // Quoted: zsh takes a bare lts/* as a file pattern
          lines: ["nvm install --lts", "nvm alias default 'lts/*'"],
        },
        {
          from: "fnm",
          roots: [
            env.FNM_DIR,
            at(env.XDG_DATA_HOME, "fnm"),
            p.join(home, ".local", "share", "fnm"),
            p.join(home, "Library", "Application Support", "fnm"),
            p.join(home, ".fnm"),
          ].map((dir) => at(dir, "node-versions")),
          lines: fnm,
        },
        {
          from: "Volta",
          roots: [
            p.join(
              env.VOLTA_HOME || p.join(home, ".volta"),
              "tools",
              "image",
              "node",
            ),
          ],
          lines: ["volta install node@lts"],
        },
        {
          from: "mise",
          roots: [
            env.MISE_DATA_DIR,
            at(env.XDG_DATA_HOME, "mise"),
            p.join(home, ".local", "share", "mise"),
          ].map((dir) => at(dir, "installs", "node")),
          lines: ["mise use -g node@lts"],
        },
        {
          // `node` alone: a versioned formula (node@20) is put on the PATH by hand, and
          // upgrading `node` would not change the one that runs
          from: "Homebrew",
          roots: [
            env.HOMEBREW_PREFIX,
            "/opt/homebrew",
            "/usr/local",
            "/home/linuxbrew/.linuxbrew",
          ].map((dir) => at(dir, "Cellar", "node")),
          lines: ["brew upgrade node"],
        },
      ];
  const tool = tools.find((one) => inside(one.roots));
  return tool
    ? { from: tool.from, lines: tool.lines, note: tool.note || null }
    : null;
}

/**
 * The line that starts it again as it was started — npx, a package script, or the installed
 * command when thursday.cjs required this (`entry`) — or null when nothing the person typed
 * started it, as the background job's launcher runs this.
 */
function againFor(argv, env, dir, entry) {
  const words = argv.map((word) =>
    /^[\w@%+=:,./\\-]+$/.test(word) ? word : `"${word}"`,
  );
  const tool = /^(\w+)\//.exec(env.npm_config_user_agent || "");
  let line = null;
  if (
    env.npm_lifecycle_event === "npx" ||
    dir.split(/[\\/]/).indexOf("_npx") >= 0
  )
    line = "npx thursday-agent";
  else if (env.npm_lifecycle_event)
    line = `${tool ? tool[1] : "npm"} run ${env.npm_lifecycle_event}`;
  else if (entry) line = "thursday";
  return line && [line].concat(words).join(" ");
}

/** What an older Node is told, in the terminal or in the background job's log. */
function message(need, have, update, again, platform) {
  const system = { darwin: "macOS", win32: "Windows", linux: "Linux" }[
    platform
  ];
  const out = [
    "",
    `  Thursday needs Node ${need} or newer, and this is ${have}.`,
    "",
  ];
  const typed = update ? update.lines.slice() : [];
  if (again) typed.push(again);
  if (update)
    out.push(
      `  This Node came from ${update.from}. ${again ? "Update it, and start again:" : "Update it:"}`,
    );
  else
    out.push(
      `  Install the LTS${system ? ` for ${system}` : ""} from ${DOWNLOAD}, which shows the`,
      `  commands for each way to install it${again ? ", and start again:" : "."}`,
    );
  if (typed.length) out.push("", ...typed.map((line) => `    ${line}`));
  if (update && update.note) out.push("", `  ${update.note}`);
  return `${out.join("\n")}\n`;
}

const { engines } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
);
const wanted = /(\d+)\.(\d+)/.exec((engines && engines.node) || "");
const have = process.versions.node.split(".").map(Number);
if (
  wanted &&
  (have[0] < Number(wanted[1]) ||
    (have[0] === Number(wanted[1]) && have[1] < Number(wanted[2])))
) {
  let node = process.execPath;
  try {
    // Where the Node behind a link lives: Homebrew's and nvm for Windows' are links
    node = fs.realpathSync(node);
  } catch (_error) {
    // The path as Node gave it; a tool not found by it is sent to the download page
  }
  console.error(
    message(
      `${wanted[1]}.${wanted[2]}`,
      process.versions.node,
      updateFor(node, process.platform, process.env, os.homedir()),
      againFor(
        process.argv.slice(2),
        process.env,
        __dirname,
        require.main !== module,
      ),
      process.platform,
    ),
  );
  process.exit(1);
}

module.exports = { againFor, message, updateFor };

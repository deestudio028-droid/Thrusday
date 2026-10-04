// How the command's lines look: what is bold, the card that says where the app is, and the
// steps of a start that takes a while. Plain JavaScript and no app imports, like the rest of
// bin. The styling is Node's own (util.styleText), which leaves the text plain for a pipe, a
// log file and NO_COLOR: the background job's log is shown in Settings as it was written.

import { homedir } from "node:os";
import { sep } from "node:path";
import { styleText } from "node:util";

export const bold = (text) => styleText("bold", text);
const dim = (text) => styleText("dim", text);
const green = (text) => styleText("green", text);
const address = (text) => styleText(["cyan", "underline"], text);

/**
 * A path under the home folder, written from `~` as a shell reads it; any other as it is.
 * Windows' shells do not all read `~`, so there it is always the whole path.
 */
export function tilde(path) {
  const home = homedir();
  if (process.platform === "win32") return path;
  if (path === home) return "~";
  return path.startsWith(`${home}${sep}`)
    ? `~${path.slice(home.length)}`
    : path;
}

/**
 * Where the app is: a title, its address, and one named row for each thing to know about it.
 * A row without a value is left out. Lines for `block`.
 */
export function card(title, url, rows) {
  const said = rows.filter(([, value]) => value);
  const width = Math.max(0, ...said.map(([name]) => name.length));
  return [
    bold(title),
    url ? `${styleText("cyan", "→")} ${address(url)}` : null,
    ...said.map(([name, value]) => `  ${dim(name.padEnd(width))}   ${value}`),
  ];
}

/** Lines to print, indented; null is a line left out, "" an empty one. */
const block = (lines) =>
  `\n${lines
    .filter((line) => line !== null)
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n")}\n`;

/** A step named on a terminal while it runs, its line not yet ended. */
let pending = false;
const endStep = () => {
  if (!pending) return;
  pending = false;
  process.stdout.write("\n");
};

export const say = (lines) => {
  endStep();
  console.log(block(lines));
};
export const fail = (lines) => {
  endStep();
  console.error(block(lines));
};

/**
 * Names a step before it runs, for one that blocks for seconds with nothing else to show. On
 * a terminal only, where `done` writes over it; a log gets the finished line alone.
 */
export function begin(text) {
  if (!process.stdout.isTTY) return;
  endStep();
  process.stdout.write(`  ${dim(`· ${text}…`)}`);
  pending = true;
}

/** A step that finished, in place of the line that named it. */
export function done(text) {
  if (pending) process.stdout.write("\r\x1b[2K");
  pending = false;
  console.log(`  ${green("✓")} ${text}`);
}

// A motion video's page: the kit, the music and the player around the film's code, one HTML
// file that plays offline; and the film's code read back out of it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME = dirname(fileURLToPath(import.meta.url));
/** The runtime in the order it runs: the kit, the music, then the film that uses them. */
export const KIT = [
  "kit-core.js",
  "kit-people.js",
  "kit-things.js",
  "kit-places.js",
  "score.js",
  "film.js",
];

const CODE =
  /<script id="film-code">\n([\s\S]*?)\n\/\/# sourceURL=film-code\.js\n<\/script>/;

/** The film's code, as the page holds it; null when the page holds none. */
export function codeOf(html) {
  const got = CODE.exec(html);
  return got ? got[1].replace(/<\\\/script/gi, "</script") : null;
}

/** The kit's scripts as one, run in a scope of its own that leaves only `film` behind. */
export function kitScript() {
  const read = (f) => readFileSync(join(RUNTIME, f), "utf8");
  return `(() => {\n"use strict";\n${KIT.map(read).join("\n")}\n})();`;
}

export function page(code, title) {
  // A handwriting that has Hangul as well as Latin; other scripts fall back to the machine's
  const hand = readFileSync(
    join(RUNTIME, "fonts", "Gaegu-Bold.woff2"),
  ).toString("base64");
  const escape = (text) =>
    String(text).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  // Nothing in the film's code may close its script tag
  const inline = code.replace(/<\/script/gi, "<\\/script");
  return readFileSync(join(RUNTIME, "motion.html"), "utf8")
    .replace("{{title}}", () => escape(title))
    .replace("__HAND__", () => hand)
    .replace("// film runtime", () => kitScript())
    .replace(
      /<script id="film-code">[\s\S]*?<\/script>/,
      () =>
        `<script id="film-code">\n${inline}\n//# sourceURL=film-code.js\n</script>`,
    );
}

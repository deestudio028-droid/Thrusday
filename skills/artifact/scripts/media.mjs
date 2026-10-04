// ffmpeg for the kit's scripts that make sound and video (deck.mjs, motion.mjs): the
// machine's own, or a portable build installed once into the workspace, and what it reads
// off a file.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** ffmpeg on the machine, or a portable build installed once into the workspace. */
export function findFfmpeg(workspace, Stop) {
  if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg";
  const dir = join(workspace, "projects", ".ffmpeg");
  const bin = join(
    dir,
    "node_modules",
    "ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  if (existsSync(bin)) return bin;
  console.error(
    "No ffmpeg on this machine: installing a portable one into projects/.ffmpeg, once…",
  );
  mkdirSync(dir, { recursive: true });
  spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      dir,
      "ffmpeg-static",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (!existsSync(bin))
    throw new Stop(
      "Installing a portable ffmpeg failed; npm's output above says why.",
    );
  return bin;
}

/**
 * What ffmpeg reads off a file: its length in seconds, and for a video its size and frame
 * rate. Read, never guessed: a file ffmpeg cannot read stops the script.
 */
function probe(ffmpeg, file, Stop) {
  const read = spawnSync(ffmpeg, ["-hide_banner", "-i", file], {
    encoding: "utf8",
  });
  const said = read.stderr ?? "";
  const hms = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(said);
  if (!hms) throw new Stop(`${file} is not audio or video ffmpeg can read.`);
  const length = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  const video = /Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b[^\n]*/.exec(
    said,
  );
  const fps = video && /([\d.]+) fps/.exec(video[0]);
  return {
    length,
    audio: /Stream #[^\n]*Audio:/.test(said),
    video: video
      ? {
          w: Number(video[1]),
          h: Number(video[2]),
          fps: fps ? Number(fps[1]) : null,
        }
      : null,
  };
}

/** Seconds, read off the file itself: a scene's length is never guessed. */
export const duration = (ffmpeg, file, Stop) =>
  probe(ffmpeg, file, Stop).length;

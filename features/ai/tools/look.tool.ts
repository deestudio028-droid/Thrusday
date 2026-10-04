import { readFile, stat } from "node:fs/promises";
import { type ToolSet, tool } from "ai";
import * as z from "zod";
import { LOOK } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { isPicture, mimeOf } from "@/features/workspace/file-kind";
import { insideWorkspace } from "@/features/workspace/workspace";
import { formatBytes } from "@/lib/utils";

/**
 * Seeing a picture: a screenshot a bot took, an image the user handed over, a chart a script
 * drew. Everything else a model reads arrives as text; this is the one tool whose answer is
 * the image itself. What is stored and drawn is the small record `execute` returns — the
 * path, never the bytes — and `toModelOutput` turns it into the picture for the run that
 * asked, so a row stays a line and a resumed thread reads that a picture was looked at
 * rather than carrying it again. That split is not the sdk's doing: it puts `toModelOutput`
 * into `response.messages`, and a run is stored as what `execute` returned because
 * `storedMessages` puts it back (bot.run). The screen draws the record through the file
 * route (bot/thread.query resultParts). Held only by a model whose provider carries an image
 * inside a tool result (ai/model seesToolImages): to the rest it would arrive as nothing.
 */

type Looked = { path: string; mediaType: string };

/**
 * A file in the workspace as a picture a model can be sent, or what stands in the way: the
 * checks every way a picture reaches a model makes — `look_at`, and a picture the user sent
 * with their words (thursday.text seePictures). Each says what went wrong in its own words.
 */
export async function checkPicture(
  path: string,
): Promise<
  | { full: string; mediaType: string; bytes: number }
  | { missing: true }
  | { notPicture: true }
  | { tooBig: number }
> {
  const full = await insideWorkspace(path.trim());
  const info = full ? await stat(full).catch(() => null) : null;
  if (!full || !info?.isFile()) return { missing: true };
  if (!isPicture(path)) return { notPicture: true };
  if (info.size > LOOK.maxBytes) return { tooBig: info.size };
  return { full, mediaType: mimeOf(path), bytes: info.size };
}

/** What a picture over LOOK.maxBytes is told with: its size, the limit, and the way round it. */
export const tooBigToSee = (path: string, bytes: number) =>
  `${path} is ${formatBytes(bytes)}, over the ${formatBytes(LOOK.maxBytes)} a picture sent to a model can be. Make a smaller copy in the shell first (on a Mac: sips -Z 1600 in.png --out out.png), then look at that.`;

export function createLookTool(): ToolSet {
  return {
    [TOOL_NAMES.look_at]: tool({
      description:
        "See an image file yourself: a screenshot you took, a picture the user handed over, a chart you made. For what a picture shows — text files are read in the shell.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Workspace-relative path to a png, jpg, webp or gif."),
      }),
      execute: async ({ path }): Promise<Looked | string> => {
        const checked = await checkPicture(path);
        if ("missing" in checked)
          return `There is no file at ${path}. Give the path from the workspace root, as \`ls\` shows it.`;
        if ("notPicture" in checked)
          return `${path} is not a png, jpg, webp or gif. Read it in the shell instead.`;
        if ("tooBig" in checked) return tooBigToSee(path, checked.tooBig);
        return { path: path.trim(), mediaType: checked.mediaType };
      },
      toModelOutput: async ({ output }) => {
        if (typeof output === "string") return { type: "text", value: output };
        const full = await insideWorkspace(output.path);
        const data = full ? await readFile(full).catch(() => null) : null;
        if (!data)
          return { type: "text", value: `${output.path} is no longer there.` };
        return {
          type: "content",
          value: [
            { type: "text", text: `${output.path}, as an image:` },
            {
              type: "file",
              mediaType: output.mediaType,
              data: { type: "data", data: data.toString("base64") },
            },
          ],
        };
      },
    }),
  };
}

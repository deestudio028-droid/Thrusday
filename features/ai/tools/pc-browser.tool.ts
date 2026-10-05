import { tool } from "ai";
import * as z from "zod";
import { commandPcBrowser } from "@/features/pc-browser/bridge";
import { isPublicError } from "@/lib/public-error";
import { TOOL_NAMES } from "./tool-name";

export function createPcBrowserTools() {
  return {
    [TOOL_NAMES.pc_browser]: tool({
      description:
        "Control the one PC Chrome tab the owner explicitly selected in the Thursday extension. Snapshot returns page text and selectors for that tab. Navigate, click, fill, scroll, back, forward or reload only that selected tab. The extension may be paused or offline. Never repeat a click or fill automatically after a timeout; inspect first. No arbitrary JavaScript, cookies, profile data or other tabs are exposed.",
      inputSchema: z.object({
        action: z.enum([
          "snapshot",
          "navigate",
          "click",
          "fill",
          "scroll",
          "back",
          "forward",
          "reload",
        ]),
        url: z.url().nullish().describe("Navigate: full http or https URL."),
        selector: z
          .string()
          .max(1000)
          .nullish()
          .describe("Click/fill: CSS selector from a fresh snapshot."),
        text: z
          .string()
          .max(5000)
          .nullish()
          .describe(
            "Fill: text to enter. Never enter saved passwords or payment details unless the user supplied them for this action.",
          ),
        pixels: z
          .number()
          .int()
          .min(-1200)
          .max(1200)
          .nullish()
          .describe(
            "Scroll: vertical pixels; positive moves down, negative moves up.",
          ),
      }),
      execute: async (args) => {
        if (
          args.action === "navigate" &&
          (!args.url || !/^https?:\/\//.test(args.url))
        )
          return "Give an http or https URL.";
        if (
          (args.action === "click" || args.action === "fill") &&
          !args.selector
        )
          return "Take a snapshot and use its selector.";
        if (args.action === "fill" && args.text === undefined)
          return "Give the text to enter.";
        try {
          return await commandPcBrowser(args.action, {
            ...(args.url ? { url: args.url } : {}),
            ...(args.selector ? { selector: args.selector } : {}),
            ...(args.text != null ? { text: args.text } : {}),
            ...(args.pixels != null ? { pixels: String(args.pixels) } : {}),
          });
        } catch (cause) {
          if (isPublicError(cause)) return cause.message;
          throw cause;
        }
      },
    }),
  };
}

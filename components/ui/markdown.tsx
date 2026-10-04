"use client";

import { type ComponentProps, lazy, memo, Suspense } from "react";
import type { MarkdownBody } from "./markdown-body";

/**
 * The renderer (Streamdown, with the code, math, diagram and CJK plugins) is the largest
 * thing the app's first screen carried, and nothing on that screen draws markdown until its
 * words come in. It loads in a chunk of its own once the page has opened and gone idle, so
 * the first words drawn find it in, and at once where words come first.
 */
let loaded: typeof MarkdownBody | null = null;
const load = () =>
  import("./markdown-body").then((module) => {
    loaded = module.MarkdownBody;
    return module;
  });
const Body = lazy(() =>
  load().then((module) => ({ default: module.MarkdownBody })),
);

if (typeof window !== "undefined") {
  // One that fails is asked for again where words are drawn, and fails there out loud
  const early = () => void load().catch(() => {});
  const ask = () => {
    if ("requestIdleCallback" in window) requestIdleCallback(early);
    else setTimeout(early);
  };
  if (document.readyState === "complete") ask();
  else window.addEventListener("load", ask, { once: true });
}

/** Markdown, drawn as its plain words until the renderer is in. */
export const Markdown = memo(function Markdown(
  props: ComponentProps<typeof MarkdownBody>,
) {
  // Drawn straight once it is in: React holds a fallback it has shown for a while before it
  // reveals what replaced it (FALLBACK_THROTTLE_MS, 300 ms), even when the chunk was there
  if (loaded) {
    const Loaded = loaded;
    return <Loaded {...props} />;
  }
  return (
    <Suspense
      fallback={
        <div className={props.className} style={{ whiteSpace: "pre-wrap" }}>
          {props.children}
        </div>
      }
    >
      <Body {...props} />
    </Suspense>
  );
});

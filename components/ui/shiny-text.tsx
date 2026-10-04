import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The ink under a passing band, and the band. On a light page
 * the band moves toward the ink: a lighter band on light ground reads as the
 * words fading out. A dark band over the full muted ink barely shows there, so
 * the words under it rest lighter on a light page than they do still.
 */
const TONES = {
  muted: {
    under: "text-muted-foreground/60 dark:text-muted-foreground",
    band: "text-foreground",
  },
  waiting: {
    under: "text-waiting/70",
    band: "text-waiting/30",
  },
  /** Words the user is meant to read rather than watch: full ink, and the warm only passes over. */
  reading: {
    under: "text-foreground",
    band: "text-waiting/80",
  },
} as const;

export type ShinyTone = keyof typeof TONES;

/**
 * Words for something still moving. They are drawn once as plain text, so they
 * cut short, wrap and select like any other; the sweep is a copy laid over them
 * in the band's ink, seen through a soft-edged window that crosses them while
 * the copy inside it moves back as far, so the words hold still and only the
 * window moves. Both move by transform, which the compositor runs however busy
 * the page is, where a sweep of the background's position is repainted each
 * frame and halts with the page.
 *
 * Truncate on this component, not on a parent: it is an inline-block, and a
 * parent cannot put an ellipsis inside one.
 */
export function ShinyText({
  text,
  tone = "muted",
  speed = 2.4,
  className,
}: {
  text: string;
  tone?: ShinyTone;
  /** Seconds for the band to cross once. */
  speed?: number;
  className?: string;
}) {
  const { under, band } = TONES[tone];
  return (
    <span
      data-slot="shiny-text"
      className={cn("relative inline-block max-w-full", under, className)}
    >
      {text}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden p-[inherit] select-none [text-overflow:inherit] motion-reduce:hidden"
      >
        <span
          style={{ animationDuration: `${speed}s` } as CSSProperties}
          className="absolute inset-0 animate-shine overflow-hidden p-[inherit] [mask-image:linear-gradient(120deg,transparent_20%,#000_50%,transparent_80%)] [mask-repeat:no-repeat] [text-overflow:inherit]"
        >
          <span
            style={{ animationDuration: `${speed}s` } as CSSProperties}
            className={cn(
              "absolute inset-0 animate-shine-back overflow-hidden p-[inherit] [text-overflow:inherit]",
              band,
            )}
          >
            {text}
          </span>
        </span>
      </span>
    </span>
  );
}

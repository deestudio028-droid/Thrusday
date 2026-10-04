"use client";

import { Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Swatch } from "@/components/ui/swatch";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DRAW_PAD } from "@/config";
import { MARK_INK } from "@/features/bot/mark.const";
import { useCommandLabel, useEscape } from "@/hooks/use-hotkey";
import { useIsDark } from "@/hooks/use-theme";
import { errorToString } from "@/lib/utils";
import { ORB_INK } from "../ascii.const";

/**
 * A pad to draw on, over the screen, whose drawing is handed over as a picture: kept as a PNG
 * cropped to what was drawn, on the pad's own colour, and put on the write line as a pasted
 * picture is (write-line). So it goes where any picture goes — on a spoken call into her
 * backend's conversation once it is made to fit (put-down), in writing with the words
 * (thursday.text readPictures). The write line holds it, opened from its paperclip or from the
 * call's line (writeLine.draw). What is drawn stays while the pad is closed, until it is handed
 * over or cleared. Undo and Redo walk it back and forth a stroke at a time, a Clear included,
 * by their buttons or the system's keys.
 */

/** The pens: her ink, which follows the theme, then the colours bots' marks are drawn in (bot/mark.const). */
const PENS: { label: string; color: string | null }[] = [
  { label: "Ink", color: null },
  { label: "Red", color: MARK_INK.red },
  { label: "Orange", color: MARK_INK.orange },
  { label: "Yellow", color: MARK_INK.yellow },
  { label: "Green", color: MARK_INK.green },
  { label: "Blue", color: MARK_INK.blue },
  { label: "Violet", color: MARK_INK.violet },
  { label: "Pink", color: MARK_INK.pink },
  { label: "Stone", color: MARK_INK.stone },
];

/** A stroke: the pen it was drawn with, and its points as shares of the pad's width and height. */
type Stroke = { pen: number; points: [number, number][] };

/** How thick a stroke is, as a share of the pad's width. */
const STROKE = 0.014;
/** Room kept round what was drawn when it is cropped, as a share of the pad's width. */
const MARGIN = 0.02;
/** How far the pen moves, as a share of the pad's width, before the stroke takes a new point. */
const STEP = 0.002;

function paint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: Stroke[],
  inkOf: (pen: number) => string,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = STROKE * width;
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    ctx.strokeStyle = inkOf(stroke.pen);
    ctx.beginPath();
    ctx.moveTo(first[0] * width, first[1] * height);
    for (const [x, y] of rest) ctx.lineTo(x * width, y * height);
    // a tap is a dot
    if (!rest.length) ctx.lineTo(first[0] * width + 0.1, first[1] * height);
    ctx.stroke();
  }
}

export function DrawPad({
  open,
  onClose,
  onDone,
  action,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * The drawing, as a file to hand over; resolves to whether it was taken. One refused — the
   * line full, the upload failed — stays on the pad, and whoever refused it says why.
   */
  onDone: (file: File) => Promise<boolean>;
  /** What the button that hands it over says. */
  action: string;
}) {
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  /** What the pad held before each stroke or Clear, and what Undo took back, newest last. */
  const undos = useRef<Stroke[][]>([]);
  const redos = useRef<Stroke[][]>([]);
  const [count, setCount] = useState(0);
  /** Bumped on every step of the history, so the buttons follow it. */
  const [, setStep] = useState(0);
  const undoKey = useCommandLabel("KeyZ");
  const redoKey = useCommandLabel("KeyZ", true);
  const [pen, setPen] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [keeping, setKeeping] = useState(false);
  const dark = useIsDark();
  // The last layer while it is open: Esc closes the pad alone, not the line or call under it
  useEscape(open, onClose);

  /** A pen's colour in the theme now. */
  const inkOf = useCallback(
    (index: number) => {
      const [r, g, b] = dark ? ORB_INK.dark : ORB_INK.light;
      return PENS[index]?.color ?? `rgb(${r},${g},${b})`;
    },
    [dark],
  );

  useEffect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  // Drawn again whole when the pad is sized, or the theme's ink changes
  useEffect(() => {
    if (!canvas || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, size.width, size.height, strokes.current, inkOf);
  }, [canvas, size, inkOf]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    ] as [number, number];
  };

  /** The newest part of the stroke being drawn, onto what is already there. */
  const extend = (stroke: Stroke) => {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !size) return;
    paint(
      ctx,
      size.width,
      size.height,
      [{ pen: stroke.pen, points: stroke.points.slice(-2) }],
      inkOf,
    );
  };

  /** The pad drawn again from its strokes, after a step of the history. */
  const redraw = () => {
    setCount(strokes.current.length);
    setStep((step) => step + 1);
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx, size.width, size.height, strokes.current, inkOf);
  };

  /** Keeps what the pad holds now for Undo, before a stroke or a Clear changes it. */
  const remember = () => {
    undos.current.push([...strokes.current]);
    redos.current = [];
    setStep((step) => step + 1);
  };

  const clear = () => {
    remember();
    strokes.current = [];
    drawing.current = null;
    redraw();
  };

  /** One step back or forward: what the pad held goes to the other side. */
  const walk = (from: typeof undos, to: typeof undos) => {
    const was = from.current.pop();
    if (!was) return;
    drawing.current = null;
    to.current.push(strokes.current);
    strokes.current = was;
    redraw();
  };
  const undo = () => walk(undos, redos);
  const redo = () => walk(redos, undos);

  /**
   * The drawing alone, cropped to it with a little room, on the pad's own colour, handed
   * over; cleared once it was taken. What stopped it is said, and the drawing stays.
   */
  const keep = async () => {
    if (!canvas || !size || !strokes.current.length) return;
    setKeeping(true);
    try {
      const { width, height } = size;
      let x0 = 1;
      let y0 = 1;
      let x1 = 0;
      let y1 = 0;
      for (const stroke of strokes.current)
        for (const [x, y] of stroke.points) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      const room = (MARGIN + STROKE / 2) * width;
      const left = Math.max(0, x0 * width - room);
      const top = Math.max(0, y0 * height - room);
      const w = Math.min(width, x1 * width + room) - left;
      const h = Math.min(height, y1 * height + room) - top;
      // as sharp as it was drawn on this screen, and no larger than config DRAW_PAD allows
      const k = Math.min(
        Math.min(2, window.devicePixelRatio || 1),
        DRAW_PAD.longestSide / Math.max(w, h),
      );
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(w * k));
      out.height = Math.max(1, Math.round(h * k));
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("This browser gave no canvas to keep it on.");
      ctx.fillStyle = getComputedStyle(canvas).backgroundColor;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.setTransform(k, 0, 0, k, -left * k, -top * k);
      paint(ctx, width, height, strokes.current, inkOf);
      const blob = await new Promise<Blob | null>((done) =>
        out.toBlob(done, "image/png"),
      );
      if (!blob) throw new Error("This browser could not keep the drawing.");
      const drawn = strokes.current.length;
      if (await onDone(new File([blob], "drawing.png", { type: "image/png" })))
        if (strokes.current.length === drawn) {
          // Drawn on again while it went: that stays. Handed over, it is gone, and so is its history
          strokes.current = [];
          drawing.current = null;
          undos.current = [];
          redos.current = [];
          redraw();
        }
    } catch (cause) {
      toast.add({
        type: "error",
        title: "The drawing could not be kept.",
        description: errorToString(cause),
      });
    } finally {
      setKeeping(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        // The system's own keys for undo and redo; the pad has no field for them to type into
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          const key = event.key.toLowerCase();
          if (key === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
          } else if (key === "y" && event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            redo();
          }
        }}
        // twice as wide as it is tall, as large as the window lets it be
        className="w-[min(72rem,calc(100vw-2rem),calc((100dvh-7rem)*2))] max-w-none gap-3 p-3 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Drawing pad</DialogTitle>
        <canvas
          ref={setCanvas}
          aria-label="Drawing pad"
          className="block aspect-[2/1] w-full cursor-crosshair touch-none rounded-lg bg-background ring-1 ring-foreground/10"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            remember();
            const stroke: Stroke = { pen, points: [pointOf(event)] };
            drawing.current = stroke;
            strokes.current.push(stroke);
            extend(stroke);
            setCount(strokes.current.length);
          }}
          onPointerMove={(event) => {
            const stroke = drawing.current;
            if (!stroke) return;
            const point = pointOf(event);
            const last = stroke.points[stroke.points.length - 1];
            if (Math.hypot(point[0] - last[0], point[1] - last[1]) < STEP)
              return;
            stroke.points.push(point);
            extend(stroke);
          }}
          onPointerUp={() => {
            drawing.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = null;
          }}
        />
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
            {PENS.map((one, index) => (
              <Swatch
                key={one.label}
                color={one.color}
                label={one.label}
                picked={pen === index}
                onPick={() => setPen(index)}
              />
            ))}
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Undo"
                  disabled={!undos.current.length}
                  onClick={undo}
                />
              }
            >
              <Undo2 />
            </TooltipTrigger>
            <TooltipContent>
              Undo
              <kbd
                data-slot="kbd"
                className="bg-background/20 px-1.5 font-mono text-[10px]"
              >
                {undoKey}
              </kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Redo"
                  disabled={!redos.current.length}
                  onClick={redo}
                />
              }
            >
              <Redo2 />
            </TooltipTrigger>
            <TooltipContent>
              Redo
              <kbd
                data-slot="kbd"
                className="bg-background/20 px-1.5 font-mono text-[10px]"
              >
                {redoKey}
              </kbd>
            </TooltipContent>
          </Tooltip>
          <span aria-hidden className="h-4.5 w-px bg-border" />
          <Button variant="ghost" disabled={!count} onClick={clear}>
            Clear
          </Button>
          <Button
            disabled={!count}
            loading={keeping}
            onClick={() => void keep()}
          >
            {action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

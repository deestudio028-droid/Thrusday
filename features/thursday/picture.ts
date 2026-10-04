"use client";

import { queryKey } from "@/app/api/query-key";
import { CALL_PICTURE } from "@/config";
import { errorToString, formatBytes } from "@/lib/utils";

/**
 * A picture put down on a spoken call — a file, or a drawing — made to fit the connection
 * before it is handed to the backend (put-down).
 */

/**
 * The sizes a picture of `width` × `height` pixels is tried at, largest first (config
 * CALL_PICTURE): each of `scales` of the size it starts at, which is its own, or `longestSide`
 * on its longest side when it is larger. The scales are of that size and not of `longestSide`,
 * which would try a small picture again and again at its own size. A side is never under one
 * pixel: a picture far longer than it is tall rounds its short side to none, and a canvas with
 * no pixels reads back as `data:,`, short enough to pass the size check as a picture that fits.
 */
export function pictureSizes(
  width: number,
  height: number,
): { width: number; height: number }[] {
  const longest = Math.max(width, height);
  const start = Math.min(longest, CALL_PICTURE.longestSide);
  return CALL_PICTURE.scales.map((scale) => {
    const ratio = (start * scale) / longest;
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
    };
  });
}

/**
 * `image` as a JPEG data URL of at most `bytes`: a data channel carries one message up to its
 * limit and no more, so the picture is made plainer, then smaller, until it fits (pictureSizes
 * and config CALL_PICTURE). `draw` when the browser gives no canvas to draw on, `fit` when even
 * the smallest is too big.
 */
function fitPicture(
  image: ImageBitmap,
  bytes: number,
): { url: string } | { failed: "draw" | "fit" } {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return { failed: "draw" };
  for (const size of pictureSizes(image.width, image.height)) {
    canvas.width = size.width;
    canvas.height = size.height;
    // A JPEG keeps no transparency, and what is transparent comes out black: a picture with
    // a clear ground is laid on white, as a page shows it
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of CALL_PICTURE.qualities) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= bytes) return { url };
    }
  }
  return { failed: "fit" };
}

/**
 * A picture kept in the workspace, read through the file route and made to fit `bytes`
 * (fitPicture). What went wrong otherwise, said as the backend will read it: a file that is
 * gone, one that could not be read, is not a picture or will not draw, the route's own
 * refusal. None asks the backend for another path: the page chose it, and a spoken call's
 * backend has no `look_at` (that is a call in writing's), so it has no tool to give one to.
 */
export async function pictureOfFile(
  path: string,
  bytes: number,
): Promise<{ url: string } | { failed: string }> {
  const unread = (cause: unknown) => ({
    failed: `${path} could not be read: ${errorToString(cause)}`,
  });
  let response: Response;
  try {
    response = await fetch(queryKey.file(path));
  } catch (cause) {
    return unread(cause);
  }
  if (response.status === 404)
    return { failed: `There is no file at ${path} in the workspace.` };
  if (response.status === 403)
    return { failed: `${path} is outside the workspace.` };
  if (!response.ok)
    return {
      failed: `${path} could not be read: the file route answered ${response.status}.`,
    };
  // The body is a transfer of its own, and can break after the status came
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (cause) {
    return unread(cause);
  }
  if (!blob.type.startsWith("image/"))
    return { failed: `${path} is not an image. Read it in the shell instead.` };
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(blob);
  } catch (cause) {
    // Only a png, jpg, webp or gif is asked for here (isPicture, and a drawing is a png), so
    // naming the formats that can be drawn would always be wrong; the browser's own reason is
    // what says why this one was not
    return {
      failed: `${path} could not be drawn as a picture: ${errorToString(cause)}`,
    };
  }
  try {
    const taken = fitPicture(image, bytes);
    if ("url" in taken) return taken;
    return {
      failed:
        taken.failed === "draw"
          ? "This browser could not draw the picture."
          : `${path} would not fit the ${formatBytes(bytes)} this connection carries, even made smaller.`,
    };
  } finally {
    image.close();
  }
}

/**
 * Why the browser did not hand over the microphone, read off the name `getUserMedia` rejects
 * with. Null for a failure it does not name: a guess at its cause would send the user to the
 * wrong setting, so whoever asks keeps the browser's own words for that one.
 */
export type MicProblem = "refused" | "missing" | "busy";

export function micProblem(error: unknown): MicProblem | null {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "refused";
  if (name === "NotFoundError") return "missing";
  if (name === "NotReadableError") return "busy";
  return null;
}

import type { LiveSession } from "@/lib/live/live.session";
import type { pictureOfFile } from "./picture";

/**
 * Files put down on a spoken call: the fact that names them (she is told the same line once
 * they are in), which of them are pictures, and whether the backend runs on them once they are
 * in (a drawing shown to her).
 */
export type PutDown = { fact: string; pictures: string[]; run?: boolean };

/** What a picture came to: its data URL, or why it could not be made (picture.ts). */
type Taken = Awaited<ReturnType<typeof pictureOfFile>>;

/**
 * Files put down, into the backend's conversation, and only then told to her: told first, she
 * hands over a question about what it has not been given. Each picture among them is read
 * through the file route and made to fit the line first, one after another; then the fact with
 * their paths and every picture go in with nothing awaited between them, so they land on the
 * same side of any turn the backend has running (put in as each was made, a hand-over that
 * began meanwhile read the fact without the pictures). One that cannot be made to fit is said
 * to it instead, never left out unsaid. Asked to, the backend then runs on them, and what it
 * makes of them is hers to say. A put-down is never left untold: she is told when a step
 * failed too, and the failure comes to the caller to say.
 */
export async function putDown(
  live: Pick<LiveSession, "brief" | "picture" | "run" | "pictureRoom">,
  { fact, pictures, run }: PutDown,
  fit: typeof pictureOfFile,
  tell: (fact: string) => void,
) {
  try {
    const made: { path: string; taken: Taken }[] = [];
    for (const path of pictures)
      made.push({ path, taken: await fit(path, live.pictureRoom(path)) });
    // Nothing is awaited from here: the session decides where each of these lands as it is
    // called (live.session waitingOn), and an await would let a turn begin between two of them
    live.brief(fact);
    for (const { path, taken } of made) {
      if ("url" in taken) live.picture(taken.url, path);
      else
        live.brief(
          `${path} could not be put before you as a picture: ${taken.failed}`,
        );
    }
    if (run) live.run();
  } finally {
    tell(fact);
  }
}

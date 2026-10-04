"use client";

import { create } from "zustand";
import { queryKey } from "@/app/api/query-key";
import { notify } from "@/components/ui/notify";
import { toast } from "@/components/ui/toast";
import { UPDATE } from "@/config";
import { unwrapResult } from "@/lib/protocol/result";
import { fetchRoute } from "@/lib/protocol/use-server-route";
import { errorToString } from "@/lib/utils";
import type { Update, UpdateBusy } from "./update";
import { updateNowAction } from "./update.action";

/**
 * A move to a newer version as this page follows it: asked for here or in another tab, and
 * how it ended when it did not work. Outside any component, since the notice on the call
 * screen and the row in Settings both start it and both show it.
 */
type UpdateStore = {
  /** The version being moved to; null when nothing is. */
  to: string | null;
  /**
   * The move that stopped, until another is started. `running` says whether a server answered
   * as it stopped — the one before, running on — or nothing had by the time it was given up on.
   */
  failed: { to: string; why: string; running: boolean } | null;
};

export const useUpdateStore = create<UpdateStore>()(() => ({
  to: null,
  failed: null,
}));

const busyWords = ({ call, threads }: UpdateBusy) =>
  [
    call ? "A call is open and ends when Thursday restarts." : null,
    threads
      ? `${threads === 1 ? "A job is" : `${threads} jobs are`} at work: ${
          threads === 1 ? "it pauses and waits" : "they pause and wait"
        } on Continue, and a routine's run ends.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Follows a move the server started until the new version answers, and then loads the page
 * again on it. The server is down for part of it, which reads as no answer, not as a failure;
 * a server that answers knowing of no move is the one that ran before, loaded again because the
 * new one did not come up (bin/background.mjs putBack).
 */
export async function followUpdate(to: string) {
  if (useUpdateStore.getState().to) return;
  useUpdateStore.setState({ to, failed: null });
  const stop = (why: string, running = true) =>
    useUpdateStore.setState({ to: null, failed: { to, why, running } });
  const until = Date.now() + UPDATE.waitMs;
  while (Date.now() < until) {
    await sleep(UPDATE.pollMs);
    let now: Update;
    try {
      now = (await fetchRoute(queryKey.update)) as Update;
    } catch {
      continue;
    }
    if (now.current === to) return window.location.reload();
    if (now.moving?.failed) return stop(now.moving.failed);
    if (!now.moving)
      return stop(`${now.current ?? "The one before"} runs again.`);
  }
  stop("The new version did not answer in time.", false);
}

/** Update pressed. Asks first when a call is open or jobs are at work, since a restart ends them. */
export async function moveTo(version: string) {
  try {
    let answer = unwrapResult(await updateNowAction(version, false));
    if (!answer.started && answer.busy) {
      const go = await notify.confirm({
        title: `Update to ${version} now?`,
        description: busyWords(answer.busy),
        okText: "Update",
        cancelText: "Later",
        cautious: true,
      });
      if (!go) return;
      answer = unwrapResult(await updateNowAction(version, true));
    }
    if (answer.started) void followUpdate(version);
  } catch (cause) {
    toast.add({
      type: "error",
      title: "Could not start the update",
      description: errorToString(cause),
    });
  }
}

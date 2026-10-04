"use server";

import * as z from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { closeUpdateNotice, startUpdate } from "./update";

/** The notice was closed: it stays away for a day (config UPDATE.quietMs). */
export const closeUpdateNoticeAction = serverAction(async () => {
  await closeUpdateNotice();
});

/**
 * Update pressed. Started at once when nothing is open; with a call open or jobs at work it
 * answers with what is open, and starts only when asked again with `anyway`.
 */
export const updateNowAction = serverAction(
  async (version: unknown, anyway: unknown) =>
    startUpdate(z.string().parse(version), anyway === true),
);

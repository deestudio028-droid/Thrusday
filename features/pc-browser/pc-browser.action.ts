"use server";

import { serverAction } from "@/lib/protocol/server-action";
import { pairPcBrowser, pcBrowserStatus, unpairPcBrowser } from "./bridge";

export const pairPcBrowserAction = serverAction(() => pairPcBrowser());
export const unpairPcBrowserAction = serverAction(() => unpairPcBrowser());
export const pcBrowserStatusAction = serverAction(async () =>
  pcBrowserStatus(),
);

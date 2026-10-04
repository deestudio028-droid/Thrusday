import { readUpdate, type Update } from "@/features/settings/update";
import { serverRoute } from "@/lib/protocol/server-route";

/**
 * Update: the version that runs, npm's newest when it is newer, and how to move there. Asking
 * npm is this read's own doing, at most once a day (config UPDATE.checkMs), so another site
 * sending it gains nothing; what changes anything is an action.
 */
export const GET = serverRoute(async (): Promise<Update> => readUpdate());

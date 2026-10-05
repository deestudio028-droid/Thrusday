import { pcBrowserStatus } from "@/features/pc-browser/bridge";
import { serverRoute } from "@/lib/protocol/server-route";

export const GET = serverRoute(async () => pcBrowserStatus());

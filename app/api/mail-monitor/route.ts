import { monitorStatus } from "@/features/mail-monitor/monitor";
import { serverRoute } from "@/lib/protocol/server-route";
export const GET = serverRoute(monitorStatus);

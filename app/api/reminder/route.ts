import { callBudgetStatus } from "@/features/reminder/call";
import { listReminders } from "@/features/reminder/reminder.query";
import { serverRoute } from "@/lib/protocol/server-route";

export const GET = serverRoute(async () => ({
  reminders: await listReminders(),
  callBudget: await callBudgetStatus(),
}));

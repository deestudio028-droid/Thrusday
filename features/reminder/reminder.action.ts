"use server";

import * as z from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { cancelReminder, createReminder } from "./reminder.query";
import { ReminderInputSchema } from "./reminder.schema";

export const createReminderAction = serverAction(async (input: unknown) =>
  createReminder(ReminderInputSchema.parse(input)),
);

export const cancelReminderAction = serverAction(async (id: unknown) =>
  cancelReminder(z.uuid().parse(id)),
);

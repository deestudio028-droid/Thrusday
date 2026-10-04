"use server";

import * as z from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { removeMailbox, saveMailbox } from "./mailbox";
import { allowReach, declineReach, forgetReach, nameReach } from "./reach";
import { NAMED_CHANNELS, REACH_CHANNELS } from "./reach.schema";

const Name = z.enum(REACH_CHANNELS);
/** Who is being asked about, as the screen was shown them: the conversation and its code. */
const Ask = z.object({ chat: z.string().min(1), code: z.string().min(1) });

/** The user let in whoever is asking to write through that service. */
export const allowReachAction = serverAction(
  async (name: unknown, ask: unknown) => {
    const { chat, code } = Ask.parse(ask);
    await allowReach(Name.parse(name), chat, code);
  },
);

export const declineReachAction = serverAction(
  async (name: unknown, ask: unknown) => {
    const { chat, code } = Ask.parse(ask);
    declineReach(Name.parse(name), chat, code);
  },
);

/** Nobody may write through that service any more. */
export const forgetReachAction = serverAction(async (name: unknown) => {
  await forgetReach(Name.parse(name));
});

const Address = z.email().max(254);

/** The address that may write through a service that names them (email): the user's own. */
export const nameReachAction = serverAction(
  async (name: unknown, address: unknown) => {
    await nameReach(z.enum(NAMED_CHANNELS).parse(name), Address.parse(address));
  },
);

/** Thursday's own mailbox, and the servers it is read and sent through when typed in. */
const Mailbox = z.object({
  address: Address,
  // An app password is 16 letters at Google; others differ, and a real one is never short
  password: z.string().trim().min(8).max(256),
  imap: z.string().max(260).optional(),
  smtp: z.string().max(260).optional(),
});

export const saveMailboxAction = serverAction(async (mailbox: unknown) =>
  saveMailbox(Mailbox.parse(mailbox)),
);

export const removeMailboxAction = serverAction(async () => {
  await removeMailbox();
});

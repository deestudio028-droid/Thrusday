"use server";

import * as z from "zod";
import { serverAction } from "@/lib/protocol/server-action";
import { removeSignIn, setSignInBot } from "./signins.query";

const Site = z.string().trim().min(1);
/** As the list gave it: the account names the sign-in's file. */
const Account = z.string().min(1);

/** The user lets a bot borrow one account's sign-in, or takes that back. */
export const setSignInBotAction = serverAction(
  async (site: unknown, account: unknown, bot: unknown, on: unknown) => {
    await setSignInBot(
      Site.parse(site),
      Account.parse(account),
      z.string().min(1).parse(bot),
      z.boolean().parse(on),
    );
  },
);

export const removeSignInAction = serverAction(
  async (site: unknown, account: unknown) => {
    await removeSignIn(Site.parse(site), Account.parse(account));
  },
);

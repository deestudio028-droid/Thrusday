"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ShinyText } from "@/components/ui/shiny-text";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { openSettings, useSettingsStore } from "../settings.store";
import type { Update } from "../update";
import { closeUpdateNoticeAction } from "../update.action";
import { followUpdate, moveTo, useUpdateStore } from "../update.store";

type Failed = ReturnType<typeof useUpdateStore.getState>["failed"];

/**
 * Says a newer version on the call screen, under the settings corner: a square card on the
 * other theme's surface, so it stands off the page, with her mark, the two versions and the
 * button. It stays until Update or Not today is pressed, and Not today keeps it away for a day
 * (config UPDATE.quietMs) in every tab. While a move is under way the same card says so, and
 * one that stopped says that. Reading it is also what asks npm, at most once a day, so nothing
 * is asked while no browser is open. `hidden` keeps it out of the way of a call, a ring, a call
 * in writing and whatever covers the screen; it goes on following a move meanwhile.
 */
export function UpdateNotice({ hidden }: { hidden: boolean }) {
  // The server is down for a moment during a move: a read that fails then is not news
  const { data } = useServerRoute<Update>(queryKey.update, {
    onError: () => {},
  });
  const { to, failed } = useUpdateStore();

  // A move another tab started, or one under way as this page loaded
  const going = data?.moving && !data.moving.failed ? data.moving.to : null;
  useEffect(() => {
    if (going) void followUpdate(going);
  }, [going]);

  // A server of another version than the one this page was loaded from: moved in another
  // tab, or from a terminal. That tab's card went and the page stayed the old one, so it
  // loads again, as the tab that pressed Update does (update.store followUpdate)
  const loaded = useRef<string | null>(null);
  const current = data?.current ?? null;
  useEffect(() => {
    if (!current) return;
    if (!loaded.current) loaded.current = current;
    else if (loaded.current !== current) window.location.reload();
  }, [current]);

  // Put away on this page at once; the server keeps the notice away for the day
  const [closed, setClosed] = useState<string | null>(null);
  // The failure that was closed, not its version: a second try at the same version that
  // stops again is another failure, and is said again
  const [dismissed, setDismissed] = useState<Failed>(null);

  // Settings opens over the corner and stops 4px short of the window's edge: the card's dark
  // surface showed past it as a strip
  const settings = useSettingsStore((state) => state.open);
  if (hidden || settings) return null;

  if (to)
    return (
      <Card>
        <p className="mt-3 text-[15px] leading-tight font-medium">
          <ShinyText text={`Updating to ${to}…`} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Thursday restarts in a moment.
        </p>
      </Card>
    );

  if (failed && dismissed !== failed)
    return (
      <Card>
        <p className="mt-3 text-[15px] leading-tight font-medium">
          Could not update to {failed.to}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {/* Only said of a server that answered: given up on with none answering, it is not known to */}
          {failed.running
            ? "The one before runs on."
            : "Thursday is not answering."}
        </p>
        <Actions
          primary="See why"
          onPrimary={() => openSettings("thursday")}
          secondary="Close"
          onSecondary={() => setDismissed(failed)}
        />
      </Card>
    );

  const newer = data?.notice ? data.newer : null;
  if (!newer || closed === newer) return null;
  return (
    <Card>
      <p className="mt-3 text-[15px] leading-tight font-medium">
        Thursday {newer} is out
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        You run {data?.current}
      </p>
      <Actions
        primary={data?.byButton ? "Update" : "How to update"}
        onPrimary={() =>
          data?.byButton ? void moveTo(newer) : openSettings("thursday")
        }
        secondary="Not today"
        onSecondary={() => {
          setClosed(newer);
          void closeUpdateNoticeAction().then(() =>
            revalidate(queryKey.update),
          );
        }}
      />
    </Card>
  );
}

/** The card: her mark over what it says, on the other theme's surface. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="inverse">
      <div className="flex size-60 animate-in flex-col items-center rounded-[28px] bg-background p-5 text-center text-foreground shadow-[0_22px_44px_-20px_rgb(0_0_0/0.22)] duration-300 fade-in slide-in-from-top-1">
        <ThursdayMark size={72} className="mt-1" />
        {children}
      </div>
    </div>
  );
}

function Actions({
  primary,
  onPrimary,
  secondary,
  onSecondary,
}: {
  primary: string;
  onPrimary: () => void;
  secondary: string;
  onSecondary: () => void;
}) {
  return (
    <div className="mt-auto flex w-full gap-1.5">
      <Button className="flex-1 rounded-full" onClick={onPrimary}>
        {primary}
      </Button>
      <Button
        variant="ghost"
        className="rounded-full px-3 text-muted-foreground"
        onClick={onSecondary}
      >
        {secondary}
      </Button>
    </div>
  );
}

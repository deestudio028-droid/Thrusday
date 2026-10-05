"use client";

import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cancelReminderAction, createReminderAction } from "../reminder.action";

type Reminder = {
  id: string;
  label: string;
  words: string;
  dueAt: string;
  timeZone: string;
  cancelledAt: string | null;
  deliveries: {
    channel: "email" | "telegram" | "call";
    status: string;
    detail: string | null;
    providerStatus?: string | null;
  }[];
};
type ReminderPage = {
  reminders: Reminder[];
  callBudget: {
    limit: number;
    used: number;
    remaining: number;
    ready: boolean;
  };
};

export function ReminderList() {
  const { data, isLoading } = useServerRoute<ReminderPage>(queryKey.reminders);
  const [label, setLabel] = useState("");
  const [words, setWords] = useState("");
  const [at, setAt] = useState("");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [create, creating] = useServerAction(createReminderAction, {
    onOk: () => {
      setLabel("");
      setWords("");
      setAt("");
      void revalidate(queryKey.reminders);
    },
  });
  const [cancel, cancelling] = useServerAction(cancelReminderAction, {
    onOk: () => void revalidate(queryKey.reminders),
  });

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h3 className="font-semibold">One-time reminders</h3>
        <p className="text-sm text-muted-foreground">
          At the chosen time, Thursday attempts email, Telegram and a call to
          your own mobile. Each needs its own connection in Phone settings.
          Provider acceptance does not confirm delivery or an answered call.
        </p>
        {data?.callBudget ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Mobile calls:{" "}
            {data.callBudget.ready
              ? `${data.callBudget.remaining} of ${data.callBudget.limit} attempts left in the rolling 31-day safety window`
              : "off until your own verified mobile, Twilio credentials, caller number and cap are set in API keys › Phone"}
            .{" "}
            <a
              className="underline"
              href="https://www.twilio.com/docs/usage/trials/try-out-voice"
              target="_blank"
              rel="noopener noreferrer"
            >
              Provider setup
            </a>
          </p>
        ) : null}
      </div>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!at) return;
          void create({
            label,
            words,
            at: at.replace("T", " "),
            timeZone: zone,
          });
        }}
      >
        <Input
          aria-label="Reminder name"
          placeholder="Name"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
          maxLength={80}
        />
        <Input
          aria-label="Reminder time"
          type="datetime-local"
          value={at}
          onChange={(event) => setAt(event.target.value)}
          required
        />
        <Textarea
          aria-label="Reminder message"
          placeholder="What should Thursday tell you?"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          required
          maxLength={2000}
          className="sm:col-span-2"
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button
            type="submit"
            disabled={creating || !label.trim() || !words.trim() || !at}
          >
            Schedule reminder
          </Button>
          <span className="text-xs text-muted-foreground">{zone}</span>
        </div>
      </form>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading reminders…</p>
      ) : null}
      <div className="space-y-2">
        {(data?.reminders ?? []).map((reminder) => (
          <div
            key={reminder.id}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{reminder.label}</p>
                <p className="text-muted-foreground">
                  {new Date(reminder.dueAt).toLocaleString()} ·{" "}
                  {reminder.timeZone}
                  {reminder.cancelledAt ? " · cancelled" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{reminder.words}</p>
              </div>
              {!reminder.cancelledAt && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancelling}
                  onClick={() => void cancel(reminder.id)}
                >
                  Cancel
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {reminder.deliveries
                .map(
                  (delivery) =>
                    `${delivery.channel}: ${delivery.status}${delivery.channel === "call" && delivery.providerStatus ? ` · Twilio ${delivery.providerStatus}` : ""}${delivery.detail ? ` (${delivery.detail})` : ""}`,
                )
                .join(" · ")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

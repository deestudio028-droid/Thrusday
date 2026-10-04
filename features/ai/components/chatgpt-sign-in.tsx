"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { CHATGPT_SIGN_IN } from "@/config";
import {
  cancelChatGptDeviceSignInAction,
  pollChatGptDeviceSignInAction,
  startChatGptSignInAction,
} from "@/features/config/config.action";
import { useServerAction } from "@/lib/protocol/use-server-action";

/** How often to look whether the sign-in window was closed. It is looked for as long as the server listens for its answer (config CHATGPT_SIGN_IN.waitMs). */
const WINDOW_POLL_MS = 700;
type DeviceFlow = {
  id: string;
  url: string;
  userCode: string;
  expiresAt: number;
  intervalMs: number;
};

/** Opens a sign-in address in the sign-in window, saying so when the browser blocks it. */
function openSignInWindow(url: string): Window | null {
  const popup = window.open(
    url,
    "thursday-chatgpt",
    "popup,width=520,height=720",
  );
  if (!popup)
    toast.add({
      type: "error",
      title: "The sign-in window was blocked",
      description: "Allow pop-ups for this page, then try again",
    });
  return popup;
}

/**
 * Opens ChatGPT's sign-in in a window of its own. The answer lands on the server, which keeps it
 * and signals the screen (`config`); whoever draws this takes it away once signed in. Until then
 * the button waits, and stops waiting when the window is closed without finishing.
 */
export function ChatGptSignIn({
  variant,
  size,
  className,
  label = "Sign in with ChatGPT",
}: {
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  /** What the button says; the sign-in it starts is the same. */
  label?: string;
}) {
  const [waiting, setWaiting] = useState(false);
  const [device, setDevice] = useState<DeviceFlow | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const watch = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWatching = () => {
    if (watch.current) clearInterval(watch.current);
    watch.current = null;
  };
  useEffect(() => stopWatching, []);

  const [poll] = useServerAction(pollChatGptDeviceSignInAction, {
    errorMessage: false,
  });
  const [cancel, cancelling] = useServerAction(
    cancelChatGptDeviceSignInAction,
    {
      onOk: () => {
        setDevice(null);
        setWaiting(false);
        setDeviceError(null);
      },
    },
  );
  useEffect(() => {
    if (!device) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (disposed) return;
      if (Date.now() >= device.expiresAt) {
        setDevice(null);
        setWaiting(false);
        setDeviceError("The sign-in code expired. Start a fresh sign-in.");
        return;
      }
      try {
        const status = await poll(device.id);
        if (disposed) return;
        if (status === "signed-in") {
          setDevice(null);
          setWaiting(false);
          return;
        }
        if (status !== "waiting") {
          setDevice(null);
          setWaiting(false);
          setDeviceError(
            status === "expired"
              ? "The sign-in code expired. Start a fresh sign-in."
              : "This sign-in was cancelled or replaced. Start again.",
          );
          return;
        }
        timer = setTimeout(check, device.intervalMs);
      } catch (cause) {
        if (disposed) return;
        setDevice(null);
        setWaiting(false);
        setDeviceError(
          cause instanceof Error
            ? cause.message
            : "Sign-in failed. Start again.",
        );
      }
    };
    timer = setTimeout(check, device.intervalMs);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [device, poll]);

  const [start, starting] = useServerAction(startChatGptSignInAction, {
    onOk: (flow) => {
      setDeviceError(null);
      if (flow.kind === "device") {
        stopWatching();
        setDevice(flow);
        setWaiting(true);
        return;
      }
      const popup = openSignInWindow(flow.url);
      if (!popup) return;
      setWaiting(true);
      stopWatching();
      const deadline = Date.now() + CHATGPT_SIGN_IN.waitMs;
      watch.current = setInterval(() => {
        if (!popup.closed && Date.now() < deadline) return;
        stopWatching();
        setWaiting(false);
      }, WINDOW_POLL_MS);
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        size={size}
        className={className}
        loading={starting || waiting}
        onClick={() => start()}
      >
        {label}
      </Button>
      {device && (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Open ChatGPT, sign in yourself, and enter this one-time code. It
            expires in 15 minutes. Only use the code for the sign-in you just
            started here.
          </p>
          <code className="select-all font-mono text-lg text-foreground">
            {device.userCode}
          </code>
          <a
            href={device.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Continue with ChatGPT
          </a>
          <p>
            If ChatGPT asks, enable device code login in its Security settings.
            Return here after approving the account connection.
          </p>
          <Button
            variant="outline"
            loading={cancelling}
            onClick={() => cancel(device.id)}
          >
            Cancel sign-in
          </Button>
        </div>
      )}
      {deviceError && <p className="text-sm text-destructive">{deviceError}</p>}
    </div>
  );
}

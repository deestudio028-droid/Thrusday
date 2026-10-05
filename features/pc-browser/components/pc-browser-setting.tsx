"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/lib/protocol/use-server-action";
import {
  pairPcBrowserAction,
  pcBrowserStatusAction,
  unpairPcBrowserAction,
} from "../pc-browser.action";

export function PcBrowserSetting() {
  const [key, setKey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [status] = useServerAction(pcBrowserStatusAction, {
    onOk: (value) => setConnected(value.connected),
    errorMessage: false,
  });
  const [pair, pairing] = useServerAction(pairPcBrowserAction, {
    onOk: (value) => {
      setKey(value);
      setConnected(false);
    },
  });
  const [unpair, unpairing] = useServerAction(unpairPcBrowserAction, {
    onOk: () => {
      setKey(null);
      setConnected(false);
    },
  });
  useEffect(() => {
    void status();
    const timer = window.setInterval(() => void status(), 5000);
    return () => window.clearInterval(timer);
  }, [status]);
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h3 className="font-semibold">Your PC Chrome</h3>
      <p className="text-sm text-muted-foreground">
        Thursday can work in one tab you choose on your own Chrome. Install the
        extension on that PC, pair it once, then open its icon and Share this
        tab. The extension has Pause and Stop controls. Chrome must stay open.
      </p>
      <p className="text-sm">
        Status:{" "}
        {connected ? "connected to a selected tab" : "offline or paused"}
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href="/pc-browser-extension.zip"
          download="thursday-pc-chrome.zip"
          className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm"
        >
          Download extension
        </a>
        <Button
          variant="outline"
          disabled={pairing}
          onClick={() => void pair()}
        >
          Create new pairing key
        </Button>
        <Button
          variant="outline"
          disabled={unpairing}
          onClick={() => void unpair()}
        >
          Unpair Chrome
        </Button>
      </div>
      {key ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Copy this key into the extension. It appears only now; creating
            another key revokes the previous one.
          </p>
          <code
            className="block break-all text-xs"
            aria-label="One-time shown pairing key"
          >
            {key}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(key)}
          >
            Copy key
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setKey(null)}>
            Hide key
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        In Chrome, open chrome://extensions, enable Developer mode, unzip the
        download and choose Load unpacked. Select the extracted folder, then
        click its Thursday icon on the web tab you want to share.
      </p>
    </section>
  );
}

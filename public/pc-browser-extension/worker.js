const local = chrome.storage.local;
const session = chrome.storage.session;
let polling = false;

async function status() {
  const { pairedKey } = await local.get("pairedKey");
  const { tabId, paused } = await session.get(["tabId", "paused"]);
  return {
    paired: Boolean(pairedKey),
    tabId: tabId ?? null,
    paused: Boolean(paused),
  };
}

async function requirePair() {
  const { pairedKey, serverOrigin } = await local.get([
    "pairedKey",
    "serverOrigin",
  ]);
  if (!pairedKey || !serverOrigin)
    throw Error(
      "Not paired. Enter your server address and pairing key, then press Pair this Chrome first.",
    );
}

async function verifyPair(pairedKey, serverOrigin) {
  const response = await fetch(
    `${serverOrigin}/api/pc-browser/bridge?verify=1`,
    {
      headers: {
        authorization: `Bearer ${pairedKey}`,
        "ngrok-skip-browser-warning": "1",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status === 401)
    throw Error(
      "Thursday rejected this key. Copy the current key from this same server and pair again.",
    );
  if (!response.ok)
    throw Error(`Thursday pairing check failed (${response.status}).`);
  const result = await response.json();
  if (result.paired !== true)
    throw Error(
      "This server did not confirm pairing. Update Thursday and use its HTTPS address.",
    );
}

async function selectedTab() {
  const { tabId, paused } = await session.get(["tabId", "paused"]);
  if (paused || !tabId)
    throw Error("Paused or no tab shared. Open the extension and share a tab.");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:\/\//.test(tab.url))
    throw Error("Keep the shared web tab open, or share another tab.");
  return tab;
}

async function execute(command) {
  const tab = await selectedTab();
  const args = command.args ?? {};
  if (command.method === "navigate") {
    const url = new URL(args.url);
    if (!["http:", "https:"].includes(url.protocol))
      throw Error("Only web URLs are allowed.");
    await chrome.tabs.update(tab.id, { url: url.href });
    return {
      url: url.href,
      note: "Navigation started. Take a new snapshot after loading.",
    };
  }
  if (["back", "forward", "reload"].includes(command.method)) {
    if (command.method === "back") await chrome.tabs.goBack(tab.id);
    if (command.method === "forward") await chrome.tabs.goForward(tab.id);
    if (command.method === "reload") await chrome.tabs.reload(tab.id);
    return {
      note: `${command.method} started. Take a new snapshot after loading.`,
    };
  }
  const [run] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (method, input) => {
      const selectorOf = (element) => {
        if (element.id && CSS.escape(element.id))
          return `#${CSS.escape(element.id)}`;
        const path = [];
        for (
          let one = element;
          one && one.nodeType === 1 && path.length < 8;
          one = one.parentElement
        ) {
          const tag = one.tagName.toLowerCase();
          const siblings = one.parentElement
            ? [...one.parentElement.children].filter(
                (child) => child.tagName === one.tagName,
              )
            : [];
          path.unshift(
            `${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(one) + 1})` : ""}`,
          );
        }
        return path.join(" > ");
      };
      if (method === "snapshot") {
        const nodes = [
          ...document.querySelectorAll(
            "a,button,input,textarea,select,[role=button]",
          ),
        ].slice(0, 100);
        return {
          title: document.title,
          url: location.href,
          text: (document.body?.innerText ?? "").slice(0, 18000),
          elements: nodes
            .filter(
              (el) =>
                el.getBoundingClientRect().width &&
                el.getBoundingClientRect().height,
            )
            .map((el) => ({
              selector: selectorOf(el).slice(0, 500),
              role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
              label: (
                el.getAttribute("aria-label") ??
                el.getAttribute("placeholder") ??
                el.innerText ??
                ""
              ).slice(0, 120),
            })),
        };
      }
      if (method === "scroll") {
        window.scrollBy({
          top: Math.max(-1200, Math.min(1200, Number(input.pixels ?? 600))),
          behavior: "instant",
        });
        return { scrolled: window.scrollY };
      }
      const element = document.querySelector(input.selector ?? "");
      if (!element)
        throw Error("Element changed or disappeared. Take a new snapshot.");
      if (method === "click") {
        element.click();
        return { clicked: input.selector };
      }
      if (method === "fill") {
        if (
          !(
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          )
        )
          throw Error("Select an input or text area.");
        if (
          element.type === "password" ||
          /^cc-/.test(element.autocomplete ?? "")
        )
          throw Error("Enter passwords and payment details yourself.");
        element.focus();
        const setter = Object.getOwnPropertyDescriptor(
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        )?.set;
        if (!setter) throw Error("Cannot fill this field.");
        setter.call(element, input.text ?? "");
        element.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: input.text ?? "" }),
        );
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { filled: input.selector };
      }
      throw Error("Unsupported action.");
    },
    args: [command.method, args],
  });
  if (run.error) throw Error(run.error.message);
  return run.result;
}

async function loop() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const { pairedKey, serverOrigin } = await local.get([
        "pairedKey",
        "serverOrigin",
      ]);
      if (!pairedKey || !serverOrigin) return;
      const state = await status();
      let ready = state.tabId !== null && !state.paused;
      if (ready) {
        try {
          await selectedTab();
        } catch {
          ready = false;
        }
      }
      let response;
      try {
        response = await fetch(`${serverOrigin}/api/pc-browser/bridge`, {
          headers: {
            authorization: `Bearer ${pairedKey}`,
            "x-thursday-ready": ready ? "1" : "0",
            // ngrok's documented API header prevents its HTML landing page
            // replacing JSON when using a development tunnel.
            "ngrok-skip-browser-warning": "1",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        const kept = await local.get(["pairedKey", "serverOrigin"]);
        if (kept.pairedKey !== pairedKey || kept.serverOrigin !== serverOrigin)
          continue;
        await session.set({
          connectionProblem: `Could not reach ${serverOrigin}. Check the address and Chrome website permission.`,
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      const currentPair = await local.get(["pairedKey", "serverOrigin"]);
      if (
        currentPair.pairedKey !== pairedKey ||
        currentPair.serverOrigin !== serverOrigin
      )
        continue;
      if (response.status === 401) {
        await local.remove("pairedKey");
        await local.set({
          pairingError:
            "Thursday rejected this key. Copy a fresh key from the same Thursday server address and pair again.",
        });
        return;
      }
      if (!response.ok) {
        await session.set({
          connectionProblem: `Thursday connection failed (${response.status}).`,
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      let command;
      try {
        ({ command } = await response.json());
      } catch {
        await session.set({
          connectionProblem:
            "The server returned a page instead of browser JSON. Check the Thursday address.",
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      await session.set({ lastPollAt: Date.now(), connectionProblem: null });
      if (!command || !ready) continue;
      let result;
      try {
        result = { id: command.id, ok: true, value: await execute(command) };
      } catch (error) {
        result = {
          id: command.id,
          ok: false,
          error: String(error?.message ?? error).slice(0, 500),
        };
      }
      await fetch(`${serverOrigin}/api/pc-browser/bridge`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${pairedKey}`,
          "content-type": "application/json",
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify(result),
      }).catch(() => {});
    }
  } finally {
    polling = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.kind === "pair") {
      const origin = new URL(message.serverOrigin);
      if (
        origin.protocol !== "https:" ||
        origin.username ||
        origin.password ||
        origin.href !== `${origin.origin}/`
      )
        throw Error("Enter your Thursday HTTPS address without a path.");
      if (!/^[A-Za-z0-9_-]{43}$/.test(message.key))
        throw Error("Copy the pairing key from Thursday Settings.");
      if (
        !(await chrome.permissions.contains({
          origins: [`${origin.origin}/*`],
        }))
      )
        throw Error("Allow access to your Thursday server before pairing.");
      try {
        await verifyPair(message.key, origin.origin);
      } catch (error) {
        await local.set({ pairingError: String(error?.message ?? error) });
        throw error;
      }
      await local.set({ pairedKey: message.key, serverOrigin: origin.origin });
      await local.remove(["pendingPair", "pairingError"]);
      await session.set({
        paused: true,
        lastPollAt: null,
        connectionProblem: null,
      });
      void loop();
      return {
        message:
          "Paired and verified by Thursday. Open a web tab, then press Share this tab.",
      };
    }
    if (message.kind === "share") {
      await requirePair();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !/^https?:\/\//.test(tab.url ?? ""))
        throw Error("Open a normal web tab first.");
      await session.set({ tabId: tab.id, paused: false });
      void loop();
      return {
        message: `Tab selected: ${tab.title ?? tab.url}. Connecting to Thursday…`,
      };
    }
    if (message.kind === "pause") {
      await session.set({ paused: true });
      return { message: "Paused. Thursday cannot act on the tab." };
    }
    if (message.kind === "stop") {
      await local.remove(["pairedKey", "pendingPair", "pairingError"]);
      await session.clear();
      return {
        message:
          "Stopped and pairing key forgotten. Also unpair in Thursday Settings.",
      };
    }
    const current = await status();
    const { pairingError, serverOrigin } = await local.get([
      "pairingError",
      "serverOrigin",
    ]);
    const { connectionProblem, lastPollAt } = await session.get([
      "connectionProblem",
      "lastPollAt",
    ]);
    if (current.paired) void loop();
    return {
      message:
        pairingError ??
        (current.paired
          ? connectionProblem
            ? connectionProblem
            : current.paused
              ? `Paired to ${serverOrigin}, paused.`
              : lastPollAt && Date.now() - lastPollAt < 45_000
                ? `Connected to ${serverOrigin}. Sharing the selected tab.`
                : `Tab selected; waiting for ${serverOrigin} to confirm its connection.`
          : "Not paired."),
    };
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error?.message ?? error) }));
  return true;
});
// Permission prompts outlive the popup that initiated them. Complete pairing in
// this persistent worker instead of relying on that popup remaining open.
chrome.permissions.onAdded.addListener(async () => {
  const { pendingPair } = await local.get("pendingPair");
  if (!pendingPair || !/^[A-Za-z0-9_-]{43}$/.test(pendingPair.key)) return;
  let origin;
  try {
    origin = new URL(pendingPair.serverOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.href !== `${origin.origin}/`
    )
      return;
  } catch {
    return;
  }
  if (!(await chrome.permissions.contains({ origins: [`${origin.origin}/*`] })))
    return;
  try {
    await verifyPair(pendingPair.key, origin.origin);
  } catch (error) {
    await local.set({ pairingError: String(error?.message ?? error) });
    await local.remove("pendingPair");
    return;
  }
  await local.set({ pairedKey: pendingPair.key, serverOrigin: origin.origin });
  await local.remove(["pendingPair", "pairingError"]);
  await session.set({
    paused: true,
    lastPollAt: null,
    connectionProblem: null,
  });
  void loop();
});
chrome.runtime.onStartup.addListener(() => {
  void loop();
});
chrome.runtime.onInstalled.addListener(() => {
  void loop();
});

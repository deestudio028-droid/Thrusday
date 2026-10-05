const status = document.getElementById("status");
const key = document.getElementById("key");
const server = document.getElementById("server");
const say = (message) => {
  status.textContent = message;
};
const send = (message) =>
  chrome.runtime.sendMessage(message).then((result) => {
    if (result?.error) say(result.error);
    else say(result?.message ?? "Done.");
  });
document.getElementById("pair").onclick = async () => {
  const value = key.value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    return say("Copy the pairing key from Thursday Settings.");
  let origin;
  try {
    const url = new URL(server.value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.href !== `${url.origin}/`
    )
      throw Error();
    origin = url.origin;
  } catch {
    return say("Enter your Thursday HTTPS address without a path.");
  }
  // Chrome can close this popup while showing the host permission prompt. The
  // worker completes this saved request when permission is granted.
  await chrome.storage.local.set({
    pendingPair: { key: value, serverOrigin: origin },
  });
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    await chrome.storage.local.remove("pendingPair");
    return say("Server access was not allowed. Pairing was not saved.");
  }
  await send({ kind: "pair", key: value, serverOrigin: origin });
  key.value = "";
};
document.getElementById("share").onclick = () => send({ kind: "share" });
document.getElementById("pause").onclick = () => send({ kind: "pause" });
document.getElementById("stop").onclick = () => send({ kind: "stop" });
const sites = document.getElementById("sites");
const webOrigins = ["https://*/*", "http://*/*"];
sites.onchange = async () => {
  if (sites.checked) {
    sites.checked = await chrome.permissions.request({ origins: webOrigins });
    say(
      sites.checked
        ? "Website access allowed. Only your selected shared tab can be controlled."
        : "Website access was not allowed.",
    );
  } else {
    await chrome.permissions.remove({ origins: webOrigins });
    say(
      "Website access removed. Pair again if server access was also removed.",
    );
  }
};
chrome.permissions.contains({ origins: webOrigins }).then((allowed) => {
  sites.checked = allowed;
});
send({ kind: "status" });
// Refresh while this popup is open so local tab selection is not mistaken for server acceptance.
setInterval(() => send({ kind: "status" }), 1000);
chrome.storage.local.get("serverOrigin").then((saved) => {
  server.value = saved.serverOrigin ?? "";
});

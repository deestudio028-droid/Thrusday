// What the shell does for every kind: the theme button, the menus, export, the app when it
// is the one showing the page, and a few things each kind builds its body from — a
// miniature of an element, whether a picture sits beside the file, a copy of the page to
// keep. Runs before the kind's own script and leaves `shell` on the window for it.
window.shell = (() => {
  // shell.drafts
  const THEME = "thursday-shell-theme";
  const root = document.documentElement;
  const face = root.classList.contains("sh-face");

  /* Theme: device → light → dark → device, kept in this browser where the page may keep
     anything — the app serves it sandboxed, and there it lasts as long as the page is open.
     The button draws the mode it is in (shell.css); a face is always light and keeps nothing. */
  const theme = {
    get: () => root.dataset.theme || "",
    set(value) {
      if (value) root.dataset.theme = value;
      else delete root.dataset.theme;
      if (face) return;
      try {
        if (value) localStorage.setItem(THEME, value);
        else localStorage.removeItem(THEME);
      } catch {}
      for (const button of document.querySelectorAll("[data-theme-cycle]"))
        button.setAttribute("aria-label", `Theme: ${value || "as the device"}`);
    },
    next() {
      const order = ["", "light", "dark"];
      theme.set(order[(order.indexOf(theme.get()) + 1) % order.length]);
    },
  };
  for (const button of document.querySelectorAll("[data-theme-cycle]")) {
    button.addEventListener("click", theme.next);
    button.setAttribute(
      "aria-label",
      `Theme: ${theme.get() || "as the device"}`,
    );
  }

  /* Menus close when anything else is pressed, when one of their items is, or on Esc —
     and an Esc that closed one does nothing else, so one Esc is one thing. This runs
     before the kind's own listener, which then never hears it. */
  const openMenus = () => document.querySelectorAll("details.sh-menu[open]");
  addEventListener("pointerdown", (event) => {
    for (const menu of openMenus())
      if (!menu.contains(event.target)) menu.open = false;
  });
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = openMenus();
    if (!open.length) return;
    for (const menu of open) menu.open = false;
    event.stopImmediatePropagation();
  });
  for (const item of document.querySelectorAll(".sh-menu .sh-item"))
    item.addEventListener("click", () =>
      item.closest("details")?.removeAttribute("open"),
    );

  /** A file named `name` holding `text`, handed to the browser to keep. */
  const download = (name, text, type = "text/html") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** The name this file was opened as, for a copy of it. */
  const fileName = () =>
    decodeURIComponent(location.pathname.split("/").pop() || "") ||
    `${document.title || "page"}.html`;

  /**
   * The page as a file again: a copy of the document with what only the reader's
   * session put there taken out. `clean` is the kind's own pass over that copy — the
   * state of its editor, its miniatures — before the text is made.
   */
  const serialize = (clean) => {
    const copy = root.cloneNode(true);
    copy.removeAttribute("data-theme");
    for (const el of copy.querySelectorAll("details.sh-menu[open]"))
      el.removeAttribute("open");
    // Where editing stood when the copy was made
    const state = copy.querySelector("#state");
    state?.replaceChildren();
    state?.removeAttribute("title");
    state?.removeAttribute("data-warn");
    copy.querySelector("[data-reload]")?.setAttribute("hidden", "");
    copy.querySelector("[data-discard]")?.setAttribute("hidden", "");
    copy.querySelector("[data-edit]")?.classList.remove("sh-on");
    const word = copy.querySelector("[data-edit] .sh-word");
    if (word) word.textContent = "Edit";
    clean?.(copy);
    return `<!doctype html>\n${copy.outerHTML}\n`;
  };

  /* Export: what every kind can do for itself. A kind adds its own items. */
  for (const item of document.querySelectorAll("[data-export]"))
    item.addEventListener("click", () => {
      if (item.dataset.export === "print") print();
      else download(fileName(), serialize(window.shell?.clean));
    });

  /**
   * The app, when it is the one showing this page. It frames the page and, asked, says
   * it will keep the page's edits, with a name for the file this page was opened as
   * (`as`); every save carries that name back, and the app keeps it in that file whatever
   * its frame shows by the time it arrives. Anywhere else nobody answers, and a kind keeps
   * a copy instead. The app serves this page sandboxed, on an origin of its own, so the
   * app's origin is learned from its answer and every save goes there alone.
   *
   * A save also carries the revision in the page's head: the one it was opened at, then
   * the one each save came back with. A file written since — a bot's put, another
   * window's save — names another, and the save fails with `changed` rather than undo it.
   * Saves go one at a time, so each names the revision the one before it left.
   *
   * The hello says the page takes `changed`: the app sends it when the file was written
   * while the page is open, with the revision the file now holds. The same revision as the
   * page's is its own save come back; any other is someone else's write, which the page
   * shows (`edits` below) — the app cannot tell from outside whether anyone is editing.
   *
   * It also says the page asks for `drafts`: words the file could not take — a save
   * refused or failed — which the app keeps aside for the file until a later save or the
   * reader lets them go (drafts.js; the app's features/workspace/page-drafts.ts). The
   * page cannot keep them itself, since a page the app serves keeps nothing.
   */
  const host = (() => {
    const parent = window.parent !== window ? window.parent : null;
    let app = ""; // the app's origin, once it has answered
    const revision = document.querySelector('meta[name="revision"]');
    let keeps = false;
    let as = "";
    let next = 0;
    let line = Promise.resolve();
    const waiting = new Map();
    const heard = new Set();
    const written = new Set();
    addEventListener("message", (event) => {
      if (!parent || event.source !== parent) return;
      const said = event.data;
      if (!said || typeof said.thursday !== "string") return;
      if (said.thursday === "host") {
        if (keeps || typeof said.as !== "string") return;
        keeps = true;
        as = said.as;
        app = event.origin;
        for (const fn of heard) fn();
        return;
      }
      // An answer meant for another page this frame held before, or from elsewhere
      if (event.origin !== app || said.as !== as) return;
      if (said.thursday === "changed") {
        if (
          said.revision &&
          said.revision === revision?.getAttribute("content")
        )
          return;
        for (const fn of written) fn();
        return;
      }
      const one = waiting.get(said.id);
      if (!one) return;
      waiting.delete(said.id);
      if (said.thursday === "saved") {
        if (said.revision) revision?.setAttribute("content", said.revision);
        one.ok();
        return;
      }
      if (said.thursday === "drafts") {
        one.ok(
          Array.isArray(said.drafts) ? said.drafts.filter(drafts.valid) : [],
        );
        return;
      }
      // `not-saved`, or `not-held` for words the app could not keep aside
      const error = new Error(
        said.changed
          ? "changed since it was opened"
          : String(said.error || "not saved"),
      );
      error.changed = said.changed === true;
      one.fail(error);
    });
    // A hello says nothing but what the page takes: it goes to whoever frames the page,
    // and only the app answers it
    const ask = () => {
      if (parent)
        parent.postMessage(
          { thursday: "hello", can: ["changed", "drafts"] },
          "*",
        );
    };
    ask();
    const now = () => revision?.getAttribute("content") ?? "";
    /** A message to the app, answered by the one that carries its id back. */
    const send = (said) =>
      new Promise((ok, fail) => {
        const id = ++next;
        waiting.set(id, { ok, fail });
        parent.postMessage({ ...said, as, id }, app);
      });
    return {
      get keeps() {
        return keeps;
      },
      /** The revision of the file this page shows: as it opened, then as its last save left it. */
      revision: now,
      ask,
      /** `fn` runs once the app has said it keeps edits (at once if it already has). */
      onKeeps(fn) {
        if (keeps) fn();
        else heard.add(fn);
      },
      /** `fn` runs when the app says the file was written by someone else while this page is open. */
      onWritten(fn) {
        written.add(fn);
      },
      /**
       * The page into its file. `words`, a document's, go with it so the app keeps them aside
       * itself when the save does not land — the frame may be gone by then (a dialog closed
       * on a save in flight), with no page left to ask.
       */
      save(html, words) {
        if (!keeps)
          return Promise.reject(new Error("nothing is keeping this page"));
        const done = line.then(() =>
          send({
            thursday: "save",
            html,
            base: now(),
            ...(words === undefined ? {} : { words }),
          }),
        );
        line = done.catch(() => {});
        return done;
      },
      /**
       * The words the app keeps aside for this file (drafts.js), after it holds `hold` in
       * place of any kept for the same revision, or lets go of what was kept for `drop`.
       */
      drafts({ hold, drop } = {}) {
        if (!keeps)
          return Promise.reject(new Error("nothing is keeping this page"));
        return send({ thursday: "drafts", hold, drop });
      },
    };
  })();

  /**
   * Editing a page in place, and keeping what changes: the head's Edit button, the line
   * beside the title that says where things stand (#state), and Reload. The kind says when
   * something changed (`changed`) and does its own part of switching (`onToggle`, run
   * before what waits is kept). The app keeps a change a moment later when it holds the
   * page; anywhere else nothing is kept until Done, which downloads a copy — so a box
   * ticked while reading a file opened from disk costs nothing. A save the app answers
   * `changed` — the file moved on after this page was opened: a bot wrote it, another
   * window saved it — stops all keeping, since this copy would undo that; Reload shows the
   * file as it is now, and Export still downloads this copy. Told by the app that the file
   * was written, a page nobody is working on reloads itself; one being worked on stops
   * keeping in the same way.
   *
   * A kind whose page is edited where it is read — a document — has no Edit to press
   * (`rest`). Its words are never let go unkept: the app saves them a moment after the
   * last key and as the page is left; a save that does not land keeps them aside with the
   * app (host.drafts) and says why; a page nothing saves keeps them in this browser for its
   * file, where the browser allows it. The line never says saved of words not in the file.
   */
  const edits = (() => {
    const button = document.querySelector("[data-edit]");
    const state = document.getElementById("state");
    const reload = document.querySelector("[data-reload]");
    const discard = document.querySelector("[data-discard]");
    const toggles = [];
    let on = false;
    let dirty = false;
    let timer = 0;
    let saving = 0; // saves on their way to the app
    let stale = false; // the file was written after this page was opened: nothing more is kept
    let kind = null; // a kind edited at rest (`rest`): how its words are taken, put back, shown
    let edition = 0; // changes made so far, so a keeping knows whether words came after it
    let aside = 0; // the edition last kept aside, with the app or in this browser
    let going = false; // the page is being left on the reader's word: nothing to ask
    const mine = new Set(); // revisions this page's words were kept aside on
    let holds = 0; // how many times its words were kept aside, to tell a save's from later ones

    // The line's own text changes in place: a node put in its stead while someone types
    // would end their run of typing. `why` is the whole of it, on a pointer's rest; a line
    // that `warn`s stays in the head on a phone, where the others give way to the title.
    const say = (text, why = "", warn = false) => {
      if (!state) return;
      const line = state.firstChild;
      if (line?.nodeType === Node.TEXT_NODE) line.data = text;
      else state.textContent = text;
      if (state.title !== why) state.title = why;
      state.toggleAttribute("data-warn", warn);
    };
    const WHY = {
      here: "Not saved into the file: nothing saves this page where it was opened, outside the app. Your edits are kept in this browser and come back when this file is opened here again. Export › Download this file saves a copy with them.",
      nowhere:
        "Not saved: nothing saves this page where it was opened, outside the app, and this browser keeps nothing for it. Export › Download this file saves a copy with your edits.",
      stale:
        "This page was changed elsewhere after you opened it (by a bot, or in another window), so your edits are not saved over that. They are still here and kept aside: Load new version shows the page as it is now, with your edits beside it.",
      newer:
        "This page was changed elsewhere after you opened it (by a bot, or in another window). Load new version shows it; anything written here meanwhile is kept aside, not saved over it.",
    };
    /** The line for a page whose file moved on: whether words written here wait to be kept aside. */
    const sayStale = () =>
      dirty
        ? say("Not saved: changed elsewhere", WHY.stale, true)
        : say("Changed elsewhere", WHY.newer, true);
    const reason = (error) => String(error?.message || error).slice(0, 80);

    /** Words kept in this browser for this file (drafts.js); `list` is null where it keeps nothing. */
    const here = (() => {
      const key = `thursday-page-drafts:${location.pathname}`;
      const read = () => {
        let raw = null;
        try {
          raw = localStorage.getItem(key);
        } catch {
          return null;
        }
        try {
          const list = JSON.parse(raw ?? "[]");
          return Array.isArray(list) ? list.filter(drafts.valid) : [];
        } catch {
          return [];
        }
      };
      const write = (list) => {
        try {
          if (list.length) localStorage.setItem(key, JSON.stringify(list));
          else localStorage.removeItem(key);
          return true;
        } catch {
          return false;
        }
      };
      return {
        list: read,
        hold(one) {
          const list = read();
          return list !== null && write(drafts.hold(list, one));
        },
        drop(base) {
          const list = read();
          return list !== null && write(drafts.drop(list, base));
        },
      };
    })();

    const draftNow = () => ({
      base: host.revision(),
      html: kind.words(),
      at: Date.now(),
    });

    /** Keeps the words as they stand in this browser, for a page nothing saves; true when kept. */
    const keepHere = () => {
      clearTimeout(timer);
      timer = 0;
      const at = edition;
      if (!here.hold(draftNow())) {
        say("Not saved", WHY.nowhere, true);
        return false;
      }
      aside = at;
      say("Kept in this browser only", WHY.here);
      if (discard) discard.hidden = false;
      return true;
    };

    /** Keeps the words as they stand aside with the app, for a save that did not land; true when held. */
    const holdAside = async () => {
      clearTimeout(timer);
      timer = 0;
      const at = edition;
      const one = draftNow();
      try {
        await host.drafts({ hold: one });
        mine.add(one.base);
        holds++;
        aside = Math.max(aside, at);
        return true;
      } catch (error) {
        say(
          stale ? "Not saved: changed elsewhere" : "Not saved",
          `Your edits are still on this page, but could not be kept aside (${reason(error)}). Export › Download this file saves a copy with them.`,
          true,
        );
        return false;
      }
    };

    reload?.addEventListener("click", async () => {
      if (
        kind &&
        dirty &&
        aside < edition &&
        !(await holdAside()) &&
        !confirm(
          "Your edits could not be kept aside. Load the new version anyway, and lose them?",
        )
      )
        return;
      going = true;
      location.reload();
    });
    discard?.addEventListener("click", () => {
      if (!confirm("Discard your edits, and show the file as it is?")) return;
      clearTimeout(timer);
      timer = 0;
      if (!here.drop(host.revision()))
        return say(
          "Not discarded",
          "This browser would not let go of the edits it keeps for this file.",
          true,
        );
      going = true;
      location.reload();
    });
    const goneStale = () => {
      stale = true;
      clearTimeout(timer);
      timer = 0;
      if (reload) reload.hidden = false;
      if (!kind) return say("Changed since it opened · not kept");
      sayStale();
      if (dirty) holdAside();
    };
    // Written by someone else while open: shown as it is now, unless someone is working on
    // this copy, which a reload would throw away — then it says so, as a refused save does
    host.onWritten(() => {
      if (
        kind
          ? dirty || saving || timer || stale
          : on || dirty || saving || stale
      )
        goneStale();
      else location.reload();
    });

    /** Keeps the page now: into the file when the app holds it, as a copy (or, at rest, in this browser) otherwise. */
    const keep = async () => {
      clearTimeout(timer);
      timer = 0;
      if (kind && stale) return holdAside();
      if (stale) return;
      if (kind && !host.keeps) return keepHere();
      const text = serialize(window.shell?.clean);
      if (!host.keeps) {
        download(fileName(), text);
        dirty = false;
        say("Copy downloaded");
        return;
      }
      dirty = false;
      say("Saving…");
      saving++;
      // Kept-aside words the file takes with this save: only those set aside before it was sent.
      // Words set aside while it was on its way (a write landed meanwhile) are newer than it
      const held = holds;
      const taken = [...mine];
      try {
        await host.save(text, kind ? kind.words() : undefined);
        // Saved, though the file may have moved on since (a write the app told of meanwhile)
        if (kind && stale) sayStale();
        else if (!dirty) say(on ? "Saved" : "");
        // What was kept aside of this page before the save is in the file now
        if (!stale && holds === held)
          for (const base of taken)
            host.drafts({ drop: base }).then(
              () => mine.delete(base),
              () => {}, // tried again after the next save
            );
      } catch (error) {
        dirty = true;
        if (error.changed) goneStale();
        else if (!kind) say(`Not saved: ${reason(error).slice(0, 60)}`);
        else if (await holdAside())
          say(
            "Not saved",
            `Not saved into the file: ${reason(error)}. Your edits are still here and kept aside; the next key or leaving the page tries again.`,
            true,
          );
      } finally {
        saving--;
      }
    };

    const changed = () => {
      dirty = true;
      edition++;
      clearTimeout(timer);
      if (kind) {
        // `keep` asks as it runs whether the app holds the page: it may answer meanwhile
        if (stale) sayStale();
        else if (host.keeps) say("Saving…");
        timer = setTimeout(keep, 1200);
        return;
      }
      if (stale) return;
      if (!host.keeps) {
        if (on) say("Unsaved · Done keeps a copy");
        return;
      }
      say("Unsaved…");
      timer = setTimeout(keep, 1200);
    };

    addEventListener("keydown", (event) => {
      if (!((event.metaKey || event.ctrlKey) && event.key === "s" && on))
        return;
      event.preventDefault();
      if (!kind || host.keeps) return keep();
      // Nothing saves this page: the key keeps a copy, and the file stays as it was
      const kept = keepHere();
      download(fileName(), serialize(window.shell?.clean));
      say("Copy downloaded", kept ? WHY.here : WHY.nowhere, !kept);
    });

    // Leaving the page keeps what waits at once rather than a moment later: a dialog closed
    // just after the last key takes the frame with it, and the pointer on its way to the
    // close button leaves the page first. A tab closing on words not yet kept asks first.
    const leaving = () => {
      if (timer) keep();
    };
    addEventListener("blur", leaving);
    root.addEventListener("pointerleave", leaving);
    addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) leaving();
    });
    addEventListener("beforeunload", (event) => {
      if (kind) {
        leaving();
        if (!going && (saving || (dirty && aside < edition)))
          event.preventDefault();
        return;
      }
      if (saving || (dirty && (on || host.keeps))) event.preventDefault();
    });

    const set = (next) => {
      on = next;
      button?.classList.toggle("sh-on", on);
      const word = button?.querySelector(".sh-word");
      if (word) word.textContent = on ? "Done" : "Edit";
      for (const fn of toggles) fn(on);
      if (on) {
        host.ask();
        if (stale) return;
        say(
          host.keeps
            ? "Editing · saved as you go"
            : "Editing · Done keeps a copy",
        );
        return;
      }
      if (dirty || timer) keep();
      else say("");
    };
    button?.addEventListener("click", () => set(!on));
    // The app may answer after Edit was pressed: the line catches up
    host.onKeeps(() => {
      if (on && !kind && !dirty && !stale) say("Editing · saved as you go");
    });

    /**
     * Words kept aside, as the page opens: those written on the file as it is go back in
     * place, unless the reader has started typing; those written on another version are
     * the kind's to show beside it (`aside`).
     */
    const take = (list) => {
      const { here: same, other } = drafts.split(list, host.revision());
      if (!same || dirty)
        return { back: false, other: same ? [same, ...other] : other };
      kind.restore(same.html);
      mine.add(same.base);
      return { back: true, other };
    };

    /**
     * A kind whose page is edited where it is read, with no Edit to press. `words()` is
     * what of the page is the reader's, as the file would keep it; `restore(html)` puts
     * kept words back in its place; `aside(list)` shows words kept from another version of
     * the file, each let go with `letGo(base)`.
     */
    const rest = (given) => {
      kind = given;
      on = true;
      const found = here.list();
      if (found?.length) {
        const { back, other } = take(found);
        if (back) {
          dirty = true;
          aside = edition;
          say("Edits restored · in this browser only", WHY.here);
          if (discard) discard.hidden = false;
        }
        if (other.length) kind.aside(other);
      }
      host.onKeeps(async () => {
        let list = [];
        try {
          list = await host.drafts();
        } catch (error) {
          return say(
            "Kept edits unread",
            `Edits kept aside for this page could not be read: ${reason(error)}`,
            true,
          );
        }
        const { back, other } = take(list);
        if (back) {
          changed();
          say("Edits restored · saving…");
        }
        if (other.length) kind.aside(other);
      });
    };

    /** Lets go of the words kept aside for revision `base`: the app's, or this browser's. */
    const letGo = async (base) => {
      if (host.keeps) await host.drafts({ drop: base });
      else if (!here.drop(base))
        throw new Error("this browser would not let go of them");
    };

    return {
      get on() {
        return on;
      },
      /** `fn(on)` runs as editing switches, before what waits is kept. */
      onToggle(fn) {
        toggles.push(fn);
      },
      changed,
      rest,
      letGo,
    };
  })();

  /**
   * The address names what is open (`#3`, `#B`), so a link or a reload lands there. A page the
   * app serves is sandboxed, and there the browser may refuse to change it: the page goes on
   * without it.
   */
  const address = (url) => {
    try {
      history.replaceState(null, "", url);
    } catch {}
  };

  /** Whether a picture sits beside this file: loading it is the only test a file opened from disk allows. */
  const probe = (src) =>
    new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(true);
      img.onerror = () => ok(false);
      img.src = src;
    });

  /**
   * A miniature of `el`: the element itself cloned, laid out at its true size (`w` by
   * `h`) and scaled to fit a `boxW` by `boxH` box, centred in it — so it is always what
   * the thing looks like now, and a tall one fits beside a wide one. Ids and what is said
   * over it (an <aside>) are dropped from the copy, so the page keeps one of each.
   */
  const thumb = (el, boxW, boxH, w, h) => {
    const scale = Math.min(boxW / w, boxH / h);
    const box = document.createElement("span");
    box.className = "sh-thumb";
    box.style.width = `${boxW}px`;
    box.style.height = `${boxH}px`;
    const stage = document.createElement("span");
    stage.className = "sh-thumb-stage";
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.transform = `translate(${(boxW - w * scale) / 2}px, ${(boxH - h * scale) / 2}px) scale(${scale})`;
    const copy = el.cloneNode(true);
    copy.removeAttribute("id");
    for (const inner of copy.querySelectorAll("[id]"))
      inner.removeAttribute("id");
    for (const aside of copy.querySelectorAll(":scope > aside")) aside.remove();
    stage.append(copy);
    box.append(stage);
    // A picture of the thing, not a second one: its links, buttons and fields take no keys
    // and are not read out. What holds it names itself (aria-label): a form's labels in
    // the copy still reach a name made from its words.
    box.inert = true;
    return { box, copy };
  };

  /**
   * A word that stands for a moment in place of another — "Copied" — then goes back.
   * What it stands in for is kept here, never on the element, so a copy of the page
   * made meanwhile carries nothing of it.
   */
  const resting = new WeakMap();
  const say = (el, text, hold = 1600) => {
    if (!el) return;
    const rest = resting.get(el) ?? { text: el.textContent, timer: 0 };
    resting.set(el, rest);
    el.textContent = text;
    clearTimeout(rest.timer);
    rest.timer = setTimeout(() => {
      el.textContent = rest.text;
      resting.delete(el);
    }, hold);
  };

  return {
    face,
    theme,
    download,
    fileName,
    serialize,
    host,
    edits,
    address,
    probe,
    thumb,
    say,
  };
})();

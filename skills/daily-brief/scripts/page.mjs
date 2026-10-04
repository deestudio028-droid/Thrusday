#!/usr/bin/env node
/**
 * The brief as one page: what the model wrote (brief.json) laid over what the scripts
 * fetched (stories.json, glance.json), written to `brief-<date>.html` in the bot's artifacts
 * folder. It is built to be read in a few minutes and to be this reader's own: the day and how
 * many stories, the brief to hear, today in a line and the numbers they watch, then each story
 * with what changed since an earlier brief told it and why it is theirs, the stories they are
 * following as a line through the days, and the rest as headlines. Pictures (shrunk to the size
 * they are shown at) and audio are inlined, so the one file opens anywhere — on this screen,
 * or on a phone it was sent to. It wears the artifact skill's shell, as every page a bot
 * makes does: the maker's face and name in its head and at its end, the app's type, the
 * maker's colour as its one accent. The layout is never typed by hand.
 *
 *   node page.mjs <brief.json> [--look <dir>]
 *
 * With --look it also renders the page at phone width through the artifact skill's camera,
 * for one look at the photos.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  artifactsDir,
  host,
  parseArgs,
  run,
  Stop,
  shown,
  workspace,
} from "./lib.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Past this, a summary is a paragraph, not two lines
const SUMMARY_MAX = 280;
/**
 * The widths pictures are kept at: the lead across the page, a row's beside its words at
 * twice the pixels it is drawn at. A publisher's picture came at 8138px, 1.8 MB, for a
 * card 640px wide.
 */
const LEAD_WIDTH = 1200;
const ROW_WIDTH = 360;

const LABELS = {
  title: "Morning Brief",
  why: "Why it matters",
  listen: "The 60-second version",
  hear: "Listen",
  read: "Read",
  photo: "Photo",
  made: "Made {time} from {count} publishers. Photos belong to the publishers credited on them.",
  count: "{n} stories",
  today: "Today",
  yours: "For you",
  following: "Following",
  more: "More headlines",
};

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};
const inline = (file) =>
  `data:${TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(file).toString("base64")}`;

const SKY = {
  clear:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  partly:
    '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4M15.9 12.7a4 4 0 0 0-5.9-4.1"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloudy: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
  fog: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 17H7M17 21H9"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  snow: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
  storm:
    '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9"/><path d="m13 12-3 5h4l-3 5"/>',
};
const skyIcon = (sky) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SKY[sky] ?? SKY.cloudy}</svg>`;

run(async () => {
  const opts = parseArgs();
  const briefFile = opts._[0] && resolve(opts._[0]);
  if (!briefFile)
    throw new Stop("usage: node page.mjs <brief.json> [--look <dir>]");
  if (!existsSync(briefFile)) throw new Stop(`No such file: ${briefFile}`);
  let brief;
  try {
    brief = JSON.parse(readFileSync(briefFile, "utf8"));
  } catch (error) {
    throw new Stop(`${briefFile} is not JSON: ${error.message}`);
  }
  // A path in brief.json is relative to it, or to the workspace: what a tool hands back
  // (`generate_speech` answers `artifacts/<bot>/….mp3`) is written down as it came
  const from = (p) => {
    if (!p) return null;
    const beside = resolve(dirname(briefFile), p);
    if (existsSync(beside)) return beside;
    const inWorkspace = resolve(workspace(), p);
    return existsSync(inWorkspace) ? inWorkspace : beside;
  };
  const storiesFile = from(brief.stories);
  if (!storiesFile || !existsSync(storiesFile))
    throw new Stop(
      `"stories" must name the stories.json story.mjs wrote (got ${brief.stories ?? "nothing"}).`,
    );
  const stories = JSON.parse(readFileSync(storiesFile, "utf8"));
  const glanceFile = from(brief.glance);
  const glance =
    glanceFile && existsSync(glanceFile)
      ? JSON.parse(readFileSync(glanceFile, "utf8"))
      : null;
  if (brief.glance && !glance)
    throw new Stop(`No glance file at ${glanceFile}.`);
  const audioFile = from(brief.audio);
  if (brief.audio && !existsSync(audioFile))
    throw new Stop(`No audio file at ${audioFile}.`);

  const lang = brief.lang ?? "en";
  const L = { ...LABELS, ...brief.labels };
  const day = brief.date ? new Date(`${brief.date}T12:00:00`) : new Date();
  const date =
    brief.date ??
    new Date(day.getTime() - day.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);

  // Every story the model wrote about must be one the scripts fetched
  const wrote = [brief.lead, ...(brief.items ?? [])].filter(Boolean);
  const problems = [];
  if (!brief.lead)
    problems.push('"lead" is missing: the one story that opens the page.');
  const joined = wrote.map((w, i) => {
    const s = stories.find((x) => x.id === w.id);
    const at = i === 0 ? "lead" : `items[${i - 1}]`;
    if (!s)
      problems.push(`${at}: no story "${w.id}" in ${shown(storiesFile)}.`);
    if (!w.headline?.trim()) problems.push(`${at}: "headline" is empty.`);
    if (i === 0 && w.short)
      problems.push(`lead: the lead is never "short"; it opens the page.`);
    if (!w.summary?.trim()) {
      if (!w.short) problems.push(`${at}: "summary" is empty.`);
    } else if (w.summary.length > SUMMARY_MAX)
      problems.push(
        `${at}: the summary runs ${w.summary.length} characters; two lines are under ${SUMMARY_MAX}.`,
      );
    return { ...s, ...w };
  });
  for (const [i, f] of (brief.following ?? []).entries()) {
    if (!f?.topic) problems.push(`following[${i}]: "topic" is empty.`);
    if (!Array.isArray(f?.steps) || f.steps.length < 2)
      problems.push(
        `following[${i}]: "steps" lists at least two moments, oldest first, today's last.`,
      );
  }
  if (problems.length)
    throw new Stop(
      `Nothing written. Fix brief.json:\n- ${problems.join("\n- ")}`,
    );

  const rel = new Intl.RelativeTimeFormat(lang, {
    numeric: "auto",
    style: "short",
  });
  const when = (iso) => {
    const h = (Date.now() - Date.parse(iso)) / 3_600_000;
    if (!Number.isFinite(h)) return "";
    return h < 1
      ? rel.format(-Math.max(1, Math.round(h * 60)), "minute")
      : rel.format(-Math.round(h), "hour");
  };

  // Every picture shrunk to the width it is shown at, in one headless browser, before it goes in
  const [lead, ...items] = joined;
  const long = items.filter((s) => !s.short);
  const short = items.filter((s) => s.short);
  const pics = await shrink([
    ...(lead.image?.file && existsSync(lead.image.file)
      ? [{ id: lead.id, file: lead.image.file, max: LEAD_WIDTH }]
      : []),
    ...long
      .filter((s) => s.image?.file && existsSync(s.image.file))
      .map((s) => ({ id: s.id, file: s.image.file, max: ROW_WIDTH })),
  ]);

  const picture = (s, credit) => {
    const src = pics.get(s.id);
    if (!src)
      return `<div class="b-pic"><div class="b-none">${esc(s.site ?? host(s.url))}</div></div>`;
    return `<div class="b-pic"><img src="${src}" alt="${esc(s.headline)}">${credit ? `<span class="b-credit">${esc(L.photo)} · ${esc(s.image.site ?? s.site)}</span>` : ""}</div>`;
  };
  const source = (s) =>
    `<p class="b-src"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.site ?? host(s.url))}</a>${s.published ? ` · ${esc(when(s.published))}` : ""}${s.outlets > 1 ? ` · +${s.outlets - 1}` : ""}</p>`;
  const why = (s) =>
    s.why?.trim()
      ? `<p class="b-why"><span><b>${esc(L.why)}.</b> ${esc(s.why)}</span></p>`
      : "";
  // What changed since an earlier brief told this story, and why it is this reader's
  const since = (s) =>
    s.since?.trim()
      ? `<p class="b-since"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>${esc(s.since)}</span></p>`
      : "";
  const yours = (s) =>
    s.yours?.trim()
      ? `<p class="b-yours"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2ZM9 21h6"/></svg><span><b>${esc(L.yours)}.</b> ${esc(s.yours)}</span></p>`
      : "";
  const chips = (s, kicker) => {
    const list = [
      s.since?.trim()
        ? `<span class="b-chip b-on">${esc(L.following)}</span>`
        : "",
      kicker ? `<span class="b-chip">${esc(kicker)}</span>` : "",
    ].filter(Boolean);
    return list.length ? `<p class="b-chips">${list.join("")}</p>` : "";
  };
  const link = (s, text) =>
    `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

  const leadHtml = `<article class="b-card b-lead">
${picture(lead, true)}
<div class="b-body">
${chips(lead, lead.kicker ?? lead.topic)}
<h2>${link(lead, lead.headline)}</h2>
<p class="b-sum">${esc(lead.summary)}</p>
${since(lead)}
${yours(lead)}
${why(lead)}
${source(lead)}
</div>
</article>`;

  // Stories keep the model's order; a topic's section opens where its first story stands
  const topics = [];
  for (const s of long) {
    const name = s.section ?? s.topic ?? "";
    let t = topics.find((x) => x.name === name);
    if (!t) topics.push((t = { name, items: [] }));
    t.items.push(s);
  }
  const topicHtml = topics
    .map(
      (t) => `<section class="b-topic">
${t.name ? `<h2>${esc(t.name)}<span>${t.items.length}</span></h2>` : ""}
${t.items
  .map(
    (s) => `<article class="b-row">
<div>
${s.since?.trim() ? chips(s) : ""}
<h3>${link(s, s.headline)}</h3>
<p class="b-sum">${esc(s.summary)}</p>
${since(s)}
${yours(s)}
${why(s)}
${source(s)}
</div>
${picture(s, false)}
</article>`,
  )
  .join("\n")}
</section>`,
    )
    .join("\n");

  // The stories this reader follows, as a line through the briefs that told them
  const followHtml = (brief.following ?? [])
    .map(
      (f) =>
        `<section class="b-follow"><h2><span class="b-chip b-on">${esc(L.following)}</span>${esc(f.topic)}</h2><ol>${f.steps
          .map(
            (st, i) =>
              `<li${i === f.steps.length - 1 ? ' class="b-now"' : ""}><time>${esc(st.date ?? "")}</time><i class="b-rail" aria-hidden="true"></i><span>${esc(st.text ?? "")}</span></li>`,
          )
          .join("")}</ol></section>`,
    )
    .join("\n");

  // The rest, a line each
  const shortHtml = short.length
    ? `<section class="b-more"><h2>${esc(L.more)}</h2><ul>${short
        .map(
          (s) =>
            `<li>${link(s, s.headline)}<span>${esc(s.site ?? host(s.url))}${s.published ? ` · ${esc(when(s.published))}` : ""}</span></li>`,
        )
        .join("")}</ul></section>`
    : "";

  const num = (v, digits) =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v);
  const tiles = [];
  const dayNote = brief.day?.trim();
  if (glance?.weather) {
    const w = glance.weather;
    tiles.push(
      `<div class="b-tile b-sky">${skyIcon(w.sky)}<b>${w.now}${esc(w.unit)} · ${esc(w.place)}</b><span class="b-mono">${w.low}°–${w.high}°${w.rain != null ? ` · ☂ ${w.rain}%` : ""}</span>${dayNote ? `<p>${esc(dayNote)}</p>` : ""}</div>`,
    );
  }
  for (const m of glance?.markets ?? []) {
    const dir = m.pct > 0.005 ? "up" : m.pct < -0.005 ? "down" : "";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
    tiles.push(
      `<div class="b-tile"><span class="b-mono">${esc(m.label)}</span><b>${num(m.price, Math.abs(m.price) >= 1000 ? 0 : 2)}</b><span class="b-mono${dir ? ` b-${dir}` : ""}">${arrow} ${num(Math.abs(m.pct), 2)}%</span></div>`,
    );
  }

  const spoken = brief.spoken?.trim();
  const bars = `<span class="b-bars" aria-hidden="true">${[5, 9, 12, 7, 10, 4, 8, 11, 6].map((h) => `<i style="height:${h}px"></i>`).join("")}</span>`;
  const hear = audioFile
    ? `<button type="button" class="b-hear" data-hear aria-pressed="false"><span class="b-dot"><svg class="b-play" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"/></svg><svg class="b-pause" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z"/></svg></span><span class="b-hear-words"><b>${esc(L.hear)}</b><span class="b-time" data-time></span></span>${bars}</button><audio data-audio preload="metadata" src="${inline(audioFile)}"></audio>`
    : "";
  const listen =
    spoken || audioFile
      ? `<div class="b-listen">${hear}${spoken ? `<details class="b-said"><summary>${esc(L.listen)}</summary><p>${esc(spoken)}</p></details>` : ""}</div>`
      : "";

  const publishers = new Set(joined.map((s) => s.site ?? host(s.url)));
  const madeAt = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  const heading = brief.title ?? L.title;
  const dayLine = new Intl.DateTimeFormat(lang, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(day);
  // Read back by news.mjs: what this brief told, so the next one does not tell it again
  const told = joined.map((s) => ({
    title: s.title,
    headline: s.headline,
    url: s.url,
    links: s.links ?? [],
  }));

  // The shell every page a bot makes wears: its head, type, theme and the maker's name
  const skills = process.env.THURSDAY_SKILLS;
  const wearAt =
    skills && join(skills, "artifact", "runtime", "shell", "wear.mjs");
  if (!wearAt || !existsSync(wearAt))
    throw new Stop(
      "THURSDAY_SKILLS does not name the shipped skills: run this from a bot's shell in the app.",
    );
  const { wear, pageHead } = await import(pathToFileURL(wearAt).href);

  const html = wear(`<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{{shell.meta}}
<meta name="print" content="pdf">
<title>${esc(heading)} · ${esc(dayLine)}</title>
<script>
// shell.theme
</script>
<style>
/* shell.css */
${readFileSync(join(SKILL, "page", "brief.css"), "utf8").trim()}
</style>
</head>
<body>
${pageHead(heading)}
<div class="b-page">
<header class="b-mast">
<p class="b-day">${esc(dayLine)} · ${esc(madeAt)} · ${esc(L.count.replace("{n}", String(joined.length)))}</p>
<h1 class="b-lede">${esc(brief.lede?.trim() || heading)}</h1>
${dayNote && !glance?.weather ? `<p class="b-daynote">${esc(dayNote)}</p>` : ""}
${listen}
</header>
${tiles.length ? `<section class="b-today"><h2>${esc(L.today)}</h2><div class="b-tiles">${tiles.join("")}</div></section>` : ""}
${leadHtml}
<div class="b-topics">
${topicHtml}
</div>
${followHtml}
${shortHtml}
<p class="b-made">${esc(L.made.replace("{time}", madeAt).replace("{count}", String(publishers.size)))}</p>
</div>
{{shell.sign}}
<script type="application/json" id="brief-data">${JSON.stringify({ date, told }).replace(/</g, "\\u003c")}</script>
<script>
// shell.js
</script>
<script>
// The brief read aloud: the black pill plays and pauses it, and says how far it is
(() => {
  const button = document.querySelector("[data-hear]");
  const audio = document.querySelector("[data-audio]");
  const time = document.querySelector("[data-time]");
  if (!button || !audio) return;
  const clock = (s) => Number.isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "";
  const say = () => { time.textContent = audio.paused && !audio.currentTime ? clock(audio.duration) : clock(audio.currentTime); };
  button.addEventListener("click", () => (audio.paused ? audio.play() : audio.pause()));
  audio.addEventListener("play", () => button.setAttribute("aria-pressed", "true"));
  audio.addEventListener("pause", () => button.setAttribute("aria-pressed", "false"));
  audio.addEventListener("ended", () => { audio.currentTime = 0; say(); });
  for (const event of ["loadedmetadata", "timeupdate"]) audio.addEventListener(event, say);
})();
</script>
</body>
</html>
`);

  const out = join(artifactsDir(), `brief-${date}.html`);
  mkdirSync(dirname(out), { recursive: true });
  const replaced = existsSync(out);
  writeFileSync(out, html);
  const noPicture = [lead, ...long]
    .filter((s) => !pics.has(s.id))
    .map((s) => s.id);
  console.log(
    `${shown(out)}${replaced ? " (replaced)" : ""}: ${joined.length} stories, ${1 + long.length - noPicture.length} pictures${noPicture.length ? ` (none for ${noPicture.join(", ")})` : ""}${tiles.length ? `, ${tiles.length} at a glance` : ""}${audioFile ? ", audio" : ""}, ${Math.round(statSync(out).size / 1024)} KB.`,
  );
  if (long.length < 2 || long.length > 5)
    console.log(
      `Note: ${long.length} stories in full under the lead; a brief reads best with 2 to 5, the rest "short".`,
    );
  if (opts.look) look(out, resolve(String(opts.look)));
});

/**
 * The page at phone width as one PNG, through the artifact skill's camera, in a headless
 * browser of its own: never the job's, which may be a window on the user's screen.
 */
function look(page, dir) {
  const render = join(
    process.env.THURSDAY_SKILLS ?? "",
    "artifact",
    "runtime",
    "render.mjs",
  );
  if (!existsSync(render))
    throw new Stop(
      `No render script at ${render}: the artifact skill ships it under $THURSDAY_SKILLS.`,
    );
  const got = spawnSync(
    "node",
    [
      render,
      page,
      "--size",
      "430x2400",
      "--out",
      dir,
      "--name",
      "look",
      "--apart",
    ],
    { encoding: "utf8" },
  );
  if (got.status !== 0)
    throw new Stop(
      `The page is written, but rendering it failed:\n${got.stderr.trim()}`,
    );
  console.log(
    `Look at ${join(dir, "look-01.png")} once with look_at: the top of the page at phone width.`,
  );
}

/**
 * Each picture at most `max` pixels wide, as a JPEG, drawn once through a canvas in a
 * headless browser of its own; a picture already that narrow is kept as it came. Answers
 * id → data URL.
 */
async function shrink(list) {
  const got = new Map();
  if (!list.length) return got;
  const at = join(
    process.env.THURSDAY_SKILLS ?? "",
    "browser",
    "scripts",
    "session.mjs",
  );
  if (!existsSync(at))
    throw new Stop(
      `No browser session script at ${at}: run this from a bot's shell in the app.`,
    );
  const { inPageApart } = await import(pathToFileURL(at).href);
  const inputs = list.map((p) => ({
    id: p.id,
    max: p.max,
    src: inline(p.file),
  }));
  const shrunk = await inPageApart(
    async (page, { inputs }) =>
      page.evaluate(
        async (inputs) =>
          Promise.all(
            inputs.map(async ({ id, max, src }) => {
              const img = new Image();
              img.src = src;
              // A picture the browser cannot draw (a format it does not read, a cut-off
              // download) shows as its outlet's name, and the build names it
              try {
                await img.decode();
              } catch {
                return { id, src: null };
              }
              if (img.naturalWidth <= max) return { id, src };
              const canvas = document.createElement("canvas");
              canvas.width = max;
              canvas.height = Math.round(
                (img.naturalHeight * max) / img.naturalWidth,
              );
              canvas
                .getContext("2d")
                .drawImage(img, 0, 0, canvas.width, canvas.height);
              return { id, src: canvas.toDataURL("image/jpeg", 0.82) };
            }),
          ),
        inputs,
      ),
    { inputs },
  );
  for (const { id, src } of shrunk ?? []) if (src) got.set(id, src);
  return got;
}

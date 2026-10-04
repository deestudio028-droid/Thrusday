#!/usr/bin/env node
// A digest page from a JSON file you write: one HTML file in your artifacts folder that
// opens offline, light and dark, phone first. Pictures are fetched and put inside it.
//
//   node digest.mjs <digest.json> --name <page-name>
//
// The JSON's fields are in references/page.md. Run it again to replace the page.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  artifactsDir,
  clock,
  compact,
  parseArgs,
  run,
  Stop,
  seconds,
  shown,
  usage,
  WORKSPACE,
} from "./lib.mjs";

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** A picture as a data url, so the page stays one file; null when it will not load. */
async function inline(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Where a time or a page lands: the video at that second, the file at that page. */
function linker(source) {
  const id = source.id;
  return (at) => {
    const page = String(at ?? "").match(/^p\.?\s*(\d+)$/i);
    if (page) return source.url ? `${source.url}#page=${page[1]}` : null;
    const s = seconds(at);
    if (s == null) return null;
    if (id) return `https://www.youtube.com/watch?v=${id}&t=${Math.floor(s)}s`;
    return source.url ? `${source.url}#t=${Math.floor(s)}` : null;
  };
}

/**
 * `**bold**`, `[text](url)` and `[12:03]` in the text you wrote, the last linked to its
 * moment. An estimated time keeps its `~` in the label and still opens there.
 */
function prose(text, link) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[(~?(?:\d+:)?\d{1,2}:\d{2}|p\.\s?\d+)\]/g, (whole, at) => {
      const href = link(at);
      return href ? `<a class="at" href="${esc(href)}">${at}</a>` : whole;
    });
}

const paragraphs = (text, link) =>
  (Array.isArray(text) ? text : String(text ?? "").split(/\n\s*\n/))
    .filter(Boolean)
    .map((one) => `<p>${prose(one, link)}</p>`)
    .join("\n");

function chip(at, link) {
  if (at == null || at === "") return "";
  const label = typeof at === "number" ? clock(at) : String(at);
  const href = link(at);
  return href
    ? `<a class="at" href="${esc(href)}" aria-label="Open at ${esc(label)}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"/></svg>${esc(label)}</a>`
    : `<span class="at">${esc(label)}</span>`;
}

/** The source: a meta file yt.mjs wrote, or what you wrote in its place. */
function readSource(value, base) {
  if (!value) return {};
  if (typeof value === "string") {
    const file = [resolve(base, value), resolve(WORKSPACE, value)].find(
      existsSync,
    );
    if (!file) throw new Stop(`No source file ${value}.`);
    const meta = JSON.parse(readFileSync(file, "utf8"));
    return {
      kind: "video",
      id: meta.id,
      url: meta.url,
      title: meta.title,
      by: meta.channel,
      date: meta.date,
      seconds: meta.seconds,
      length: meta.length,
      views: meta.views,
      chapters: meta.chapters,
      captions: meta.captions,
      thumbnail: meta.thumbnail,
    };
  }
  const id = value.url?.match(
    /(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/,
  )?.[1];
  return {
    ...value,
    id: value.id ?? id,
    seconds: value.seconds ?? seconds(value.length),
    kind: value.kind ?? (id ? "video" : "article"),
  };
}

/** A line across the length of the video: chapters as bands, each point a numbered mark. */
function timeline(source, points, link) {
  const total = source.seconds;
  const timed = points
    .map((p, i) => ({ n: i + 1, s: seconds(p.at), title: p.title }))
    .filter((p) => p.s != null && p.s <= total);
  if (!total || timed.length < 2) return "";
  const pct = (s) => `${((s / total) * 100).toFixed(2)}%`;
  const bands = (source.chapters ?? [])
    .map((c, i, all) => {
      const end = all[i + 1]?.at ?? total;
      return `<a class="band" href="${esc(link(c.at) ?? "#")}" style="left:${pct(c.at)};width:${pct(end - c.at)}" title="${esc(`${clock(c.at, total >= 3600)} ${c.title}`)}"></a>`;
    })
    .join("");
  // A mark too close to the one before it takes the other lane, so neither hides the other
  let last = { s: -total, lane: 1 };
  const marks = timed
    .map((p) => {
      const lane = (p.s - last.s) / total < 0.08 ? 1 - last.lane : 1;
      last = { s: p.s, lane };
      return `<a class="mark lane${lane}" href="${esc(link(p.s))}" style="left:clamp(.75rem,${pct(p.s)},calc(100% - .75rem))" title="${esc(`${clock(p.s, total >= 3600)} ${p.title ?? ""}`)}">${p.n}</a>`;
    })
    .join("");
  return `<div class="timeline" role="img" aria-label="Where each point falls in the video">
<div class="track">${bands}${marks}</div>
<div class="ends"><span>0:00</span><span>${esc(clock(total))}</span></div>
</div>`;
}

async function watchList(videos) {
  const cards = await Promise.all(
    videos.map(async (v) => {
      const id = v.id ?? v.url?.match(/v=([\w-]{11})/)?.[1];
      // The picture yt-dlp listed for the row (yt.mjs search); a row written by hand has none
      const pic = v.thumbnail ? await inline(v.thumbnail) : null;
      const url =
        v.url ?? (id ? `https://www.youtube.com/watch?v=${id}` : null);
      const link = linker({ id, url });
      const facts = [
        v.channel,
        pic ? null : v.length,
        typeof v.views === "number" ? `${compact(v.views)} views` : v.views,
        v.age ?? v.date,
      ].filter(Boolean);
      return `<article class="video${v.pick ? " pick" : ""}">
<a class="thumb" href="${esc(url ?? "#")}">${pic ? `<img src="${pic}" alt="" loading="lazy">` : ""}${v.length ? `<span class="len">${esc(v.length)}</span>` : ""}</a>
<div class="body">
${v.pick ? '<span class="tag pick-tag">Watch this</span>' : ""}
<h3><a href="${esc(url ?? "#")}">${esc(v.title)}</a></h3>
<p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>
${v.why ? `<p>${prose(v.why, link)}</p>` : ""}
</div>
</article>`;
    }),
  );
  return `<section class="videos">${cards.join("\n")}</section>`;
}

const CSS = `
/* The digest reads as a document does: the source as a bookmark (its words beside its
   picture), the key points each a block with its moment under its claim, the watch list as
   bookmarks too, and space between the parts. The one colour is the maker's, on the moments. */
:where(.pg-paper) h2{margin:3.25rem 0 1rem}
.pg-paper>p{margin-bottom:1.25rem}
.lede{margin-bottom:2rem}
.src{display:grid;margin:0 0 2.5rem;overflow:hidden;border:1px solid var(--line);border-radius:12px}
@media (min-width:40rem){.src.has-pic{grid-template-columns:1fr minmax(0,15rem)}.src.has-pic .pic{order:2}}
.src .pic{position:relative;display:block;aspect-ratio:16/9;background:var(--sh-sunk)}
.src .pic img{width:100%;height:100%;object-fit:cover;border-radius:0;display:block}
.src .pic .play{position:absolute;inset:auto auto .625rem .625rem;display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:99px;background:rgb(0 0 0/.6);color:#fff}
.src .pic .play svg{width:.9rem;height:.9rem;fill:currentColor;margin-left:2px}
.src>div{align-self:center;padding:1rem 1.25rem}
.src h2{margin:0 0 .375rem;font-size:1.0625rem;line-height:1.35;letter-spacing:-.015em}
.src h2 a{color:inherit;text-decoration:none}
.src h2 a:hover{text-decoration:underline}
.facts{display:flex;flex-wrap:wrap;gap:.25rem .75rem;margin:0;color:var(--muted);font:400 12.5px/1.5 var(--sh-mono)}
.listen{display:flex;flex-direction:column;gap:.5rem;margin:0 0 2rem;padding:1rem 1.125rem;border-radius:12px;background:color-mix(in srgb,var(--sh-ink) 4.5%,var(--sh-paper))}
.listen strong{font-size:.875rem}
.listen audio{width:100%;height:2.5rem}
a.at,span.at{display:inline-flex;align-items:center;gap:.3rem;padding:.0625rem .5rem .0625rem .4375rem;border-radius:99px;font:500 .78rem/1.5 var(--sh-mono);font-variant-numeric:tabular-nums;color:var(--sh-maker-text);background:color-mix(in srgb,var(--sh-maker) 11%,transparent);text-decoration:none;white-space:nowrap;vertical-align:.08em}
a.at:hover{background:color-mix(in srgb,var(--sh-maker) 20%,transparent)}
a.at svg{width:.55rem;height:.55rem;fill:currentColor}
p a.at{margin:0 .1rem}
.timeline{margin:0 0 2.5rem}
.track{position:relative;height:2.5rem;border-radius:99px;background:color-mix(in srgb,var(--sh-ink) 4.5%,var(--sh-paper))}
.band{position:absolute;top:0;bottom:0;border-left:2px solid var(--bg)}
.band:first-child{border-left:0}
.band:hover{background:color-mix(in srgb,var(--sh-maker) 12%,transparent)}
.mark{position:absolute;top:50%;display:grid;place-items:center;width:1.375rem;height:1.375rem;margin-left:-.6875rem;transform:translateY(-50%);border-radius:99px;background:var(--sh-maker);color:#fff;font:600 .7rem/1 var(--sh-font);text-decoration:none;box-shadow:0 0 0 2px var(--bg)}
.mark.lane0{top:28%}.mark.lane1{top:50%}.timeline:has(.lane0) .mark.lane1{top:72%}
.mark:hover{transform:translateY(-50%) scale(1.12)}
.ends{display:flex;justify-content:space-between;margin-top:.375rem;color:var(--muted);font:400 11.5px var(--sh-mono)}
ol.points{list-style:none;padding:0;margin:0 0 1rem;counter-reset:pt}
ol.points>li{position:relative;counter-increment:pt;margin:0;padding:0 0 2rem 2.75rem}
ol.points>li::before{content:counter(pt);position:absolute;left:0;top:-.1rem;display:grid;place-items:center;width:1.875rem;height:1.875rem;border-radius:99px;background:color-mix(in srgb,var(--sh-ink) 6%,var(--sh-paper));color:var(--sh-ink-2);font:500 13px/1 var(--sh-mono)}
.pt-head{display:flex;flex-direction:column;align-items:flex-start;gap:.5rem;margin-bottom:.5rem}
.pt-head h3{margin:0;font-size:1.1875rem;line-height:1.35;letter-spacing:-.02em}
ol.points p{margin:0 0 .5rem;color:var(--sh-ink-2);line-height:1.7}
figure.quote{margin:0 0 2rem;padding:.125rem 0 .125rem 1.125rem;border-left:3px solid var(--fg)}
figure.quote blockquote{margin:0 0 .5rem;padding:0;border:0;color:var(--fg);font-size:1.3125rem;font-weight:600;line-height:1.35;letter-spacing:-.02em}
figure.quote figcaption{margin:0;color:var(--muted);font-size:.875rem}
details.chapters{border:0;padding:0}
details.chapters ol{margin:.5rem 0 0;padding:0;list-style:none}
details.chapters li{display:flex;gap:.75rem;align-items:baseline;padding:.2rem 0}
.videos{display:grid;gap:.75rem;margin-bottom:1.5rem}
.video{display:grid;gap:0;overflow:hidden;border:1px solid var(--line);border-radius:12px}
@media (min-width:40rem){.video{grid-template-columns:12rem 1fr;align-items:center}}
.video .thumb{position:relative;display:block;aspect-ratio:16/9;background:var(--sh-sunk)}
.video .thumb img{width:100%;height:100%;object-fit:cover;border-radius:0}
.video .len{position:absolute;right:.4rem;bottom:.4rem;padding:.05rem .375rem;border-radius:99px;background:rgb(0 0 0/.7);color:#fff;font:500 .7rem/1.5 var(--sh-mono)}
.video .body{padding:.875rem 1.125rem}
.video h3{margin:.125rem 0 .25rem;font-size:1rem;line-height:1.4;letter-spacing:-.01em}
.video h3 a{color:inherit;text-decoration:none}
.video h3 a:hover{text-decoration:underline}
.video .body>p:last-child{margin-bottom:0}
.video .facts{margin-bottom:.375rem}
.pick-tag{border:0;background:color-mix(in srgb,var(--sh-maker) 11%,transparent);color:var(--sh-maker-text);font-weight:600}
.pg-paper>footer{margin-top:2.5rem;color:var(--muted);font-size:.8125rem}
@media (max-width:30rem){ol.points>li{padding-left:2.5rem}}
@media print{.timeline,.listen{display:none}}
`;

async function build(file, name) {
  const base = dirname(resolve(file));
  const d = JSON.parse(readFileSync(file, "utf8"));
  if (!d.title) throw new Stop(`${file} has no "title".`);
  const source = readSource(d.source, base);
  if (d.chapters)
    source.chapters = d.chapters.map((c) => ({ ...c, at: seconds(c.at) }));
  const link = linker(source);
  const out = join(artifactsDir(), `${name}.html`);
  const long = (source.seconds ?? 0) >= 3600;

  const skills = process.env.THURSDAY_SKILLS;
  if (!skills)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell in the app.",
    );
  // Dressed as a document is: the artifact skill's shell and its reading styles
  const quickCss = join(skills, "artifact", "runtime", "document", "quick.css");
  const wearAt = join(skills, "artifact", "runtime", "shell", "wear.mjs");
  if (!existsSync(quickCss) || !existsSync(wearAt))
    throw new Stop(
      `No document styles under ${join(skills, "artifact")}: the artifact skill is not in the shipped skills folder.`,
    );
  const { wear, pageHead } = await import(pathToFileURL(wearAt).href);

  const pic = source.thumbnail
    ? await inline(source.thumbnail)
    : source.image
      ? await inline(source.image)
      : null;
  const facts = [
    source.by,
    source.date,
    source.length ?? (source.seconds ? clock(source.seconds, long) : null),
    typeof source.views === "number" ? `${compact(source.views)} views` : null,
    source.pages ? `${source.pages} pages` : null,
  ].filter(Boolean);
  const html = [];
  html.push(`<h1>${esc(d.title)}</h1>`);
  if (d.lede) html.push(`<p class="lede">${prose(d.lede, link)}</p>`);
  if (source.title || source.url)
    html.push(`<section class="src${pic ? " has-pic" : ""}">
${pic ? `<a class="pic" href="${esc(source.url ?? "#")}"><img src="${pic}" alt="">${source.kind === "video" ? '<span class="play"><svg viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z"/></svg></span>' : ""}</a>` : ""}
<div><h2><a href="${esc(source.url ?? "#")}">${esc(source.title ?? source.url)}</a></h2>
<p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p></div>
</section>`);
  if (d.audio) {
    const audio = [resolve(base, d.audio), resolve(WORKSPACE, d.audio)].find(
      existsSync,
    );
    if (!audio) throw new Stop(`No audio file ${d.audio}.`);
    html.push(
      `<div class="listen"><strong>${esc(d.audioLabel ?? "Listen")}</strong><audio controls preload="none" src="${esc(relative(dirname(out), audio).split("\\").join("/"))}"></audio></div>`,
    );
  }
  if (d.summary) html.push(paragraphs(d.summary, link));
  const points = d.points ?? [];
  if (points.length) {
    html.push(`<h2>${esc(d.pointsHeading ?? "Key points")}</h2>`);
    if (source.kind === "video" || source.seconds)
      html.push(timeline(source, points, link));
    html.push(
      `<ol class="points">${points
        .map(
          (p) =>
            `<li><div class="pt-head">${p.title ? `<h3>${prose(p.title, link)}</h3>` : ""}${chip(p.at, link)}</div>${paragraphs(p.text, link)}</li>`,
        )
        .join("\n")}</ol>`,
    );
  }
  if (d.videos?.length) {
    if (d.videosHeading !== null)
      html.push(`<h2>${esc(d.videosHeading ?? "Videos")}</h2>`);
    html.push(await watchList(d.videos));
  }
  for (const s of d.sections ?? []) {
    if (s.heading) html.push(`<h2>${esc(s.heading)}</h2>`);
    if (s.text) html.push(paragraphs(s.text, link));
    if (s.items?.length)
      html.push(
        `<ul>${s.items.map((i) => `<li>${prose(i, link)}</li>`).join("")}</ul>`,
      );
  }
  if (d.quotes?.length) {
    html.push(`<h2>${esc(d.quotesHeading ?? "In their words")}</h2>`);
    for (const q of d.quotes)
      html.push(
        `<figure class="quote"><blockquote>${prose(q.text, link)}</blockquote>${q.at != null || q.who ? `<figcaption>${q.who ? `${esc(q.who)} ` : ""}${chip(q.at, link)}</figcaption>` : ""}</figure>`,
      );
  }
  if (source.chapters?.length && d.showChapters !== false)
    html.push(
      `<details class="chapters"><summary>${esc(d.chaptersHeading ?? "Chapters")} (${source.chapters.length})</summary><ol>${source.chapters
        .map(
          (c) =>
            `<li>${chip(clock(c.at, long), link)}<span>${esc(c.title)}</span></li>`,
        )
        .join("")}</ol></details>`,
    );
  const note =
    d.note ??
    (source.captions?.kind === "auto"
      ? "From the video's automatic captions, which can mishear names."
      : null);
  if (note) html.push(`<footer>${prose(note, link)}</footer>`);

  const page = wear(`<!doctype html>
<html lang="${esc(d.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{{shell.meta}}
<meta name="print" content="pdf">
<title>${esc(d.title)}</title>
<script>
// shell.theme
</script>
<style>
/* shell.css */
${readFileSync(quickCss, "utf8").trim()}
${CSS.trim()}
</style>
</head>
<body>
${pageHead(d.title)}
<div class="pg-page">
<div class="pg-read">
<main class="pg-paper">
${html.join("\n")}
</main>
{{shell.sign}}
</div>
</div>
<script>
// shell.js
</script>
</body>
</html>
`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page);
  const missing =
    (source.thumbnail || source.image) && !pic
      ? " The source's picture did not load."
      : "";
  return `${shown(out)} (${Math.round(page.length / 1024)} KB, one file).${missing} Hand back this path.`;
}

await run(async () => {
  const { positional, flags } = parseArgs();
  if (!positional[0] || typeof flags.name !== "string")
    throw new Stop(usage(import.meta.url));
  if (!NAME.test(flags.name))
    throw new Stop(
      `"${flags.name}" is not a page name: letters, numbers, - and _ only.`,
    );
  console.log(await build(positional[0], flags.name));
});

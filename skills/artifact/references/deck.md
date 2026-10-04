# A deck

A deck is the `make_deck` tool: each slide a layout whose fields you fill, drawn and fitted by the
app into one HTML file that presents full screen, prints a slide a page, and keeps a picture of
every slide and one of all of them beside it. Its fields say what each takes; this page is how to
fill them well. The same deck becomes a PDF or a video that reads itself (below).

- **The titles are the argument.** Someone who reads only the titles follows the deck: each says
  what the slide shows ("Rent rose faster than pay"), in one grammar from the first to the last,
  never the topic ("Rent").
- **One idea a slide.** A statement beats a list; three parallel points are `cards`; one number
  that carries the point is `number`; the same questions asked of several things are a `table`;
  someone's own words are a `quote` with who said it; dates in order are a `timeline`; the way
  things are beside the way they will be, or two options, are a `compare`, the side argued for on
  the right; two to four figures that make one point together are `stats`. More than a slide holds
  is two slides — the app never shrinks words to fit.
- **Open with a `cover` and end with a `close`** that says what to do or remember, not "Thank you".
- **Nothing invented.** A figure you were not given is a visible `[FIGURE]`; a number carries its
  source in the slide's footer.
- **Pictures come off the pages you read** (`webimage.mjs`, SKILL.md) and go in an `image` slide
  with their credit; a picture that only decorates is left out.
- **Numbers that move are a chart**, drawn as a picture from their CSV —
  `node $THURSDAY_SKILLS/artifact/scripts/chart.mjs <scratch>/<name>.svg <data.csv>` — and put in
  an `image` slide with `fit` whole; the heading beside it says what it shows, and its source goes
  in the slide's footer.
- **Notes are speech**: what the presenter says over the slide, in their voice, never the slide's
  words again. A video of the deck reads them aloud.
- **Changing a deck** is sending the whole deck again with the `revision` the last call answered
  with. The user can edit its words, notes, order and palette in the app; when they have, nothing
  is written and the tool answers with the deck as it stands — make your change on those slides.

## Explaining one thing simply

For someone who wants to understand one thing, the deck explains it the way a picture book does:
`picture` slides, each one picture that says it and a line or two under it, in short everyday
words, for someone who knows nothing about it. Open with a `cover` whose title is the question
the deck answers; six to ten `picture` slides fit most topics; a `quiz` may end it, and a `close`
says the one thing to remember.

- **One idea a slide, and the picture carries it.** Cover the words and the slide still says it.
  More to say is another slide, never a longer line; `more` is for a second line only when one
  more is needed.
- **A new word comes after its picture.** A slide first shows the thing (the rows of machines),
  and only then names it (`server`) in its `text`, with `term` set to that word so it is marked. A
  word no picture has shown yet does not appear.
- **Notes are the telling.** What is read over each slide in a video, a little fuller than its
  line, said the way a person reads a page aloud.
- **A light palette** — forest, sea, clay or paper — keeps drawn pictures on paper.

## Pictures

Choose each picture in this order:

- **A real thing whose look matters** — a place, an animal, a machine, a person's work — is a
  real photo from the page you read:
  `node "$THURSDAY_SKILLS/browser/scripts/webimage.mjs" <page url> --out <scratch> [--all]`. It
  prints each file with its size and a `Credit:` line; rename what you keep before fetching the
  next one, since every run writes `web-01.…`. The credit goes in the slide's `footer`
  ("Photo: <who>, <where>"), and a photo takes `fit` fill when cropping it loses nothing.
- **A structure, a flow, a relation** — parts of a whole, one thing asking another, a before and
  after — is an SVG you draw by hand into a file of its own (`<scratch>/p3-flow.svg`),
  `viewBox="0 0 1600 900"`: a few flat shapes with thick dark outlines rather than detail, text in
  it at 44 units or more, in a few flat colours that read on light paper. It is a picture file,
  so it keeps its colours whatever the palette.
- **A number that is the point** — how much, how many, how it changed — is a chart picture, drawn
  by `chart.mjs` as above and shown `whole`. One chart in an explanation is plenty; its line says
  what it shows.
- **A metaphor scene** — a feeling, an imagined place, a thing too small or too big to
  photograph — is a generated image: `generate_image` on the `studio` server through
  `tool_call`, `aspectRatio` `16:9`. The image model sees nothing of this job: write the whole
  picture in the prompt, and end every prompt with the same style sentence (medium, palette,
  light) or the slides come back in different hands. Never ask for text in a generated image —
  it comes back misspelled; words go in the line, or labels in an SVG. With no image model, the
  first two kinds still explain it; use them.

## A quiz

When the deck teaches something to remember, a `quiz` may ask about it: one question on what the
slides showed, two to four picks of a word or two (a picture when it helps), `right` the one that
is right and `answer` why. The reader taps a pick, it is marked, and the answer shows; on paper and
in a video the answer shows already. Ask only what the slides showed.

## A PDF

```bash
node $THURSDAY_SKILLS/artifact/scripts/deck.mjs pdf <deck name | path>
```

Writes `<deck>.pdf` beside the deck, one slide a sheet at the slide's own size, printed in a
browser of its own. A picture that did not load, or a slide that does not fit, stops it, named,
and nothing is printed: fix the deck with `make_deck` and run it again.

## A video that reads itself

1. **Check the voice before anything.** `tool_search` with `server: "studio"` and
   `tools: ["generate_speech"]` (and `generate_image` when a slide needs a generated picture). A
   name that does not come back means nobody picked that model, and a call answering that the
   model cannot make audio means the wrong one is picked. Either way ask the user to pick a
   speech (or image) model in Settings › Models, and end your turn. Never work around it with
   another voice.
2. **Every slide has notes**, written for the ear: short sentences, no links, numbers said the way
   a person says them. A slide without any gets them with `make_deck` first.
3. **One `generate_speech` call a slide**, in slide order, `text` set to that slide's notes, the
   same `voice` every time. Keep the paths it returns in order.
4. **One command makes the mp4.**

   ```bash
   node $THURSDAY_SKILLS/artifact/scripts/deck.mjs video <deck name | path> <audio 1> <audio 2> … <audio N>
   ```

   It shoots every slide as the deck draws it, holds each for exactly as long as its voice runs
   plus a short pause, and writes `<deck>.mp4` beside the deck: h264 and yuv420p, which every
   phone plays. It installs a portable ffmpeg into `projects/` the first time when the machine
   has none. Fewer audio files than slides, a slide that does not fit or a picture that did not
   load stops it with what to fix. When it is made, the voices are copied into `voices/` beside
   the deck, numbered by slide (`slide-01.mp3`), and it prints where they went.
5. Hand back the mp4's path and how long it runs, with the deck's path beside it.

To change a slide later, change the deck, make that slide's voice again if its notes changed, and
run the same command with every slide's voice — the ones in `voices/` for the slides that did not
change, the new file in its slide's place.

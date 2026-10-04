# Motion video

A short hand-drawn film: cut paper, crayon and handwriting that writes itself, on music made
for it. For a gift or a moment — a birthday, an anniversary, thanks to a parent, a farewell,
a wedding, a graduation — or any small story. You write each scene as a few lines of code
with the kit below; the kit does the drawing, the timing, the transitions and the music.

`S=<skill dir>/scripts`

```bash
node $S/motion.mjs put <name> <film.js>      # made and checked: fix everything it lists
node $S/motion.mjs shots <name>              # three moments of every scene on one picture: look_at it
node $S/motion.mjs render <name> --draft     # a quick mp4, to check the timing
node $S/motion.mjs render <name>             # the finished mp4 with motion blur and music
node $S/motion.mjs get <name> <film.js>      # its code as it is now, to change and put again
```

## 1. The story first

Before any code, write the story in 5 to 8 scenes, 20 to 45 seconds in all, one line each:
who is in it, the one thing that happens, the words on screen. Use what the user told you —
names, a habit, a place, a joke only they share: that is what makes it theirs.

- **One moment per scene.** One thing happens, and the viewer sees it.
- **Someone to care about.** Draw the people it is for, and keep them the same person in
  every scene (the `cast`).
- **Few words, big.** Seven words or fewer at a time, 60px and up; the viewer reads about 12
  letters a second once they are written.
- **Build to one payoff** — the cake, the hug, the words that matter — and end on it: the last
  scene is the message, held.
- **Its own colours.** Pick a palette for this film (a room's wall, the sky's hour, clothes):
  two films should not look alike.
- **Move a little, always:** people breathe and blink by themselves; add a camera push, a
  wave, something falling. Nothing sits dead for more than a second.

## 2. The film

Start from `templates/motion/birthday.js` (30 seconds, six scenes). The whole shape:

```js
film({
  title: "Happy birthday, Grandma",
  size: "1920x1080",          // or "1080x1920" for a phone, "1080x1080" square
  mood: "tender",             // tender, warm, playful, nostalgic, celebratory: the music
  seed: 3,                    // another number, another tune
  colors: { paper: "#fbf6ea", ink: "#2b3a67", card: "#f8f0dc" },
  cast: {
    grandma: { age: "elder", skin: "fair", hair: "grey", hairStyle: "bun", top: "#6c8f6a", bottom: "#5a4a6a", skirt: true, glasses: true },
    mia: { age: "child", skin: "tan", hair: "black", hairStyle: "pigtails", top: "#f27caa", bottom: "#3a80ef" },
  },
  images: { us: "pictures/us.jpg" },   // pictures saved in the video's folder, by their path there
  scenes: [
    { seconds: 4, draw(d) {
      d.room({ wall: "#f3c350", window: "night", lamp: true });
      d.person("grandma", 760, 950, 620, { face: "sleepy", pose: "sit" });
      d.write("Shh… she's asleep", d.W / 2, 200, { size: 80, at: 0.5 });
    }},
    { seconds: 4, enter: "tear", big: true, draw(d) { /* … */ } },
  ],
});
```

A scene: `seconds` (whole beats of the music, near what you ask), `draw(d)`, `enter` — how it
comes in: `fade` (the default), `tear`, `page`, `slide`, `iris`, `zoom`, `cut` — and `big: true`
for the moment the music should lift. The last scene holds a little longer by itself.

## 3. What `d` draws

Coordinates are pixels of the frame: `d.W` wide, `d.H` high, (0, 0) the top left. **People
and things stand on (x, y): x is their middle, y where their feet or bottom touch**, and
`size` is how tall they are. People, Thursday, bots and animals return where their `head` and
`top` are (a person also `hands` and `mouth`); a thing returns its `top` and `middle`.

**Time** — `d.t` seconds into the scene, `d.len` its length.
- `d.at(a, b)` 0→1 eased from second a to b · `d.lin(a, b)` the same, even
- `d.pop(a)` a scale from 0 that overshoots and lands at 1 (a pop sound) · `d.drop(a)` 0→1 falling in (a thump)
- `d.move(from, to, a, b)` a number going from→to between seconds a and b · `d.moving(a, b)` true between them
- `d.wave(speed, amount)` a gentle back and forth · `d.pulse` 1 on every beat, fading
- `d.sound(kind, at)`: pop, write, sparkle, whoosh, thump, chime, clap, boing, rustle, blow, shutter

**Camera and groups**
- `d.camera(x, y, zoom)` look at (x, y); call it first, then draw the scene where it is
- `d.group({ x, y, scale, rot, alpha }, () => { … })` draw around (x, y), turned and scaled
- `d.shake(amount)`

**Places** (fill the frame)
- `d.sky({ time: "day"|"dusk"|"night"|"dawn", sun, moon, stars, clouds, color })` — a day's sun
  is high on the right, a dusk or dawn sun low on the left, a night's moon high on the right: give
  `sun: [x, y]` or `sun: false` where it would sit on someone or on words
- `d.ground(kind, { y, color })`: hills, field, town, city, sea, beach, snow, road — after a sky
- `d.room({ wall, floor, y, window: "day"|"dusk"|"night"|false, curtains, lamp, frames })`
- `d.desk({ color, cloth })` a table seen from above · `d.plain(color)` plain paper
- `d.weather(kind, amount)`: snow, rain, petals, leaves

**People** — `d.person(name, x, y, size, o)`, `name` from the cast.
- cast: `age` adult, elder, child (shorter) · `skin` light, fair, tan, brown, deep or a colour ·
  `hair` black, brown, blond, red, grey, white or a colour · `hairStyle` short, long, bob, bun,
  ponytail, pigtails, curly, spiky, bald · `top`, `bottom`, `skirt: true`, `shoes` · `glasses`,
  `beard`, `hat` (party, cap, beanie, crown, grad)
- `pose`: stand, wave, cheer, hold, give, hug, point, clap, heart (arms over the head), cheeks,
  think, shrug, walk, sit
- `face`: smile, happy, laugh, surprised, sad, cry, teary (happy tears), sleepy, calm, wink,
  love, talk, worried, proud
- `facing: 1|-1` which way hug, give and point reach · `flip` · `look: [x, y]` · `hat`
- `holding: (x, y) => d.thing(…)` draws what they hold, (x, y) between their hands
- `d.her(x, y, r, { face, rays })` Thursday · `d.bot(color, x, y, size, { eyes })` a bot
- `d.dog(x, y, size, { color, face })` · `d.cat(x, y, size, { color, face })`

**Things** — `d.thing(name, x, y, size, o)`
- cake `{ candles, lit (0..1), smoke (0..1), color, tiers: 2 }` · gift `{ color, ribbon, open (0..1) }`
- balloons `{ n, colors }` · flowers (a bouquet) `{ colors, wrap }` · flowerbed (240 wide, growing) `{ colors, n }` · plant · heart `{ color, beat }`
- letter `{ open (0..1) }` · photo `{ caption }` (`d.photo(name, x, y, size)` shows a picture from `images`)
- mug · ring `{ open }` · star · sun · moon · cloud · tree `{ kind: round|pine|blossom|autumn }`
- house `{ wall, roof, lit }` · suitcase · plane · car `{ drive }` · book · camera `{ flash }`
- table (240 wide; its top is `size` up) · sofa · bench · music

**Words** — all written in the hand, a letter at a time, from second `at`.
- `d.write(text, x, y, { size, color, at, width, align })` x is the middle unless `align`
- `d.note(text, x, y, { size, at, color, ink, rot })` on a torn note that pops in
- `d.bubble(text, x, y, { to: [x, y], at })` a speech bubble, its tail toward `to` (a mouth)
- `d.card(x, y, { w, h, color, lined })` a big torn card to write on

**Moments**
- `d.sparkles(x, y, at)` · `d.burst(x, y, at)` · `d.hearts(x, y, at)` · `d.confetti(at)` · `d.fireworks(at)`

**Anything else** — cut it from paper yourself, and it looks like the rest:
`d.paper(points, color)`, `d.crayon(points, width, color)`, `d.fill(points, color)` with the
shapes `d.ellipse(cx, cy, rx, ry)`, `d.rect(x, y, w, h, r)`, `d.star(cx, cy, r)`,
`d.heart(cx, cy, r)`, `d.cloud(cx, cy, r)`, `d.arc(cx, cy, rx, ry, a0, a1)`, `d.curve(...points)`,
`d.tube(points, width)`. Build the thing inside `d.group({ x, y, scale }, …)` around (0, 0)
and write it once as a function you call in every scene it is in.

## 4. Look, fix, render

1. `put`: it runs every scene. Fix every error and note it lists — a word off the frame, too
   small, written too late to be read or over a face; people too small to see — and put again.
2. `shots`, then look_at the sheet. Ask: can I tell the story with the sound off? Is every
   word inside the frame and away from faces? Does the last scene say the thing?
3. Fix what is weak — usually too many words, things too small, or a scene that does nothing
   — put and look again, two rounds at most.
4. `render --draft` to feel the timing; then `render`. Hand back the mp4's path.

## Mistakes to avoid

- Putting text where a head or a hand is: keep words in the top third, or on a note.
- People too small: someone the film is about is 450px tall or more in a 1080-high frame; put
  names a scene whose people are all under 330px.
- Everything at once: stagger `at` so things arrive one after another, on the beat.
- A new look for a person in each scene: define them once in `cast`.
- Forgetting the frame's shape: for 1080x1920 put people lower and words higher, one per line.

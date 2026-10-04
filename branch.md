# claude/wonderful-brown-9b9pgz

Motion videos as a kind in the `artifact` skill: a short hand-drawn film with music — a birthday
or anniversary gift, a thank-you, a farewell, a small story. A bot writes each scene as a few
lines of code with a drawing kit; the page plays it in the app and renders it to mp4.

Round three replaced the JSON scenes of rounds one and two (40 kinds of card in the app's look):
those made every video look the same. Now:

- `skills/artifact/runtime/motion/` — the kit: `kit-core.js` (crayon textures, torn paper,
  crayon lines, shapes, handwriting written a letter at a time), `kit-people.js` (people of any
  skin, hair, clothes and age in 14 poses and 14 faces, Thursday, her bots, a dog, a cat),
  `kit-things.js` (25 things: cake, gift, balloons, flowers, letter, photo, ring, …),
  `kit-places.js` (sky at four hours, eight grounds, a room, a desk, weather, sparkles, hearts,
  confetti, fireworks, notes and cards); `film.js` (scenes on the music's beat, seven
  transitions, motion blur within a scene, the player, a dry pass that hears the sounds and
  checks the words); `score.js` (music in five moods from sine partials, the scenes' sounds, a
  small hall); `page.mjs`, `motion.html`; Gaegu Bold (OFL) for Hangul and Latin.
- Anything the kit has not got is cut from paper with `d.paper`/`d.crayon` and the shapes, and
  looks like the rest.
- `skills/artifact/scripts/motion.mjs` — `put` (runs every scene in a browser: errors with their
  scene and line, words off the frame, too small or read too late), `get`, `shots` (three
  moments a scene on one picture), `render` (frames through the browser skill's `apart`
  session, four subframes blended, music made by the same `score.js` the player plays).
- `references/motion.md` (the story first, the kit, look-fix-render), `templates/motion/birthday.js`
  (30 s, six scenes), SKILL.md row and description, guide, README credit, skills map, pack
  REQUIRED, biome override for the kit's shared scope, `scripts/motion.test.mts` (the example
  runs clean in a fake canvas, errors are named, the music is whole and seeded, the page holds
  its code).

Tried by Sonnet bots from the skill alone (a MapleStory short, a mother's 60th): both finished;
what they tripped on became put's face and size checks, a flowerbed, and a line on the sky's sun.

Open: not yet run end to end by a bot in the real app; a 30 s film takes about 3 minutes to
render here (1.5 as a draft), most of it drawing the crayon textures four times a frame.

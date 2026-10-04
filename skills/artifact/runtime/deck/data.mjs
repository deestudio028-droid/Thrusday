// A deck as its page holds it: the one size every slide is, and the deck read back out of the
// page. deck.mjs beside it writes both; the artifact skill's scripts/deck.mjs carries a deck
// on (a PDF, a video) from them.

/** Every slide's size; the tool offers no other. */
export const W = 1920;
export const H = 1080;

/** The deck a page holds as data, or null: one written by hand before decks were data. */
export function deckIn(html) {
  const found =
    /<!-- put: start[^>]*-->\s*<script type="application\/json" data-deck(?:="")?>([\s\S]*?)<\/script>/.exec(
      html,
    );
  if (!found) return null;
  try {
    return JSON.parse(found[1]);
  } catch {
    return null;
  }
}

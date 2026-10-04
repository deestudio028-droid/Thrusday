import assert from "node:assert/strict";
import test from "node:test";
import { captionText, plainText } from "../lib/utils.ts";

// Emphasis marks come off and nothing else does: a masked key, a file name or a sum drawn
// on the pill or under her face reads as it was written.
const kept = [
  "Incorrect API key provided: sk-ux-te******alid.",
  "Saved to artifacts/jarvis/cafe_list_v2.md",
  "2 * 3 * 4 = 24",
  "sign_in_use stays",
  "*.md files and *.ts files",
];

test("plain text keeps what only looks like emphasis", () => {
  for (const text of kept) assert.equal(plainText(text), text);
});

test("a caption keeps what only looks like emphasis", () => {
  for (const text of kept) assert.equal(captionText(text), text);
});

test("emphasis comes off, one mark inside another too", () => {
  const cases: [string, string][] = [
    ["**bold** and *em* and _em_ and __bold__", "bold and em and em and bold"],
    ["***both*** and ___both___", "both and both"],
    ["**a *b* c** then _**d**_", "a b c then d"],
    ["foo*bar*baz", "foobarbaz"],
  ];
  for (const [text, bare] of cases) {
    assert.equal(plainText(text), bare);
    assert.equal(captionText(text), bare);
  }
});

test("a caption keeps a link's underscores and takes marks off its label", () => {
  assert.equal(
    captionText("See **[the_list](artifacts/cafe_list_v2.md)** now"),
    "See [the_list](artifacts/cafe_list_v2.md) now",
  );
});

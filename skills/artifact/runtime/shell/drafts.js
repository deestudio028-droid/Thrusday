// A page's words its file does not hold yet, kept aside until they reach the file or the
// reader lets them go: one set for each revision of the file they were written on, since
// words written on the file as it is can go back in place, and words written on a version
// since replaced can only be shown beside it. The shell keeps them in this browser for a
// page nothing saves (shell.js `edits`); the app keeps its own the same way
// (features/workspace/page-drafts.ts). A list in, a list out: wear puts this inside
// shell.js, and scripts/page-edits.test.mts runs it alone.
// biome-ignore lint/correctness/noUnusedVariables: shell.js reads it, once wear puts it there
const drafts = {
  /** One kept set: the kind's words (`html`), the revision they were written on, and when. */
  valid: (one) =>
    Boolean(one) &&
    typeof one.base === "string" &&
    typeof one.html === "string" &&
    Number.isFinite(one.at),
  /** `list` with `one` in it, in place of any kept for the same revision. */
  hold: (list, one) => [...list.filter((d) => d.base !== one.base), one],
  /** `list` without what was kept for `base`. */
  drop: (list, base) => list.filter((d) => d.base !== base),
  /** What was written on `revision`, the file as it is, and what on others, oldest first. */
  split: (list, revision) => ({
    here: list.find((d) => d.base === revision) ?? null,
    other: list.filter((d) => d.base !== revision).sort((a, b) => a.at - b.at),
  }),
};

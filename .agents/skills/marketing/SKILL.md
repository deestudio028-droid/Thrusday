---
name: marketing
description: Entry point for this project's marketing work - the private marketing folder with the task list, facts, channel playbooks and drafts. Use when the user says 마케팅, 마케팅 하자, 홍보, 런칭, 포스트 써줘, 글 초안, "run M<number>", or asks to work on launch, promotion, posts or outreach.
---

Marketing for this project already has a plan and one folder that holds all of it: `docs/marketing.local.d/`. Start from it, never from a blank page. The folder is private (its name matches `*.local.*`), so nothing in it is ever committed.

1. Read `docs/marketing.local.d/README.md` first. It says who writes on which channel, how a post gets written, and where everything is.

2. Read `docs/marketing.local.d/tasks.md`. Every task has an id, a tag for what it needs from the owner, and what it waits on. If the user named an id ("run M9"), run that task. Otherwise lead: say where things stand in a few lines, pick what moves the most and needs nothing from the owner, and run it.

3. Before writing anything about the product, read `facts.md` there — its first table says what is released and what is only on main, then what may be said, what it costs, what is not local, and the claims that are false — then the channel's section in `channels.md`, which says who writes there. Copy already written and waiting is in `drafts/ready.md`; look there before writing anything new. Who writes on which channel:
   - **the owner by hand** (Hacker News, X, Dev.to, awesome-selfhosted): hand over facts, timing and a check of their own text. Never sentences to paste; these places ban machine-written posts or suspend accounts nobody taps.
   - **an agent drafts, the owner posts** (GeekNews, the OpenAI forum, messages to people): write the exact text into `drafts/ready.md` under that channel.
   - **an agent runs it after the owner's yes** (GitHub, mail, newsletter and directory forms, Reddit and Threads on the owner's account). Mail follows `mail-runbook.md`.

4. Load a writing skill only when the task needs it. Read its SKILL.md by path; this works whether or not the skill is linked into `.Codex/skills`:
   - copy for a page or a post: `~/.Codex/skills/copywriting/SKILL.md`
   - what to write and when: `.agents/skills/content-strategy/SKILL.md`
   - framing and persuasion: `.agents/skills/marketing-psychology/SKILL.md`
   - search visibility: `.agents/skills/seo-audit/SKILL.md`
   - video and media assets: `.agents/skills/image-to-video/SKILL.md`, `.agents/skills/media-use/SKILL.md`

5. When a task finishes or its state changes, update its line in `tasks.md`, add what went out to `log/posted.md`, delete a sent piece from `drafts/ready.md`, and republish the owner's status board (its URL is in the folder's README) when the task list moved. Keep the folder small: what is done is deleted, and history lives in `log/posted.md` and `archive/`.

Nothing is posted, sent or published until the user has seen the exact text and said yes. A step that is the owner's (an account, a recording, a post only a person may write) stops there and says what is needed. Never a bot account, an ask for stars or upvotes, the same text in two places, or a password typed by an agent.

The app itself has a bot for the recurring part: **cgoing** (`.ai-workspace/bots/cgoing/`, role in `docs/marketing.local.d/cgoing.md`) reports the project's pulse and drafts the weekly "what shipped" into `.ai-workspace/artifacts/cgoing/`. Read what it wrote before collecting the same numbers again. Its `memory/` holds what this work learned by doing it — the mail sender, the marketing browser, the channel holds, the asset URLs, the house rules, the broken forms. When a session learns something of that shape, add it there in the same file and copy it back to `docs/marketing.local.d/app-kit/cgoing/memory/`.

A reset of the app wipes cgoing and Jarvis's demo job. At the start of a marketing session, check `sqlite3 local.db "select count(*) from bot where name='cgoing'"` from the repo root; if it prints 0 and the app has booted since the reset, run `bash docs/marketing.local.d/app-kit/restore.sh` and tell the user it was put back.

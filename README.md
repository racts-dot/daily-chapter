# Daily Chapter

One Bible chapter a day, and a place to write what you learnt from it.

Open it and today's chapter is already on screen with the full text underneath.
Tap any verse to keep it. Write what you made of it. Tomorrow it moves on by
itself. Everything you write stays in your own browser — there is no account, no
server, and nothing is uploaded anywhere.

**It is one file.** `index.html` is the entire app. Open it and it works.

## What it does

- **Today's chapter, chosen for you.** Pick a plan and a starting point; it walks
  from there, one chapter a day. Move to any book and chapter whenever you like.
- **The text, properly set.** Poetry laid out as poetry, section headings,
  small-caps LORD, and the translators' footnotes (hidden until you want them).
- **Tap verses to keep them.** They underline; a run like 2, 3, 4 is written as
  one reference. Tap again to remove.
- **A journal for each day** — the verse that stood out, a long-form summary in
  your own words, what you learnt, how you will use it, prayer, tags.
- **Searchable history**, streaks, and progress through the plan.
- **Export** as a backup file, Markdown or CSV. Restore merges rather than
  overwrites.
- **Works offline.** A chapter you have opened stays readable with no signal, and
  the whole app installs to a phone home screen when hosted.

## Translations

Chapter text comes from Tyndale's own service, `api.nlt.to`, and from
`bible-api.com`.

| | |
|---|---|
| **New Living Translation** | The default. Anonymous use is allowed: 50 verses per request, 500 requests a day, so chapters are requested in 50-verse pieces. No key needed. |
| **NLT, UK spelling** | The same translation with *honour*, *Saviour*. |
| World English Bible | Public domain. |
| King James Version | Public domain. |

⚠ **The NLT is copyright Tyndale House Foundation, and anonymous use is
non-commercial.** Reading and journalling is exactly what it is for. Anything you
intend to *sell* that contains NLT text needs a licence from Tyndale — use the
public domain options for that. Every NLT chapter displays Tyndale's required
copyright line.

## Where your writing lives

In your browser, on your device (`localStorage`). Not on a server. Nobody else
can read it — including whoever hosts this page.

The flip side: **clearing your browser data deletes it**, and two devices do not
share. Use *Settings → Back up* now and then.

`sync/Code.gs` is an optional extra: a Google Apps Script you run in your **own**
Google account, which copies each day into your own Google Sheet and Notion. The
app posts to it; only that script holds any keys.

## Checking it

```
python check_bible_app.py            # data and plumbing are sound
python check_bible_app.py --live     # ...and both services answer the awkward references
python check_bible_app.py --selftest # prove the checker can actually fail
```

`--selftest` breaks the app ten ways on a throwaway copy and requires all ten to
be caught. It checks 66 books and 1,189 chapters in canonical order, that every
plan resolves with no repeated chapter, that the NLT's own name for Song of
Solomon is mapped, that Tyndale's copyright line is present, and that the cleaner
which strips `<script>` out of incoming HTML is applied to cached text as well.

It does **not** judge whether the app is pleasant to use. Only using it does that.

## Hosting it yourself

Any static host. On GitHub Pages: **Settings → Pages → Deploy from a branch →
`main` → `/ (root)`**. Then open it on a phone and *Add to Home Screen*.

Note that a hosted page is public. The app contains no personal data — your
writing never leaves your device — but the page itself will be visible to anyone
with the link.

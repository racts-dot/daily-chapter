#!/usr/bin/env python3
"""Gate for bible_daily/. Run before shipping any change to the app.

    python check_bible_app.py            # check the app in this folder
    python check_bible_app.py --live     # also ask bible-api.com for the awkward refs
    python check_bible_app.py --selftest # prove this gate can actually fail

It reads the book table and the plan table straight out of index.html, so there
is exactly one copy of that data and nothing to drift. It does NOT judge whether
the app looks good - open it and use it for that.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

# Canonical Protestant canon. These are the numbers the gate exists to defend.
EXPECTED_BOOKS = 66
EXPECTED_OT = 39
EXPECTED_NT = 27
EXPECTED_CHAPTERS = 1189


def extract(html, name):
    """Pull a JSON literal out of index.html between its /* NAME_START */ markers."""
    pattern = r"/\* " + name + r"_START \*/(.*?)/\* " + name + r"_END \*/"
    match = re.search(pattern, html, re.S)
    if not match:
        raise ValueError("marker block %s_START ... %s_END not found in index.html" % (name, name))
    body = match.group(1).strip()
    body = re.sub(r"^const\s+\w+\s*=\s*", "", body).rstrip().rstrip(";")
    return json.loads(body)


def check(app_dir, live=False):
    """Return a list of failure strings. Empty list means every check held."""
    fails = []
    index_path = os.path.join(app_dir, "index.html")
    if not os.path.exists(index_path):
        return ["index.html is missing from %s" % app_dir]
    html = open(index_path, encoding="utf-8").read()

    try:
        books = extract(html, "BOOKS_JSON")
        plans = extract(html, "PLANS_JSON")
        one_chapter = extract(html, "ONECHAP_JSON")
        translations = extract(html, "TRANSLATIONS_JSON")
        nlt_names = extract(html, "NLTBOOKS_JSON")
    except ValueError as err:
        return ["could not read the data blocks: %s" % err]
    except json.JSONDecodeError as err:
        return ["a data block in index.html is not valid JSON: %s" % err]

    # ---- the book table -------------------------------------------------
    names = [b["name"] for b in books]
    if len(books) != EXPECTED_BOOKS:
        fails.append("book count is %d, expected %d" % (len(books), EXPECTED_BOOKS))
    if len(set(names)) != len(names):
        dupes = sorted({n for n in names if names.count(n) > 1})
        fails.append("duplicate book names: %s" % ", ".join(dupes))
    total = sum(b["chapters"] for b in books)
    if total != EXPECTED_CHAPTERS:
        fails.append("chapters total %d, expected %d" % (total, EXPECTED_CHAPTERS))
    ot = [b for b in books if b["testament"] == "OT"]
    nt = [b for b in books if b["testament"] == "NT"]
    if len(ot) != EXPECTED_OT or len(nt) != EXPECTED_NT:
        fails.append("testament split is %d OT / %d NT, expected %d / %d"
                     % (len(ot), len(nt), EXPECTED_OT, EXPECTED_NT))
    if names[:1] != ["Genesis"] or names[-1:] != ["Revelation"]:
        fails.append("books are not in canonical order (starts %r, ends %r)" % (names[0], names[-1]))
    if any(b["chapters"] < 1 for b in books):
        fails.append("a book has fewer than 1 chapter")
    if names.index("Malachi") != len(ot) - 1:
        fails.append("Old Testament books are not contiguous - Malachi is not the last OT book")

    # ---- the single-chapter books --------------------------------------
    singles = {b["name"] for b in books if b["chapters"] == 1}
    listed = set(one_chapter)
    if singles != listed:
        fails.append("single-chapter book list is wrong: table says %s, verse map says %s"
                     % (sorted(singles), sorted(listed)))
    for book, verses in one_chapter.items():
        if not isinstance(verses, int) or verses < 1:
            fails.append("%s has a nonsense verse count: %r" % (book, verses))

    # ---- the plans ------------------------------------------------------
    index_of = {b["name"]: i for i, b in enumerate(books)}
    ids = [p["id"] for p in plans]
    if len(set(ids)) != len(ids):
        fails.append("two plans share an id")
    if not plans:
        fails.append("no reading plans defined")
    for plan in plans:
        refs = []
        for start, end in plan["ranges"]:
            if start not in index_of or end not in index_of:
                fails.append("plan %r names a book that does not exist: %s..%s" % (plan["id"], start, end))
                continue
            if index_of[start] > index_of[end]:
                fails.append("plan %r has a backwards range: %s..%s" % (plan["id"], start, end))
                continue
            for i in range(index_of[start], index_of[end] + 1):
                refs += ["%s %d" % (books[i]["name"], c) for c in range(1, books[i]["chapters"] + 1)]
        if not refs:
            fails.append("plan %r produces no chapters" % plan["id"])
        if len(set(refs)) != len(refs):
            fails.append("plan %r repeats a chapter" % plan["id"])
        if not plan.get("name"):
            fails.append("plan %r has no name to show the reader" % plan["id"])

    whole = [p for p in plans if p["id"] == "whole"]
    if whole:
        n = sum(b["chapters"] for b in books)
        if n != EXPECTED_CHAPTERS:
            fails.append("the whole-Bible plan is %d days, expected %d" % (n, EXPECTED_CHAPTERS))

    # ---- translations ---------------------------------------------------
    ids = [t["id"] for t in translations]
    if len(set(ids)) != len(ids):
        fails.append("two translations share an id")
    for t in translations:
        if t["source"] not in ("nlt", "bibleapi"):
            fails.append("translation %r has an unknown source %r" % (t["id"], t["source"]))
        if not t.get("label") or not t.get("name"):
            fails.append("translation %r has no label or name to show the reader" % t["id"])
    if "NLT" not in ids:
        fails.append("the NLT is not on offer")
    if '"NLT"' not in html.split("DEFAULT_SETTINGS")[1][:200]:
        fails.append("the NLT is not the default translation")

    # The NLT service calls one book by another name; getting this wrong
    # silently serves the wrong book, which is worse than an error.
    if nlt_names.get("Song of Solomon") != "Song of Songs":
        fails.append("the NLT name for Song of Solomon is missing or wrong: %r"
                     % nlt_names.get("Song of Solomon"))
    for ours in nlt_names:
        if ours not in [b["name"] for b in books]:
            fails.append("the NLT name map renames a book that is not in the table: %r" % ours)

    # Tyndale ask for the copyright line wherever their text is shown, and
    # cap anonymous requests at 50 verses.
    for needle, why in (
        ("New Living Translation, copyright", "the NLT copyright line is missing"),
        ("Tyndale House Publishers", "the NLT copyright line does not credit Tyndale"),
    ):
        if needle not in html:
            fails.append(why)
    chunk = re.search(r"NLT_CHUNK\s*=\s*(\d+)", html)
    if not chunk:
        fails.append("the NLT request size is not set anywhere")
    elif int(chunk.group(1)) > 50:
        fails.append("NLT requests ask for %s verses at a time; Tyndale allow 50 without a key"
                     % chunk.group(1))

    # Third-party HTML is injected into the page, so the cleaner must be there.
    for needle, why in (
        ("SCRIPT:1", "the HTML cleaner does not drop <script>"),
        ("IFRAME:1", "the HTML cleaner does not drop <iframe>"),
        ("function sanitise", "the HTML cleaner is missing"),
    ):
        if needle not in html:
            fails.append(why)
    if html.count("sanitise(doc.body") < 1:
        fails.append("cached chapter HTML is rendered without being cleaned again")

    # ---- the files the app asks the browser for -------------------------
    for asset in ("manifest.webmanifest", "sw.js", "icon.svg"):
        if not os.path.exists(os.path.join(app_dir, asset)):
            fails.append("%s is missing - the app links to it" % asset)
    if "manifest.webmanifest" not in html:
        fails.append("index.html does not link the manifest, so it will not install to a phone")
    if "sw.js" not in html:
        fails.append("index.html does not register sw.js, so it will not work offline")

    man_path = os.path.join(app_dir, "manifest.webmanifest")
    if os.path.exists(man_path):
        try:
            man = json.load(open(man_path, encoding="utf-8"))
            for field in ("name", "start_url", "icons", "display"):
                if not man.get(field):
                    fails.append("manifest.webmanifest has no %s" % field)
            for icon in man.get("icons", []):
                if not os.path.exists(os.path.join(app_dir, icon["src"])):
                    fails.append("manifest points at a missing icon: %s" % icon["src"])
        except json.JSONDecodeError as err:
            fails.append("manifest.webmanifest is not valid JSON: %s" % err)

    # ---- choosing verses ------------------------------------------------
    # Word-boundary matches: a renamed function must not satisfy the check by
    # still containing the old name as a substring.
    for pattern, why in (
        (r"function applySelection\b", "verses cannot be underlined - applySelection is gone"),
        (r"function buildQuote\b", "chosen verses are not turned into a quote"),
        (r"\.vsel\b", "the underline style for a chosen verse is missing"),
        (r"verses\s*:\s*\[\]", "an entry has nowhere to remember which verses were chosen"),
        (r"function summaryOf\b", "the chapter summary is gone"),
        (r"function namesIn\b", "the name meanings section is gone"),
    ):
        if not re.search(pattern, html):
            fails.append(why)

    # ---- the writing must have somewhere to go --------------------------
    for field in ("fLearnt", "fVerse", "fSummary", "fApply", "fPrayer", "fTags", "fDone"):
        if 'id="%s"' % field not in html:
            fails.append("the journal field %s is missing from the page" % field)
    if "localStorage" not in html:
        fails.append("nothing saves the writing")
    for label, needle in (("back up", "expJson"), ("restore", "impFile"), ("markdown", "expMd"), ("csv", "expCsv")):
        if needle not in html:
            fails.append("no way to %s the journal" % label)

    # ---- optional: does the API actually answer these references? -------
    if live:
        fails += live_checks(books, one_chapter, nlt_names)

    return fails


def fetch(url):
    """GET a URL. curl, because this machine's proxy refuses urllib."""
    out = subprocess.run(["curl", "-s", "--max-time", "40", url], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("curl exit %d" % out.returncode)
    return out.stdout


def live_checks(books, one_chapter, nlt_names):
    """Ask both services for the references the app will actually send."""
    import urllib.parse
    fails = []

    probes = ["Genesis 1", "Psalms 119", "Song of Solomon 8", "1 John 5"]
    probes += ["%s 1:1-%d" % (b, v) for b, v in sorted(one_chapter.items())]
    for probe in probes:
        url = "https://bible-api.com/%s?translation=web" % urllib.parse.quote(probe)
        try:
            data = json.loads(fetch(url))
            if not data.get("verses"):
                fails.append("live check: bible-api gave no verses for %s" % probe)
        except Exception as err:
            fails.append("live check: bible-api failed on %s (%s)" % (probe, err))

    # Every book name the app will send to Tyndale must resolve to that book.
    for book in books:
        sent = nlt_names.get(book["name"], book["name"])
        url = "https://api.nlt.to/api/parse?ref=%s&key=TEST" % urllib.parse.quote(sent + ".1")
        try:
            parsed = json.loads(fetch(url))
            title = parsed[0][0].get("title") if parsed and parsed[0] else None
        except Exception as err:
            fails.append("live check: NLT parse failed on %s (%s)" % (sent, err))
            continue
        if not title:
            fails.append("live check: the NLT does not recognise %r (sent as %r)" % (book["name"], sent))

    # A long chapter must come back whole, in 50-verse pieces.
    seen = set()
    start = 1
    while start <= 200:
        url = ("https://api.nlt.to/api/passages?ref=%s&version=NLT&key=TEST"
               % urllib.parse.quote("Psalm.119.%d-%d" % (start, start + 49)))
        try:
            body = fetch(url)
        except Exception as err:
            fails.append("live check: NLT passage failed on Psalm 119 (%s)" % err)
            break
        nums = {int(n) for n in re.findall(r'class="vn">(\d+)<', body)}
        if not nums or max(nums) <= max(seen or {0}):
            break
        seen |= nums
        if max(nums) < start + 49:
            break
        start += 50
    if len(seen) != 176:
        fails.append("live check: chunked Psalm 119 came back with %d verses, expected 176" % len(seen))

    return fails


def selftest():
    """Break the app four ways on a temporary copy and prove the gate says so."""
    cases = [
        ("a wrong chapter count",
         lambda s: s.replace('{"name":"Psalms","chapters":150', '{"name":"Psalms","chapters":149')),
        ("a book quietly dropped",
         lambda s: s.replace('{"name":"Jude","chapters":1,"testament":"NT"},\n', "")),
        ("a plan pointing at a book that does not exist",
         lambda s: s.replace('[["Matthew","Revelation"]]', '[["Matthew","Revelations"]]')),
        ("the 'what I learnt' box deleted",
         lambda s: s.replace('id="fLearnt"', 'id="fSomethingElse"')),
        ("the summary box deleted",
         lambda s: s.replace('id="fSummary"', 'id="fSomethingElse"')),
        ("the NLT name for Song of Songs broken",
         lambda s: s.replace('{"Song of Solomon":"Song of Songs"}', '{"Song of Solomon":"Song of Solomon"}')),
        ("the Tyndale copyright line removed",
         lambda s: s.replace("New Living Translation, copyright", "New Living Translation, ")),
        ("the 50-verse anonymous limit raised",
         lambda s: s.replace("NLT_CHUNK = 50", "NLT_CHUNK = 500")),
        ("the HTML cleaner letting <script> through",
         lambda s: s.replace("SCRIPT:1,", "")),
        ("verse underlining removed",
         lambda s: s.replace("function applySelection", "function applySelectionOff")),
        ("chosen verses no longer kept with the entry",
         lambda s: s.replace("verses:[], quote:\"\",", "")),
        ("the chapter summary removed",
         lambda s: s.replace("function summaryOf", "function summaryOfGone")),
        ("the name meanings removed",
         lambda s: s.replace("function namesIn", "function namesInGone")),
    ]
    print("SELF-TEST - each line below must say CAUGHT\n")
    ok = True

    clean = check(HERE)
    if clean:
        print("  NOT CAUGHT  the unmodified app should pass and did not:")
        for f in clean:
            print("      - %s" % f)
        ok = False
    else:
        print("  ok          the unmodified app passes")

    src = open(os.path.join(HERE, "index.html"), encoding="utf-8").read()
    for label, break_it in cases:
        tmp = tempfile.mkdtemp(prefix="bible_gate_")
        try:
            for asset in ("manifest.webmanifest", "sw.js", "icon.svg"):
                shutil.copy(os.path.join(HERE, asset), tmp)
            broken = break_it(src)
            if broken == src:
                print("  BROKEN TEST the edit for %r changed nothing" % label)
                ok = False
                continue
            open(os.path.join(tmp, "index.html"), "w", encoding="utf-8").write(broken)
            fails = check(tmp)
            if fails:
                print("  CAUGHT      %s -> %s" % (label, fails[0]))
            else:
                print("  NOT CAUGHT  %s slipped straight through" % label)
                ok = False
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    print("\nSELF-TEST %s" % ("PASSED - the gate can fail" if ok else "FAILED - the gate is asleep"))
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="also ask bible-api.com for the awkward references")
    parser.add_argument("--selftest", action="store_true", help="prove the gate can fail")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    fails = check(HERE, live=args.live)
    if fails:
        print("NOT SHIPPABLE - %d problem%s:" % (len(fails), "" if len(fails) == 1 else "s"))
        for f in fails:
            print("  - %s" % f)
        return 1

    html = open(os.path.join(HERE, "index.html"), encoding="utf-8").read()
    books = extract(html, "BOOKS_JSON")
    plans = extract(html, "PLANS_JSON")
    index_of = {b["name"]: i for i, b in enumerate(books)}
    print("CHECKS HELD. This says the data and the plumbing are sound.")
    print("It does NOT say the app is nice to use - open it and use it for a week.\n")
    print("  %d books, %d chapters" % (len(books), sum(b["chapters"] for b in books)))
    for plan in plans:
        days = 0
        for start, end in plan["ranges"]:
            days += sum(books[i]["chapters"] for i in range(index_of[start], index_of[end] + 1))
        print("  %-16s %5d days  %s" % (plan["id"], days, plan["name"]))
    if not args.live:
        print("\n  (run with --live to also check bible-api.com answers the awkward references)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

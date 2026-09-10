# Setting up the postbox

**What this is:** a small script that lives inside *your own* Google account. The
app posts your day's writing to it; it writes that into your Google Sheet and
your Notion. The app never holds a password — this does.

**Time:** about 10 minutes, once. Part A alone gets you the Sheet working; Part B
adds Notion and can wait until another day.

Your two destinations already exist:

| | Where |
|---|---|
| Sheet | https://docs.google.com/spreadsheets/d/1mC_YYWcqgijRvqrMVlbAVeJ6i49gvB4Ri_vLbI98zkI/edit |
| Notion | https://app.notion.com/p/be092a1cdea943ea95ff86f28713d3f1 |

---

## Part A — Google Sheets (5 minutes)

1. Open the **Sheet** link above.
2. Menu: **Extensions → Apps Script**. A code window opens in a new tab.
3. Delete everything in that window. Open `Code.gs` (next to this file), copy
   **all** of it, and paste it in. Press the **save** icon.
4. Click the **gear** on the left (*Project Settings*). Scroll to
   **Script Properties → Add script property**:

   | Property | Value |
   |---|---|
   | `SHEET_ID` | `1mC_YYWcqgijRvqrMVlbAVeJ6i49gvB4Ri_vLbI98zkI` |

   Click **Save script properties**.
5. Top right: **Deploy → New deployment**. Click the gear beside *Select type*
   and choose **Web app**. Then:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - **Deploy**
6. Google will ask you to authorise it. It will warn that the app is not
   verified — **that is expected, because the app is your own script**. Click
   **Advanced → Go to (project name) (unsafe) → Allow**.
7. Copy the **Web app URL**. It ends in `/exec`.
8. In the Daily Chapter app: **Settings → Sync address** → paste it → tap
   **Test the address**. It should say *the address answered correctly*.

Done. Every day you write now lands in the Sheet by itself.

---

## Part B — Notion (5 more minutes, whenever you like)

1. Go to **notion.so/my-integrations** → **New integration**. Name it
   `Daily Chapter`, keep it **Internal**, create it, and **copy the secret**
   (a long string starting `ntn_` or `secret_`).
2. Open the **Notion database** link above. Top right **⋯ → Connections →
   Connect to →** pick `Daily Chapter`. *Without this step Notion will refuse
   the script, and that is the single most common thing to get wrong.*
3. Back in the Apps Script tab: **gear → Script Properties → Add**, twice:

   | Property | Value |
   |---|---|
   | `NOTION_TOKEN` | the secret you copied |
   | `NOTION_DB` | `be092a1cdea943ea95ff86f28713d3f1` |

   **Save script properties.** No redeploy needed — properties take effect at once.
4. In the app: **Settings → Send everything now**. Your days appear in Notion.

---

## Part C — the "what's wrong" list (only if you want it in Notion)

Snags typed into the app land in a **Snags** tab in your Sheet with no extra
setup at all. To have them appear in Notion as well:

1. Open the snag database: https://app.notion.com/p/82b7b95da8aa4f85857c48cdeba3cc8d
2. **⋯ → Connections → Connect to →** your `Daily Chapter` integration
   (the same one from Part B).
3. Apps Script → **gear → Script Properties → Add**:

   | Property | Value |
   |---|---|
   | `NOTION_SNAG_DB` | `82b7b95da8aa4f85857c48cdeba3cc8d` |

## ⚠ When the script itself changes

Adding or changing a **property** takes effect at once. Changing the **code**
does not. After pasting a new `Code.gs`:

**Deploy → Manage deployments → the pencil → Version: New version → Deploy.**

The web address stays the same, so nothing needs re-pasting into the app. Skip
this and Google quietly keeps running the old code.

---

## Things worth knowing

- **"Anyone" access** means anyone who knows the URL could post junk *into* your
  Sheet. They **cannot read** your Sheet or your Notion, and cannot touch your
  phone. Keep the URL to yourself. If it ever leaks: **Deploy → Manage
  deployments → Archive**, then deploy again for a fresh URL, and paste the new
  one into the app.
- **Sending the same day twice is harmless.** Everything is keyed by the date and
  overwritten, so one row and one Notion page per day, however many times it sends.
- **No signal?** The app keeps your writing and says how many days are waiting.
  It sends them next time it can. Nothing is lost and nothing is blocked.
- **Notion not set up?** Sheets still works on its own. The script skips Notion
  entirely if there is no token.
- **Changed the code** in Apps Script? You must **Deploy → Manage deployments →
  edit (pencil) → New version → Deploy**, or the old code keeps running.
  Changing only the *properties* needs no redeploy.

## If it says something went wrong

| It says | What it means |
|---|---|
| *the address answered 401 / 403* | The deployment is not set to **Anyone**. Redo step 5. |
| *SHEET_ID is not set* | Step 4 did not save. |
| *Notion said 404* | Step B2 was missed — the database is not connected to the integration. |
| *Notion said 401* | The token is wrong or was truncated when copied. |
| *that address did not answer like the script does* | The URL is not the `/exec` one, or the code was not pasted or not saved. |

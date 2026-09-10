/**
 * Daily Chapter — the postbox.
 *
 * Lives in Rachel's own Google account. The app posts a day's writing here;
 * this writes it into the Google Sheet and into Notion. The app never holds a
 * password — this does, and only this.
 *
 * Everything is keyed by DATE and overwritten, so the app sending the same day
 * twice leaves one row and one Notion page, not two. That is what makes it safe
 * for the app to retry after a failure.
 *
 * Set up: see SETUP.md next to this file.
 * Settings live in Script Properties, never in this code:
 *   SHEET_ID       required
 *   NOTION_TOKEN   optional — leave it out and Sheets still works
 *   NOTION_DB      required only if NOTION_TOKEN is set
 *   NOTION_SNAG_DB optional - the "what's wrong" list; without it snags still
 *                  land in a Snags tab in the Sheet
 */

/* Bumped whenever this file changes in a way the app must be able to see.
   The app reads it from the test reply, so "I deployed but did not paste" is
   caught instead of looking like a working setup. */
var SCRIPT_VERSION = 2;

var SHEET_NAME = 'Journal';
var NOTION_VERSION = '2022-06-28';

var SNAG_SHEET = 'Snags';
var COLUMNS = ['date', 'reference', 'read', 'verse', 'summary', 'learnt',
               'apply', 'prayer', 'tags', 'versesChosen', 'updated'];
var SNAG_COLUMNS = ['when', 'note', 'where', 'chapter', 'appVersion', 'device'];
var SNAG_HEADINGS = ['When', "What's wrong", 'Where', 'Chapter', 'App version', 'Device'];
var HEADINGS = ['Date', 'Reference', 'Read', 'Key verse', 'My summary',
                'What I learnt', 'How I will use it', 'Prayer', 'Tags',
                'Verses chosen', 'Last edited'];

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var entries = body.entries || [];

    if (body.test) {
      var checks = [];
      checks.push(sheet() ? 'sheet reachable' : 'SHEET NOT REACHABLE');
      checks.push(notionToken() ? 'Notion key present' : 'Notion not set up (Sheets only)');
      checks.push(prop('NOTION_SNAG_DB') ? 'snag list connected' : 'snags go to the Sheet only');
      return reply({ ok: true, wrote: checks.join(', '), script: SCRIPT_VERSION });
    }

    /* Reading BACK out of the Sheet. This is what makes a new phone able to
       get her writing back without her typing any of it again. */
    if (body.kind === 'pull') {
      return reply({ ok: true, kind: 'pull', script: SCRIPT_VERSION,
                     entries: readFromSheet() });
    }

    if (body.kind === 'snag') {
      var notes = body.snags || [];
      for (var n = 0; n < notes.length; n++) {
        appendSnag(notes[n]);
        if (notionToken() && prop('NOTION_SNAG_DB')) snagToNotion(notes[n]);
      }
      return reply({ ok: true, wrote: notes.length });
    }

    var written = 0;
    for (var i = 0; i < entries.length; i++) {
      writeToSheet(entries[i]);
      if (notionToken()) writeToNotion(entries[i]);
      written++;
    }
    return reply({ ok: true, wrote: written });

  } catch (err) {
    // Answer honestly. The app keeps the day and tries again, and because
    // everything is keyed by date, trying again cannot duplicate anything.
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return reply({ ok: true, wrote: 'this is the Daily Chapter postbox; it listens for POSTs' });
}

function reply(object) {
  return ContentService.createTextOutput(JSON.stringify(object))
                       .setMimeType(ContentService.MimeType.JSON);
}

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}
function notionToken() { return prop('NOTION_TOKEN'); }

/* ------------------------------- the sheet ------------------------------ */

function sheet() {
  var id = prop('SHEET_ID');
  if (!id) throw new Error('SHEET_ID is not set in Script Properties');
  var book = SpreadsheetApp.openById(id);
  var tab = book.getSheetByName(SHEET_NAME);
  if (!tab) {
    tab = book.insertSheet(SHEET_NAME);
    tab.appendRow(HEADINGS);
    tab.setFrozenRows(1);
  }
  if (tab.getLastRow() === 0) {
    tab.appendRow(HEADINGS);
    tab.setFrozenRows(1);
  }
  return tab;
}

/* Sheets parses '2026-09-09' into a Date object on the way in. String()ing that
   gives 'Tue Sep 09 2026 ...', whose first ten characters are 'Tue Sep 09' - so
   the old comparison against '2026-09-09' could never match, and every save
   appended a new row instead of replacing the day. Her Journal tab has 17 rows
   for one day because of this. Compare on a real date key. */
function dateKey(value, tab) {
  /* Duck-typed on purpose. `value instanceof Date` is false for a Date made in
     another JavaScript realm, which is how the test harness feeds cells in -
     and it is the check that quietly let this bug through a green test run. */
  if (value && typeof value.getTime === 'function' && !isNaN(value.getTime())) {
    var zone = tab ? tab.getParent().getSpreadsheetTimeZone() : Session.getScriptTimeZone();
    return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  }
  return String(value || '').slice(0, 10);
}

function rowFor(entry) {
  return COLUMNS.map(function (key) {
    var value = entry[key];
    if (key === 'read') return value ? 'yes' : 'no';
    return value === undefined || value === null ? '' : String(value);
  });
}

function writeToSheet(entry) {
  var tab = sheet();
  var last = tab.getLastRow();
  var dates = last > 1 ? tab.getRange(2, 1, last - 1, 1).getValues() : [];
  var row = 0;
  for (var i = 0; i < dates.length; i++) {
    if (dateKey(dates[i][0], tab) === entry.date) { row = i + 2; break; }
  }
  var values = [rowFor(entry)];
  if (row) tab.getRange(row, 1, 1, values[0].length).setValues(values);
  else tab.appendRow(values[0]);
}

/* Every row, newest per date. The duplicate rows already in the Sheet are left
   alone - nothing here deletes her data - but only the latest edit of each day
   is handed back, judged by the Last edited column. */
function readFromSheet() {
  var tab = sheet();
  var last = tab.getLastRow();
  if (last < 2) return [];
  var rows = tab.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  var best = {};
  for (var i = 0; i < rows.length; i++) {
    var out = {};
    for (var c = 0; c < COLUMNS.length; c++) out[COLUMNS[c]] = rows[i][c];
    out.date = dateKey(out.date, tab);
    if (!out.date) continue;
    out.read = String(out.read).toLowerCase() === 'yes';
    out.updated = out.updated instanceof Date ? out.updated.toISOString()
                                              : String(out.updated || '');
    var held = best[out.date];
    if (!held || String(out.updated) >= String(held.updated)) best[out.date] = out;
  }
  return Object.keys(best).sort().map(function (d) { return best[d]; });
}

/* -------------------------------- snags --------------------------------- */

function snagTab() {
  var book = SpreadsheetApp.openById(prop('SHEET_ID'));
  var tab = book.getSheetByName(SNAG_SHEET);
  if (!tab) {
    tab = book.insertSheet(SNAG_SHEET);
    tab.appendRow(SNAG_HEADINGS);
    tab.setFrozenRows(1);
  }
  if (tab.getLastRow() === 0) {
    tab.appendRow(SNAG_HEADINGS);
    tab.setFrozenRows(1);
  }
  return tab;
}

/* Snags are appended, never keyed and overwritten: two different things can be
   wrong on the same day, and the second must not replace the first. */
function appendSnag(note) {
  snagTab().appendRow(SNAG_COLUMNS.map(function (key) {
    return note[key] === undefined || note[key] === null ? '' : String(note[key]);
  }));
}

function snagToNotion(note) {
  notionCall('pages', 'post', {
    parent: { database_id: prop('NOTION_SNAG_DB') },
    properties: {
      "What's wrong": { title: [{ type: 'text', text: { content: String(note.note || '').slice(0, 1900) } }] },
      'When': { date: { start: note.when } },
      'Where': note.where ? { select: { name: note.where } } : { select: null },
      'Status': { select: { name: 'New' } },
      'Chapter': text(note.chapter),
      'Device': text(note.device),
      'App version': text(note.appVersion)
    }
  });
}

/* ------------------------------- notion --------------------------------- */

function notionCall(path, method, payload) {
  var response = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + notionToken(),
      'Notion-Version': NOTION_VERSION
    },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Notion said ' + code + ': ' + text.slice(0, 200));
  }
  return JSON.parse(text);
}

function text(value) {
  var content = String(value === undefined || value === null ? '' : value);
  if (!content) return { rich_text: [] };
  // Notion refuses a single text run longer than 2000 characters.
  var chunks = [];
  for (var i = 0; i < content.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: content.slice(i, i + 1900) } });
  }
  return { rich_text: chunks };
}

function notionProperties(entry) {
  var tags = String(entry.tags || '').split(',')
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t; })
    .map(function (t) { return { name: t }; });

  return {
    'Name': { title: [{ type: 'text', text: { content: entry.date + ' — ' + (entry.reference || '') } }] },
    'Date': { date: { start: entry.date } },
    'Reference': text(entry.reference),
    'Read': { checkbox: !!entry.read },
    'Key verse': text(entry.verse),
    'My summary': text(entry.summary),
    'What I learnt': text(entry.learnt),
    'How I will use it': text(entry.apply),
    'Prayer': text(entry.prayer),
    'Tags': { multi_select: tags },
    'Verses chosen': text(entry.versesChosen)
  };
}

function writeToNotion(entry) {
  var database = prop('NOTION_DB');
  if (!database) throw new Error('NOTION_DB is not set in Script Properties');

  var found = notionCall('databases/' + database + '/query', 'post', {
    filter: { property: 'Date', date: { equals: entry.date } },
    page_size: 1
  });

  if (found.results && found.results.length) {
    notionCall('pages/' + found.results[0].id, 'patch', { properties: notionProperties(entry) });
  } else {
    notionCall('pages', 'post', {
      parent: { database_id: database },
      properties: notionProperties(entry)
    });
  }
}

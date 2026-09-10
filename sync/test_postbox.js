/* Runs the Apps Script's own code against stand-ins for Google's services, so
   the logic is proved before it is installed. Not a substitute for running it
   in Google, but it catches the things that would waste Rachel's time. */
const fs = require('fs');
const vm = require('vm');

let sheetRows = [['Date','Reference','Read','Key verse','My summary','What I learnt',
                  'How I will use it','Prayer','Tags','Verses chosen','Last edited']];
let notionPages = [];       // {id, date, props}
let notionCalls = [];
let props = { SHEET_ID: 'SHEET123', NOTION_TOKEN: 'secret_abc', NOTION_DB: 'DB456' };

/* Sheets hands a date cell back as a Date, not the string that went in. The
   stub did not, which is why the duplicate-row bug lived through a green test
   run. It does now. */
const asStored = r => r.map((v, i) =>
  (i === 0 && typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)) ? new Date(v + 'T00:00:00Z') : v);

const tab = {
  getParent: () => ({ getSpreadsheetTimeZone: () => 'UTC' }),
  getLastRow: () => sheetRows.length,
  appendRow: r => sheetRows.push(r.slice()),
  setFrozenRows: () => {},
  getRange: (row, col, numRows, numCols) => ({
    getValues: () => sheetRows.slice(row - 1, row - 1 + numRows)
      .map(r => asStored(r).slice(col - 1, col - 1 + numCols)),
    setValues: v => { sheetRows[row - 1] = v[0].slice(); },
  }),
};

const sandbox = {
  SpreadsheetApp: { openById: id => {
      if (id !== props.SHEET_ID) throw new Error('wrong sheet id');
      return { getSheetByName: n => (n === 'Journal' ? tab : null), insertSheet: () => tab };
  }},
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: (d, zone, fmt) => d.toISOString().slice(0, 10) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
  ContentService: { MimeType: { JSON: 'json' },
    createTextOutput: t => ({ setMimeType: () => ({ body: t }) }) },
  UrlFetchApp: { fetch: (url, opts) => {
      notionCalls.push(opts.method + ' ' + url.replace('https://api.notion.com/v1/', ''));
      if (opts.headers.Authorization !== 'Bearer ' + props.NOTION_TOKEN) throw new Error('bad token');
      if (opts.headers['Notion-Version'] !== '2022-06-28') throw new Error('bad version header');
      const payload = opts.payload ? JSON.parse(opts.payload) : {};
      if (url.endsWith('/query')) {
        const want = payload.filter.date.equals;
        const hit = notionPages.filter(p => p.date === want);
        return resp(200, { results: hit.map(p => ({ id: p.id })) });
      }
      if (/pages\/.+/.test(url)) {                       // patch
        const id = url.split('pages/')[1];
        const page = notionPages.find(p => p.id === id);
        page.props = payload.properties;
        return resp(200, { id });
      }
      if (url.endsWith('pages')) {                       // create
        const dp = payload.properties['Date'] || payload.properties['When'];
        const date = dp && dp.date ? dp.date.start : null;
        const id = 'page' + (notionPages.length + 1);
        notionPages.push({ id, date, props: payload.properties });
        return resp(200, { id });
      }
      return resp(404, { message: 'no' });
  }},
  console,
};
const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
sandbox.resp = resp;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('/home/user/printables/bible_daily/sync/Code.gs', 'utf8'), sandbox);

const post = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).body);
const say = (k, v) => console.log(k.padEnd(30) + ': ' + v);
const day = (date, over={}) => Object.assign({
  date, reference: '1 Kings 14', read: true, verse: '1 Kings 14:6 — Come in, wife of Jeroboam.',
  summary: 'A king sends his wife in disguise.', learnt: 'You cannot disguise yourself from God.',
  apply: 'Be straight with people.', prayer: 'Make me plain-spoken.',
  tags: 'honesty, courage', versesChosen: '6, 7', updated: '2026-09-08T06:00:00Z' }, over);

say('test ping', JSON.stringify(post({ test: true })));
say('one day accepted', JSON.stringify(post({ entries: [day('2026-09-08')] })));
say('sheet rows (1 header + 1)', sheetRows.length);
say('  the row', JSON.stringify(sheetRows[1].slice(0, 4)));
say('  read written as', sheetRows[1][2]);
say('notion pages', notionPages.length);
say('  notion title', notionPages[0].props['Name'].title[0].text.content);
say('  notion tags', JSON.stringify(notionPages[0].props['Tags'].multi_select.map(t => t.name)));
say('  notion checkbox', notionPages[0].props['Read'].checkbox);

post({ entries: [day('2026-09-08', { summary: 'CHANGED after thinking about it' })] });
say('resend: sheet rows', sheetRows.length + ' (must still be 2)');
say('resend: sheet updated', sheetRows[1][4].slice(0, 24));
say('resend: notion pages', notionPages.length + ' (must still be 1)');
say('resend: notion updated', notionPages[0].props['My summary'].rich_text[0].text.content.slice(0, 24));

post({ entries: [day('2026-09-09', { reference: '1 Kings 15' })] });
say('second day', sheetRows.length + ' rows, ' + notionPages.length + ' notion pages');

const long = 'x'.repeat(4300);
post({ entries: [day('2026-09-10', { summary: long })] });
const runs = notionPages[2].props['My summary'].rich_text;
say('long answer split', runs.length + ' chunks, longest ' + Math.max(...runs.map(r => r.text.content.length)) + ' chars');
say('  nothing lost', runs.map(r => r.text.content).join('').length === long.length ? 'yes' : 'NO');

props.NOTION_TOKEN = null; notionCalls = [];
say('no Notion key: still works', JSON.stringify(post({ entries: [day('2026-09-11')] })));
say('  notion untouched', notionCalls.length === 0 ? 'yes, Sheets only' : 'NO');
say('  sheet still grew', sheetRows.length + ' rows');
props.NOTION_TOKEN = 'secret_abc';

props.SHEET_ID = null;
const bad = post({ entries: [day('2026-09-12')] });
say('no SHEET_ID: honest error', JSON.stringify(bad));
props.SHEET_ID='SHEET123';

console.log('');
console.log('--- snags ---');
props.NOTION_SNAG_DB='SNAGDB';
let snagRows=[]; const snagTab={getLastRow:()=>snagRows.length,appendRow:r=>snagRows.push(r.slice()),
  setFrozenRows:()=>{},getRange:()=>({getValues:()=>[],setValues:()=>{}})};
sandbox.SpreadsheetApp.openById=id=>({getSheetByName:n=>(n==='Snags'?snagTab:tab),insertSheet:n=>(n==='Snags'?snagTab:tab)});
const snag=(note,where)=>({note,where,when:'2026-09-08',chapter:'1 Kings 14',appVersion:'v11',device:'iPhone'});
say('two snags accepted', JSON.stringify(post({kind:'snag',snags:[snag('Listen stops halfway','Chapter text'),
                                                                  snag('Journal text too small','Journal')]})));
say('  sheet rows', snagRows.length+' (1 header + 2)');
say('  first row', JSON.stringify(snagRows[1]).slice(0,74));
say('  notion pages', notionPages.length);
const np=notionPages[notionPages.length-1];
say('  notion title', np.props["What's wrong"].title[0].text.content);
say('  notion where', np.props['Where'].select.name);
say('  notion status', np.props['Status'].select.name);
post({kind:'snag',snags:[snag('Listen stops halfway','Chapter text')]});
say('same day twice', snagRows.length+' rows - snags append, they do not overwrite');
props.NOTION_SNAG_DB=null; notionCalls=[];
say('no snag db set', JSON.stringify(post({kind:'snag',snags:[snag('Another thing','Other')]})));
say('  notion untouched', notionCalls.length===0?'yes, Sheet only':'NO');
say('  sheet still grew', snagRows.length+' rows');
say('journal still works', JSON.stringify(post({entries:[day('2026-09-20')]})));
say('  app will retry', bad.ok === false ? 'yes (ok:false)' : 'NO');

/* ---- the duplicate-row bug, and reading back out ---------------------- */
console.log('');
console.log('--- one day saved three times, then pulled back ---');
sheetRows.length = 1;
['first go', 'second go', 'the one that should survive'].forEach((txt, i) => {
  post({ entries: [{ date: '2026-09-09', reference: '1 Kings 14', read: true,
    verse: 'v31', summary: txt, learnt: '', apply: '', prayer: '', tags: '',
    versesChosen: '31, 32', updated: '2026-09-09T0' + i + ':00:00.000Z' }] });
});
say('rows in the Journal', sheetRows.length - 1 + ' (one day, so it must be 1)');
say('  the surviving text', JSON.stringify(sheetRows[1][4]));

const pulled = post({ kind: 'pull' });
say('pull answers', 'kind=' + pulled.kind + ' script=' + pulled.script + ' entries=' + pulled.entries.length);
const one = pulled.entries[0];
say('  date comes back', JSON.stringify(one.date) + ' (a string, not a Date)');
say('  read comes back', JSON.stringify(one.read) + ' (a real true/false)');
say('  summary', JSON.stringify(one.summary));
say('  verses chosen', JSON.stringify(one.versesChosen));

console.log('');
console.log('--- and duplicates already sitting in her Sheet ---');
sheetRows.length = 1;
sheetRows.push(['2026-09-09','Matthew 1','no','','older','', '', '', '', '', '2026-09-09T00:02:43.492Z']);
sheetRows.push(['2026-09-09','Matthew 1','yes','','newer','', '', '', '', '', '2026-09-09T00:51:28.234Z']);
sheetRows.push(['2026-09-08','1 Kings 13','yes','','a different day','', '', '', '', '', '2026-09-08T10:00:00.000Z']);
const dedup = post({ kind: 'pull' }).entries;
say('3 rows, 2 dates -> got', dedup.length + ' entries');
say('  newest of the pair kept', JSON.stringify(dedup.find(e => e.date === '2026-09-09').summary));
say('  nothing deleted', sheetRows.length - 1 + ' rows still in the Sheet');

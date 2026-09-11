/* Drives the real app in a real browser, at phone width, against stand-ins for
   the two services it talks to. This is the half `check_bible_app.py` cannot do:
   the gate reads the file, this one uses the app.
 *
 * Everything asserted here was a bug that shipped, or nearly did:
 *   - the floating bar wrapped into three rows because a fixed element at
 *     left:50% is only offered half the viewport to size itself in
 *   - the listen button turned into the word "reading" when she asked for icons
 *   - a new phone showed an empty journal because nothing read the Sheet back
 *   - an old deployment answered {ok:true} to a word it did not understand
 *   - the NLT request size ignored her key
 *
 * Needs Playwright, which is not vendored here:
 *   npm i playwright          (the browser is already at /opt/pw-browsers)
 *   node drive_app.js         (starts its own server on 8931)
 */
let chromium;
try { chromium = require('playwright').chromium; }
catch (err) {
  console.error('Playwright is not installed here. Run:  npm i playwright');
  console.error('The browser itself is already on disk at /opt/pw-browsers - do not');
  console.error('run "playwright install", and do not let npm re-download it.');
  process.exit(2);
}
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8931;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HERE = __dirname;

let fails = 0, checks = 0;
function ok(name, pass, detail){
  checks++;
  if (!pass) fails++;
  console.log((pass ? '  ok   ' : '  FAIL ') + name.padEnd(42) + (detail === undefined ? '' : detail));
}

/* A stand-in NLT service that refuses an over-limit ask the way Tyndale does. */
function nltHtml(from, to, total){
  let out = '<div id="bibletext"><div class="bible"><p class="body">';
  for (let v = from; v <= Math.min(to, total); v++)
    out += '<span class="vn">' + v + '</span> verse ' + v + ' text. ';
  return out + '</p></div></div>';
}

const SHEET = [
  { date:'2026-09-07', reference:'1 Kings 12', read:true, verse:'v28', summary:'Two calves.',
    learnt:'Fear makes shortcuts.', apply:'', prayer:'', tags:'kings, fear',
    versesChosen:'28, 29', updated:'2026-09-07T09:00:00.000Z' },
  { date:'2026-09-08', reference:'1 Kings 13', read:true, verse:'v31', summary:'Bury me beside him.',
    learnt:'', apply:'', prayer:'', tags:'', versesChosen:'31, 32',
    updated:'2026-09-08T09:00:00.000Z' }
];

function serve(){
  return new Promise(resolve => {
    const types = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                    '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
    const server = http.createServer((req, res) => {
      const file = path.join(HERE, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if (!file.startsWith(HERE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
      res.end(fs.readFileSync(file));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/* One context, wired to the fakes. `opts.key` seeds the NLT key BEFORE first
   load - set it afterwards and it is the startup fetch that gets measured. */
async function open(browser, opts){
  opts = opts || {};
  const ctx = await browser.newContext({ viewport:{ width: opts.width || 360, height: 780 } });
  const state = { asks: [], posts: [] };

  await ctx.addInitScript(seed => {
    localStorage.setItem('bibleDaily.v1.settings', JSON.stringify({
      plan:'whole', start:'2026-09-11', pointedAt:null, translation:'NLT',
      nltKey: seed.key, notes:false, syncUrl: seed.syncUrl, lastSync:null,
      font:'system', size:19
    }));
  }, { key: opts.key || '', syncUrl: opts.syncUrl || '' });

  await ctx.route('**://api.nlt.to/**', route => {
    const u = new URL(route.request().url());
    const key = u.searchParams.get('key') || '';
    const m = (u.searchParams.get('ref') || '').match(/\.(\d+)-(\d+)$/) || [];
    const from = +m[1], to = +m[2], size = to - from + 1;
    state.asks.push({ from, to, size, key });
    const cap = (key && key !== 'TEST') ? 500 : 50;
    if (size > cap) return route.fulfill({ status:400, contentType:'text/plain',
      body:'REFUSED: asked ' + size + ', cap ' + cap });
    return route.fulfill({ status:200, contentType:'text/html',
      body: nltHtml(from, to, opts.chapterVerses || 29) });
  });

  await ctx.route('**://script.google.com/**', route => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.posts.push(body);
    let reply;
    if (body.kind === 'pull'){
      /* opts.oldScript reproduces a deployment that does not know "pull" and
         says ok anyway - the trap that once ate one of her notes. */
      reply = opts.oldScript ? { ok:true, wrote:0 }
                             : { ok:true, kind:'pull', script:2, entries: SHEET };
    } else if (body.test){
      reply = { ok:true, wrote:'sheet reachable', script:2 };
    } else {
      reply = { ok:true, wrote: (body.entries || body.snags || []).length };
    }
    return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(reply) });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { state.said = d.message(); await d.accept(); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil:'networkidle' });
  await page.waitForSelector('#passage .verses .vn');
  return { ctx, page, state, errors };
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, args:['--no-sandbox'] });

  /* ---- 1. the phone layout ------------------------------------------- */
  console.log('\nthe floating bar and the screen, at 360px');
  {
    const { ctx, page, errors } = await open(browser, {});
    const bar = await page.evaluate(() => {
      const f = document.getElementById('fab'); const r = f.getBoundingClientRect();
      return { width: Math.round(r.width), offCentre: Math.round((r.left + r.right) / 2 - innerWidth / 2),
               buttons: [...f.querySelectorAll('button')].map(b => b.textContent.trim()) };
    });
    ok('bar fits the screen', bar.width <= 344, bar.width + 'px');
    ok('bar is centred', Math.abs(bar.offCentre) <= 1, 'off by ' + bar.offCentre);
    ok('four arrows present', ['⌃','‹','›','⌄'].every(a => bar.buttons.includes(a)),
       bar.buttons.join(' '));
    ok('tabs live in the bar, not the top',
       await page.evaluate(() => !document.querySelector('.wrap > nav') && !!document.querySelector('#fab nav')));
    ok('page never scrolls sideways',
       await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    const before = await page.evaluate(() => scrollY);
    await page.click('#fabDown'); await page.waitForTimeout(700);
    const after = await page.evaluate(() => scrollY);
    ok('down arrow moves the page', after > before, before + ' -> ' + after);
    await page.click('#fabUp'); await page.waitForTimeout(700);
    ok('up arrow comes back', await page.evaluate(() => scrollY) < after);

    /* she asked for icons; it used to become the word "reading" */
    await page.evaluate(() => showPlayer(true));
    const reading = await page.evaluate(() => document.getElementById('listenBtn').textContent.trim());
    await page.evaluate(() => showPlayer(false));
    const idle = await page.evaluate(() => document.getElementById('listenBtn').textContent.trim());
    ok('listen stays an icon', !/[a-z]/i.test(reading + idle), JSON.stringify(reading + ' / ' + idle));

    await page.click('#snagBtn'); await page.waitForTimeout(400);
    const snag = await page.evaluate(() => {
      const r = document.getElementById('snagPanel').getBoundingClientRect();
      return { share: Math.round(100 * r.width * r.height / (innerWidth * innerHeight)),
               offCentre: Math.round((r.top + r.bottom) / 2 - innerHeight / 2) };
    });
    ok("what's-wrong box is small", snag.share <= 26, snag.share + '% of the screen');
    ok("what's-wrong box is centred", Math.abs(snag.offCentre) <= 8, 'off by ' + snag.offCentre);
    ok('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  /* ---- 2. a new device getting her writing back ---------------------- */
  console.log('\na new phone with an address but no writing');
  {
    const { ctx, page, errors } = await open(browser, { syncUrl:'https://script.google.com/macros/s/X/exec' });
    await page.evaluate(() => pullFromSheet(false));
    await page.waitForTimeout(600);
    const days = await page.evaluate(() => Object.keys(entries).sort());
    ok('days came back from the Sheet', days.length === 2, days.join(', '));
    const one = await page.evaluate(() => entries['2026-09-07']);
    ok('reference restored', one && one.ref === '1 Kings 12', one && one.ref);
    ok('writing restored', one && one.learnt === 'Fear makes shortcuts.');
    ok('tags restored as a list', one && Array.isArray(one.tags) && one.tags.length === 2,
       JSON.stringify(one && one.tags));
    ok('chosen verses restored', one && one.verses.join(',') === '28,29', JSON.stringify(one && one.verses));
    ok('read flag is a real boolean', one && one.done === true);
    ok('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log('\nnewer writing on THIS device must survive the pull');
  {
    const { ctx, page } = await open(browser, { syncUrl:'https://script.google.com/macros/s/X/exec' });
    await page.evaluate(() => {
      entries['2026-09-07'] = { date:'2026-09-07', ref:'1 Kings 12', plan:settings.plan, done:true,
        verse:'', summary:'MINE, newer', learnt:'', apply:'', prayer:'', tags:[], verses:[],
        quote:'', created:null, updated:'2026-09-30T00:00:00.000Z' };
      jset('entries', entries);
    });
    await page.evaluate(() => pullFromSheet(false));
    await page.waitForTimeout(600);
    ok('my newer day was not overwritten',
       await page.evaluate(() => entries['2026-09-07'].summary) === 'MINE, newer');
    ok('the other day still arrived', await page.evaluate(() => !!entries['2026-09-08']));
    await ctx.close();
  }

  console.log('\nan OLD deployment must say so, not look like an empty journal');
  {
    const { ctx, page, state } = await open(browser,
      { syncUrl:'https://script.google.com/macros/s/X/exec', oldScript:true });
    await page.evaluate(() => pullFromSheet(true));
    await page.waitForTimeout(600);
    ok('she is told the code is old', /old code/i.test(state.said || ''), (state.said || 'SAID NOTHING').split('\n')[0]);
    ok('and told how to fix it', /New version/.test(state.said || ''));
    ok('nothing invented into the journal', await page.evaluate(() => Object.keys(entries).length) === 0);
    await ctx.close();
  }

  /* ---- 3. her NLT key changes the request size ----------------------- */
  console.log('\nPsalm 119 (176 verses): the key decides the request size');
  for (const [label, key, wantAsks, wantSize] of [
    ['no key', '', 4, 50], ['with a key', 'herkey', 1, 500]
  ]){
    const { ctx, page, state } = await open(browser, { key, chapterVerses:176 });
    state.asks.length = 0;                        // ignore the startup chapter
    await page.evaluate(() => jumpTo('Psalms 119'));
    await page.waitForTimeout(2200);
    ok(label + ': requests', state.asks.length === wantAsks, state.asks.length + ' (want ' + wantAsks + ')');
    ok(label + ': verses per request', state.asks.every(a => a.size === wantSize),
       state.asks.map(a => a.size).join(', '));
    ok(label + ': all 176 verses shown',
       await page.evaluate(() => document.querySelectorAll('#passage .verses .vn').length) === 176);
    ok(label + ': nothing refused', !state.asks.some(a => a.size > (key ? 500 : 50)));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + (fails ? fails + ' OF ' + checks + ' CHECKS FAILED' : 'ALL ' + checks + ' CHECKS HELD'));
  console.log('This says the app behaves. It does not say it is pleasant - look at it.\n');
  process.exit(fails ? 1 : 0);
})();

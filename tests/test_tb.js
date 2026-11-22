// Tankebænken folded into Overblik: journal, reading and ideas against a mocked tankebaenken-data repo in the old
// app's format. Made-up entries. Run: node tests/test_tb.js        (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST', tbRepo: 'tankebaenken-data' };
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TEMPLATE = { version: 1, anchor_a_monday: '2026-01-05', events: [
  { name: 'Tankebænken', kind: 'quiet', source: 'Læsning', days: ALL, start: '20:40', end: '21:30' } ] };
const STATE = { version: 1, appVersion: '1.1.1', stones: [], quarry: [
  { id: 'q-0016', createdAt: '2026-01-02T09:00:00.000Z', updatedAt: '2026-01-02T09:00:00.000Z', text: 'An old idea', source: 'At the office', parentStoneId: null, status: 'open', benchedAsStoneId: null } ],
  books: [ { id: 'b-0006', title: 'Kongens fald', author: 'J. V. Jensen', kind: 'easy', status: 'reading', earnedBy: null, addedAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z' } ],
  readingLog: [ { id: 'r-0001', date: '2026-01-03', bookId: 'b-0006', minutes: 25 }, { id: 'r-0000', date: '2025-12-31', bookId: 'b-0006', minutes: 20 } ],
  counters: { stone: 2, quarry: 16, book: 6, reading: 1, journal: 7 }, settings: { weeklyReadingTarget: 2 }, backup: {} };
const JOURNAL = '# January 2026\n\n## 2026-01-04 21:10 · j-0007\n\nWritten on the Mac, by hand.\n';

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };
  // practice.json as written in December: the app now loads only January's journal, so 31 Dec's journal count must stay.
  const PRACTICE = { updated: '2025-12-31T22:00:00.000Z', days: { '2025-12-31': { journal: 2, reading_min: 20, reading_sessions: 1, ideas: 0 } } };
  const repos = { 'overblik-data': { 'template.json': JSON.stringify(TEMPLATE), 'practice.json': JSON.stringify(PRACTICE) }, 'tankebaenken-data': { 'state.json': JSON.stringify(STATE), 'journal/2026-01.md': JOURNAL } };
  let n = 0; const puts = [];
  const handler = async route => {
    const req = route.request(); const u = new URL(req.url()); const repo = u.pathname.split('/')[3]; const p = u.pathname.split('/contents/')[1];
    const store = repos[repo] || {}; const sha = k => 'sha-' + repo + '-' + k + '-' + (store['_v' + k] || 0);
    if (req.method() === 'GET') {
      if (store[p] === undefined) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: sha(p), content: Buffer.from(store[p]).toString('base64') }) });
    }
    const body = JSON.parse(req.postData());
    if (store[p] !== undefined && body.sha !== sha(p)) return route.fulfill({ status: 409, body: '{}' });
    store[p] = Buffer.from(body.content, 'base64').toString('utf8'); store['_v' + p] = (store['_v' + p] || 0) + 1; puts.push(repo + ':' + p + ': ' + body.message);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: sha(p) } }) });
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 1400 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await require('./_all_pages')(ctx);
  await ctx.clock.install({ time: new Date('2026-01-06T20:45:00+01:00') });
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  const idle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !tbBusy && !/syncing/.test(document.getElementById('status').textContent), null, { timeout: 5000 }); };
  await page.reload(); await idle();
  const state = () => JSON.parse(repos['tankebaenken-data']['state.json']);

  await check('the evening Tankebænken row offers journal, read or an idea', async () => {
    const b = await page.$$eval('#tl [data-tbgo]', els => els.map(e => e.textContent));
    assert.deepStrictEqual(b, ['Journal', 'Read', 'Work an idea']);
    await page.click('#tl [data-tbgo="read"]');
    assert.strictEqual(await page.$eval('#tb-read', e => e.hidden), false);
    await page.click('#tl [data-tbgo="journal"]');
  });
  await check('this month\'s journal is read from the file, hand-written entries included', async () => {
    assert.match(await page.textContent('#tb-j-list'), /Written on the Mac, by hand\./);
  });
  await page.fill('#tb-j-text', 'A thought about roles.'); await page.fill('#tb-j-where', 'couch'); await page.click('#tb-j-save'); await idle();
  await check('a journal entry is appended in the old format, numbered after the highest id in the file', async () => {
    assert.strictEqual(repos['tankebaenken-data']['journal/2026-01.md'], JOURNAL + '\n## 2026-01-06 20:45 · j-0008\n\n*couch*\n\nA thought about roles.\n');
    assert.strictEqual(state().counters.journal, 8);
  });
  await page.fill('#cap', 'Why do roles feel heavier at work?'); await page.click('.chip.idea'); await page.press('#cap', 'Enter'); await idle();
  await check('the Idé chip puts an idea in the quarry, not a to-do in the inbox', async () => {
    const q = state().quarry.find(x => x.text === 'Why do roles feel heavier at work?');
    assert.ok(q, 'in state.json'); assert.strictEqual(q.id, 'q-0017'); assert.strictEqual(q.status, 'open');
    assert.ok(state().quarry.find(x => x.id === 'q-0016'), 'the old idea stays');
    const inbox = repos['overblik-data']['inbox.json'];
    assert.ok(!inbox || !inbox.includes('heavier'), 'not in the inbox');
  });
  await page.click('.tb-tabs [data-tb="read"]');
  await page.click('.tb-add summary');
  await page.fill('#tb-b-title', 'Asylums'); await page.fill('#tb-b-author', 'Goffman'); await page.selectOption('#tb-b-status', 'reading'); await page.click('#tb-b-add');
  await page.selectOption('#tb-r-book', { label: 'Asylums (reading)' }); await page.click('.tb-mins [data-min="25"]'); await idle();
  await check('a new book and a session on it in one sync: the book gets its id and the log follows it', async () => {
    const b = state().books.find(x => x.title === 'Asylums');
    assert.strictEqual(b.id, 'b-0007'); assert.strictEqual(b.owned, true); assert.strictEqual(b.kind, 'thinking');
    const r = state().readingLog.find(x => x.minutes === 25 && x.date === '2026-01-06');
    assert.strictEqual(r.bookId, 'b-0007'); assert.strictEqual(r.id, 'r-0002');
    assert.deepStrictEqual(state().counters, { stone: 2, quarry: 17, book: 7, reading: 2, journal: 8 });
  });
  await page.selectOption('#tb-r-book', { label: 'Kongens fald (reading)' }); await page.click('.tb-mins [data-min="45"]'); await idle();
  await check('fiction is logged too (his call, 21 Nov)', async () => {
    assert.ok(state().readingLog.find(x => x.bookId === 'b-0006' && x.minutes === 45));
    assert.match(await page.textContent('#tb-count'), /this week: 1 journal · 70 min read/);
  });
  await page.click('.tb-tabs [data-tb="journal"]'); await page.click('[data-tbpromote="j-0008"]'); await idle();
  await check('a journal entry becomes an idea with one tap, linked to its entry', async () => {
    const q = state().quarry.find(x => x.fromJournal === 'j-0008');
    assert.ok(q); assert.strictEqual(q.text, 'A thought about roles.');
    assert.ok(!(await page.$('[data-tbpromote="j-0008"]')), 'and the button goes');
  });
  await page.click('.tb-tabs [data-tb="ideas"]');
  await check('an idea opens a mentoring conversation with Claude, prompt included', async () => {
    const href = await page.getAttribute('#tb-i-list li:first-child a', 'href');
    assert.ok(href.startsWith('https://claude.ai/new?q='));
    assert.match(decodeURIComponent(href), /Be my mentor/);
  });
  await page.click('[data-tbidea="q-0016"][data-st="kept"]'); await idle();
  await check('keep for later and worked change the idea\'s status in state.json', async () => {
    assert.strictEqual(state().quarry.find(x => x.id === 'q-0016').status, 'kept');
  });
  await check('practice.json in the hub counts the week, no text', async () => {
    const d = JSON.parse(repos['overblik-data']['practice.json']).days;
    assert.deepStrictEqual(d['2026-01-06'], { journal: 1, reading_min: 70, reading_sessions: 2, ideas: 2, news_min: 0 });
    assert.ok(!repos['overblik-data']['practice.json'].includes('roles'));
  });
  await check('a day in an earlier month keeps its journal count when this month is recounted', async () => {
    const d = JSON.parse(repos['overblik-data']['practice.json']).days;
    assert.deepStrictEqual(d['2025-12-31'], { journal: 2, reading_min: 20, reading_sessions: 1, ideas: 0, news_min: 0 });
    assert.strictEqual(d['2026-01-04'].journal, 1);
  });
  const GR = 'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Bookshelves,Exclusive Shelf\n'
    + '1,"Ulysses",James Joyce,"Joyce, James",,"=""123""","=""9780""",0,"to-read, kat",to-read\n'
    + '2,"Kongens fald",Johannes V. Jensen,"Jensen, Johannes V.",,,,0,"kat",read\n'
    + '3,"The Plague",Albert Camus,"Camus, Albert",,,,0,"read, kat",read\n'
    + '4,"Kindred",Octavia E. Butler,"Butler, Octavia E.",,,,0,"",read\n'
    + '5,"A Book I Do Not Own",Someone Else,,,,,0,"to-read",to-read\n'
    + '6,"Satantango (Apocalypse Quartet, #1)",László Krasznahorkai,,,,,0,"kat, to-read",currently-reading\n'
    + '7,"Din foranderlige bevidsthed: Den nye videnskab",Michael Pollan,,,,,0,"",read\n';
  const EXTRA = 'Title,Author,Bookshelves,Exclusive Shelf,Kind,Note\nKindred,Octavia E. Butler,kat,to-read,easy,in Goodreads without kat\nRegensens visebog,,kat,to-read,easy,\nEl Señor de los Anillos: Las dos torres,J.R.R. Tolkien,kat,to-read,easy,\nEl Señor de los Anillos: El retorno del rey,J.R.R. Tolkien,kat,to-read,easy,\nDin foranderlige bevidsthed,Michael Pollan,kat,to-read,thinking,\n';
  await page.click('.tb-tabs [data-tb="read"]');
  await page.click('text=Import from Goodreads');
  await page.setInputFiles('#tb-imp', [{ name: 'goodreads.csv', mimeType: 'text/csv', buffer: Buffer.from(GR) }, { name: 'extra.csv', mimeType: 'text/csv', buffer: Buffer.from(EXTRA) }]);
  await page.click('#tb-imp-go'); await page.waitForFunction(() => !/Syncing/.test(document.getElementById('tb-imp-msg').textContent), null, { timeout: 5000 }); await idle();
  await check('Goodreads import: owned books only, status from Goodreads, no duplicates, the extra list too', async () => {
    const b = state().books, t = x => b.find(y => y.title === x);
    assert.match(await page.textContent('#tb-imp-msg'), /^8 books added, 1 marked as owned, 0 already there\.$/);
    assert.strictEqual(t('Ulysses').status, 'shelf'); assert.strictEqual(t('Ulysses').owned, true); assert.strictEqual(t('Ulysses').goodreads, '1');
    assert.strictEqual(t('The Plague').status, 'done');
    assert.strictEqual(t('Satantango').status, 'reading', 'the series suffix goes, currently-reading is reading');
    assert.strictEqual(t('Kindred').status, 'done', 'in the extra list as owned, the status still comes from Goodreads');
    assert.strictEqual(t('Kindred').kind, 'easy');
    assert.ok(t('Regensens visebog'), 'a book with no author');
    assert.ok(t('El Señor de los Anillos: Las dos torres') && t('El Señor de los Anillos: El retorno del rey'), 'two volumes with the same series title stay two books');
    assert.strictEqual(t('Din foranderlige bevidsthed').status, 'done', 'a short title finds its Goodreads row with a subtitle');
    assert.ok(!t('A Book I Do Not Own'), 'not on the shelf kat: not in the library');
    assert.strictEqual(b.filter(x => x.title === 'Kongens fald').length, 1, 'already in the library: marked owned, not added again');
    assert.strictEqual(t('Kongens fald').owned, true);
  });
  await page.click('[data-tbbook="b-0006"][data-f="kind"]'); await idle();
  await check('a book\'s kind and status change with a tap', async () => {
    assert.strictEqual(state().books.find(x => x.id === 'b-0006').kind, 'thinking');
  });
  await page.fill('#tb-lib-q', 'kongens');
  await check('the library is searchable by title or author', async () => {
    const hits = await page.$$eval('#tb-lib li > span:first-child', els => els.map(e => e.textContent));
    assert.deepStrictEqual(hits, ['Kongens fald J. V. Jensen']);
  });
  await page.selectOption('select[data-tbstatus="b-0006"]', 'done'); await idle();
  await check('status is a plain choice per book: on the shelf, reading, read', async () => {
    assert.strictEqual(state().books.find(x => x.id === 'b-0006').status, 'done');
    const groups = await page.$$eval('#tb-r-book optgroup', els => els.map(e => e.label));
    assert.deepStrictEqual(groups, ['Reading now', 'On the shelf', 'Read'], 'every book can be picked to log, read ones too');
  });
  await page.fill('#tb-lib-q', '');
  const again = puts.length;
  await page.click('#tb-imp-go'); await page.waitForFunction(() => !/Syncing/.test(document.getElementById('tb-imp-msg').textContent), null, { timeout: 5000 }); await idle();
  await check('importing the same files again adds nothing', async () => {
    assert.match(await page.textContent('#tb-imp-msg'), /^0 books added, 0 marked as owned, 9 already there\.$/);
  });
  delete repos['tankebaenken-data']['state.json']; const before = puts.length;
  await page.click('.tb-tabs [data-tb="ideas"]');
  await page.click('[data-tbidea="q-0017"][data-st="worked"]'); await idle();
  await check('a state.json that cannot be read is never created or overwritten', async () => {
    assert.strictEqual(repos['tankebaenken-data']['state.json'], undefined);
    assert.ok(!puts.slice(before).some(p => p.includes('state.json')));
    assert.match(await page.textContent('#tb-src'), /waiting to sync/);
  });
  // A new month: the first entry creates February's file; January's days keep their journal counts.
  await ctx.clock.setSystemTime(new Date('2026-02-01T20:45:00+01:00'));
  await page.click('.tb-tabs [data-tb="journal"]');
  await page.fill('#tb-j-text', 'First of the month.'); await page.click('#tb-j-save'); await idle();
  await check('the first entry of a new month starts its file and counts there, the old month keeps its counts', async () => {
    assert.match(repos['tankebaenken-data']['journal/2026-02.md'], /^# 2026-02\n\n## 2026-02-01 20:45 · j-0009\n/);
    const d = JSON.parse(repos['overblik-data']['practice.json']).days;
    assert.strictEqual(d['2026-02-01'].journal, 1);
    assert.strictEqual(d['2026-01-06'].journal, 1); assert.strictEqual(d['2026-01-04'].journal, 1);
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  if (process.env.SHOT) { await page.click('.tb-tabs [data-tb="read"]'); await (await page.$('#tb-sec')).screenshot({ path: process.env.SHOT }); }
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

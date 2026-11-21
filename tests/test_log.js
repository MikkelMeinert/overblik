// Block-by-block logging on Today. Playwright against a mocked GitHub Contents API, made-up template and items.
// Run: node tests/test_log.js        (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST' };
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TEMPLATE = { version: 1, anchor_a_monday: '2026-01-05', events: [
  { name: 'Wake', kind: 'body', source: 'Cal', days: ALL, start: '06:00', end: '06:30' },
  { name: 'Desk', kind: 'work', source: 'office', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' },
  { name: 'Praktisk', kind: 'block', block: 'praktisk', source: 'Cal', days: ['tue'], start: '18:00', end: '18:30' },
] };
const INBOX = { version: 1, items: [
  { id: 'a', text: 'Call the bank (10m)', block: 'praktisk', created: '2026-01-01', updated: '2026-01-01T08:00:00Z', done: null },
  { id: 'b', text: 'Pay the bill (10m)', block: 'praktisk', created: '2026-01-02', updated: '2026-01-02T08:00:00Z', done: null },
  { id: 'c', text: 'Book a table (10m)', block: 'praktisk', created: '2026-01-03', updated: '2026-01-03T08:00:00Z', done: null },
  { id: 'd', text: 'Sort the papers (20m)', block: 'praktisk', created: '2026-01-04', updated: '2026-01-04T08:00:00Z', done: null },
] };

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };
  const repo = {}; let n = 0; const puts = [];
  const put = (p, o) => { repo[p] = { sha: 's' + (++n), text: JSON.stringify(o) }; };
  put('template.json', TEMPLATE); put('inbox.json', INBOX);
  const handler = async route => {
    const req = route.request(); const p = new URL(req.url()).pathname.split('/contents/')[1];
    if (req.method() === 'GET') {
      if (!repo[p]) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: repo[p].sha, content: Buffer.from(repo[p].text).toString('base64') }) });
    }
    const body = JSON.parse(req.postData());
    if (repo[p] && body.sha !== repo[p].sha) return route.fulfill({ status: 409, body: '{}' });
    repo[p] = { sha: 's' + (++n), text: Buffer.from(body.content, 'base64').toString('utf8') }; puts.push(p);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: repo[p].sha } }) });
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 1200 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await ctx.clock.install({ time: new Date('2026-01-06T12:00:00+01:00') });   // a Tuesday, noon
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  const synced = () => page.waitForFunction(() => /^synced/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  const settle = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => !/syncing/.test(document.getElementById('status').textContent), null, { timeout: 5000 }); };
  await page.reload(); await synced();
  const log = () => JSON.parse(repo['log.json'].text).days['2026-01-06'];
  const rowButtons = name => page.$$eval('#tl li', (lis, name) => { const li = lis.find(l => l.querySelector('.name').textContent.startsWith(name)); return li ? [...li.querySelectorAll('[data-log]')].map(b => b.textContent) : null; }, name);

  await check('only blocks that have started can be logged', async () => {
    assert.deepStrictEqual(await rowButtons('Wake'), ['Done', 'Partly', 'Skipped']);
    assert.deepStrictEqual(await rowButtons('Desk'), ['Done', 'Partly', 'Skipped'], 'the block under way too');
    assert.deepStrictEqual(await rowButtons('Praktisk'), [], 'not before it starts');
  });
  await page.click('#tl [data-log$="06:00|Wake"][data-st="skipped"]'); await settle();
  await check('one tap writes the block to log.json', async () => {
    const e = log()['06:00|Wake'];
    assert.strictEqual(e.status, 'skipped'); assert.strictEqual(e.end, '06:30'); assert.ok(e.at);
    assert.ok(await page.$('#tl input[data-lognote$="06:00|Wake"]'), 'a note field appears once it is logged');
  });
  await page.fill('#tl input[data-lognote$="06:00|Wake"]', 'slept in');
  await page.click('#cap'); await settle();
  await check('the optional note is saved when he leaves the field', async () => {
    assert.strictEqual(log()['06:00|Wake'].note, 'slept in');
    assert.strictEqual(await page.inputValue('#tl input[data-lognote$="06:00|Wake"]'), 'slept in');
  });
  await check('once logged only the choice shows', async () => {
    assert.deepStrictEqual(await rowButtons('Wake'), ['Skipped']);
  });
  await page.click('#tl [data-log$="06:00|Wake"][data-st="skipped"]'); await settle();
  await check('the same tap again clears it', async () => {
    assert.strictEqual(log()['06:00|Wake'].status, null);
    assert.deepStrictEqual(await rowButtons('Wake'), ['Done', 'Partly', 'Skipped'], 'and the three are back');
  });
  await page.click('#tl [data-log$="06:00|Wake"][data-st="done"]'); await settle();

  await page.clock.setSystemTime(new Date('2026-01-06T18:10:00+01:00'));
  await page.reload(); await synced();
  await check('an agenda block shows its items, oldest first, as many as fit', async () => {
    const txt = await page.$$eval('#tl .items .txt', els => els.map(e => e.textContent));
    assert.deepStrictEqual(txt, ['Call the bank', 'Pay the bill', 'Book a table'], '30 minutes hold three 10-minute items');
    assert.deepStrictEqual(await rowButtons('Praktisk'), ['Skipped'], 'item by item, plus a skip for the whole block');
  });
  await page.click('#tl .items button.box[data-id="a"]'); await settle();
  await check('ticking an item logs the block as partly, with counts', async () => {
    const e = log()['18:00|Praktisk'];
    assert.strictEqual(e.status, 'partly'); assert.deepStrictEqual(e.items, { done: 1, planned: 3 }, 'the done item keeps its 10 minutes: three items fill the 30');
    assert.ok(JSON.parse(repo['inbox.json'].text).items.find(i => i.id === 'a').done, 'the item itself is done in the inbox');
    assert.match(await page.textContent('#tl .lg .st'), /1 of 3 done; the rest moves on/);
  });
  await page.click('#tl .items button.box[data-id="b"]'); await page.click('#tl .items button.box[data-id="c"]'); await settle();
  await check('all items done is a done block; what did not fit waits for the next block', async () => {
    assert.ok(!(await page.$('#tl .items button.box[data-id="d"]')), 'the 20-minute item does not fit after three');
    assert.strictEqual(log()['18:00|Praktisk'].status, 'done');
    assert.strictEqual(log()['06:00|Wake'].status, 'done', 'earlier rows are kept');
  });
  await check('another device keeps its own taps (merge per row)', async () => {
    const cur = JSON.parse(repo['log.json'].text); cur.days['2026-01-06']['09:00|Desk'] = { name: 'Desk', start: '09:00', end: '17:00', kind: 'work', status: 'partly', at: '2026-01-06T17:00:00Z' };
    repo['log.json'] = { sha: 's' + (++n), text: JSON.stringify(cur) };
    await page.click('#tl [data-log$="06:00|Wake"][data-st="done"]'); await settle();
    await page.click('#tl [data-log$="06:00|Wake"][data-st="partly"]'); await settle();
    assert.strictEqual(log()['09:00|Desk'].status, 'partly'); assert.strictEqual(log()['06:00|Wake'].status, 'partly');
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 0, width: 400, height: 760 } });
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

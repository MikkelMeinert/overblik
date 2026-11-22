// The Beach card: beach.json from the hub (written by the cphbeach Action). Made-up courts and times.
// Run: node tests/test_beach.js        (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST' };
const BEACH = { version: 1, generated: '2026-01-06T11:30:00+01:00', blocked_until: null,
  member_free: [
    { date: '2026-01-06', start: '09:00', end: '10:30', court: 'inde-1', tier: 'weekend' },     // already over at noon
    { date: '2026-01-06', start: '17:00', end: '18:30', court: 'inde-1', tier: 'prime' },
    { date: '2026-01-06', start: '17:00', end: '18:30', court: 'inde-2', tier: 'prime' },
    { date: '2026-01-14', start: '17:00', end: '18:30', court: 'inde-1', tier: 'prime' } ],    // beyond 7 days
  chance: [
    { date: '2026-01-07', start: '08:00', end: '09:30', court: 'inde-3', tier: 'morning', call_from: '2026-01-06T08:00:00+01:00', public_price: '300,00' },
    { date: '2026-01-10', start: '12:00', end: '13:30', court: 'inde-2', tier: 'weekend', call_from: '2026-01-09T12:00:00+01:00', public_price: '300,00' },
    { date: '2026-01-10', start: 'bad', end: '13:30', court: 'inde-2', tier: 'weekend' } ],
  courts: {}, notes: [] };

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };
  const repo = { 'beach.json': JSON.stringify(BEACH) };
  const handler = async route => {
    const req = route.request(); const p = new URL(req.url()).pathname.split('/contents/')[1];
    if (req.method() === 'GET') {
      if (!repo[p]) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'x', content: Buffer.from(repo[p]).toString('base64') }) });
    }
    repo[p] = Buffer.from(JSON.parse(req.postData()).content, 'base64').toString('utf8');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'y' } }) });
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 1200 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await require('./_all_pages')(ctx);
  await ctx.clock.install({ time: new Date('2026-01-06T12:00:00+01:00') });
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  const synced = () => page.waitForFunction(() => /^synced/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  await page.reload(); await synced();
  const rows = () => page.$$eval('#bc .bc-row', els => els.map(e => [e.className, e.textContent]));

  await check('the next 7 days, grouped by day, one row per time and kind', async () => {
    assert.deepStrictEqual(await page.$$eval('#bc .bc-day', els => els.map(e => e.textContent)), ['Today', 'Tomorrow', 'Sat']);
    const r = await rows();
    assert.strictEqual(r.length, 3, 'past, beyond 7 days and malformed rows are left out');
    assert.match(r[0][1], /^17:00 to 18:30prime · member, free · 2 courts$/);
    assert.match(r[1][0], /dim/, 'a morning row is dimmed'); assert.match(r[1][1], /morning · chance · call from Tue[ ,]+08:00 or 300,00 kr\./);
    assert.match(r[2][1], /weekend · chance/);
    assert.strictEqual(await page.textContent('#bc-count'), '2 slots', 'morning rows are not counted');
    assert.strictEqual(await page.textContent('#bc-src'), 'checked 11:30');
  });
  repo['beach.json'] = JSON.stringify({ ...BEACH, generated: '2026-01-05T20:00:00+01:00', blocked_until: '2026-01-08T17:00:00+01:00' });
  await page.reload(); await synced();
  await check('stale after 12 hours, and member courts blocked by his own booking', async () => {
    assert.match(await page.textContent('#bc-src'), /^checked 20:00 · stale: last checked 16 h ago · your booking blocks member courts until Thu[ ,]+8 Jan/);
    assert.match((await rows())[0][1], /member · blocked by your booking/);
  });
  delete repo['beach.json'];
  await page.reload(); await synced();
  await check('no beach.json: no card', async () => assert.ok(await page.$eval('#bc-sec', e => e.hidden)));
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

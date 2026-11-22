// What he logged in the training app shows in Today, at the time it happened, and counts as done in log.json.
// Made-up sessions, a mocked GitHub API with two repos. Run: node tests/test_training.js   (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST' };
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TEMPLATE = { version: 1, anchor_a_monday: '2026-01-05', events: [
  { name: 'Gym', kind: 'body', source: 'Transport', days: ['tue'], start: '17:00', end: '18:30' },
  { name: 'Tankebænken', kind: 'quiet', source: 'Læsning', days: ALL, start: '20:40', end: '21:30' } ] };
const ts = iso => new Date(iso).getTime();
const STATE = { sessions: { '2026-01-05': 'lower-strength', '2026-01-06': 'upper-horiz', '2026-01-07': 'upper-vert' },
  logs: { bench: [{ r: 8, w: 60, ts: ts('2026-01-05T07:10:00+01:00') }, { r: 8, w: 60, ts: ts('2026-01-06T13:07:00+01:00') }, { r: 8, w: 62, ts: ts('2026-01-07T07:02:00+01:00') }],
          row: [{ r: 10, w: 40, ts: ts('2026-01-06T13:52:00+01:00') }, { r: 10, w: 40, ts: ts('2026-01-07T07:41:00+01:00') }] },
  acts: [{ date: '2026-01-06', min: 60, rpe: 7, ts: ts('2026-01-06T10:00:00+01:00'), type: 'padel' }] };
const PLAN = { days: [{ date: '2026-01-06', session: 'Upper · horizontal', reason: 'Logged today', hold: false }] };

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };
  const repos = { 'overblik-data': { 'template.json': JSON.stringify(TEMPLATE) }, 'training-data': { 'state.json': JSON.stringify(STATE), 'plan.json': JSON.stringify(PLAN) } };
  const handler = async route => {
    const req = route.request(); const u = new URL(req.url()); const repo = u.pathname.split('/')[3]; const p = u.pathname.split('/contents/')[1];
    const store = repos[repo] || {}; const sha = k => 'sha-' + repo + '-' + k + '-' + (store['_v' + k] || 0);
    if (req.method() === 'GET') {
      if (store[p] === undefined) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: sha(p), content: Buffer.from(store[p]).toString('base64') }) });
    }
    if (repo === 'training-data') return route.fulfill({ status: 403, body: '{}' });   // read only
    const body = JSON.parse(req.postData());
    if (store[p] !== undefined && body.sha !== sha(p)) return route.fulfill({ status: 409, body: '{}' });
    store[p] = Buffer.from(body.content, 'base64').toString('utf8'); store['_v' + p] = (store['_v' + p] || 0) + 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: sha(p) } }) });
  };
  const errs = [];
  const browser = await chromium.launch();
  const open = async iso => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 1400 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
    await require('./_all_pages')(ctx);
    await ctx.clock.install({ time: new Date(iso) });
    await ctx.route('https://api.github.com/**', handler);
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(APP); await page.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
    await page.reload(); await page.waitForTimeout(500); await page.waitForFunction(() => !syncing, null, { timeout: 5000 });
    await page.evaluate(() => sync('test')); await page.waitForTimeout(400); await page.waitForFunction(() => !syncing, null, { timeout: 5000 });
    return { ctx, page };
  };
  const rows = page => page.$$eval('#tl > li', els => els.map(li => ({ t: li.querySelector('.t').innerText.replace('\n', '-'), name: li.querySelector('.name').innerText, meta: li.querySelector('.meta').innerText })));
  const log = (d) => JSON.parse(repos['overblik-data']['log.json']).days[d];

  let { ctx, page } = await open('2026-01-06T15:00:00+01:00');   // Tuesday: Gym planned 17:00, trained 13:07 to 13:52, padel 09:00 to 10:00
  await check('the planned workout moves to when he trained, with the session, and is done', async () => {
    const r = await rows(page);
    const gym = r.find(x => x.name.startsWith('Gym'));
    assert.deepStrictEqual([gym.t, gym.meta], ['13:05-13:55', 'logged in the training app · planned 17:00']);
    assert.match(gym.name, /Upper · horizontal/);
    assert.ok(!r.some(x => x.t.startsWith('17:00')), 'no second row at the planned time');
    assert.strictEqual(log('2026-01-06')['13:05|Gym'].status, 'done'); assert.strictEqual(log('2026-01-06')['13:05|Gym'].from, 'training');
  });
  await check('sport logged in the training app shows at its time and is done', async () => {
    const p = (await rows(page)).find(x => x.name === 'Padel');
    assert.deepStrictEqual([p.t, p.meta], ['09:00-10:00', 'logged in the training app']);
    assert.strictEqual(log('2026-01-06')['09:00|Padel'].status, 'done');
  });
  await check('what he logged by hand is never overwritten', async () => {
    await page.click('#tl [data-log$="13:05|Gym"][data-st="done"]'); await page.waitForTimeout(200);   // a tap on the choice reopens the three
    await page.evaluate(() => sync('test')); await page.waitForTimeout(400); await page.waitForFunction(() => !syncing, null, { timeout: 5000 });
    assert.ok(!(log('2026-01-06')['13:05|Gym'] || {}).status, 'cleared by him stays cleared');
    await page.click('#tl [data-log$="13:05|Gym"][data-st="partly"]'); await page.waitForTimeout(300);
    await page.evaluate(() => sync('test')); await page.waitForTimeout(400); await page.waitForFunction(() => !syncing, null, { timeout: 5000 });
    assert.strictEqual(log('2026-01-06')['13:05|Gym'].status, 'partly');
  });
  await ctx.close();

  ({ ctx, page } = await open('2026-01-07T09:00:00+01:00'));   // Wednesday: no workout planned, trained 07:02 to 07:41
  await check('a session with nothing planned gets its own row, named from the training app', async () => {
    const t = (await rows(page)).find(x => x.name.startsWith('Træning'));
    assert.deepStrictEqual([t.t, t.name, t.meta], ['07:00-07:45', 'Træning Upper · vertical', 'logged in the training app']);
  });
  await ctx.close();

  delete repos['training-data']['state.json'];
  ({ ctx, page } = await open('2026-01-06T15:00:00+01:00'));
  await check('without access to the training repo Today is the plan as before', async () => {
    const r = await rows(page);
    assert.ok(r.some(x => x.t === '17:00-18:30' && x.name === 'Gym'));
  });
  await ctx.close();
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n')); console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();

// Playwright test of Overblik against a mocked GitHub Contents API.
// Run: node tests/test_sync.js        (exit code 0 = all checks passed)
// Optional: SHOT=/path/shot.png node tests/test_sync.js   saves a screenshot of the second device.
// The template below is a made-up week. Never put the real one in this repo.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST' };
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TEMPLATE = {
  version: 1, anchor_a_monday: '2026-01-05', week_notes: { A: 'club on Wednesday', B: 'no club' },
  events: [
    { name: 'Wake', kind: 'body', source: 'Cal · 30 min', days: ALL, start: '06:00', end: '06:30' },
    { name: 'Desk', kind: 'work', source: 'office', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' },
    { name: 'Praktisk', kind: 'block', block: 'praktisk', source: 'Cal · 45 min', days: ['tue'], start: '18:00', end: '18:45' },
    { name: 'Hus', kind: 'block', block: 'hus', source: 'Cal · 120 min', days: ['sat'], weeks: 'B', start: '10:00', end: '12:00' },
    { name: 'Fremtid', kind: 'block', block: 'fremtid', source: 'Cal · 60 min', days: ['sun'], start: '09:00', end: '10:00' },
    { name: 'Club', kind: 'sport', source: 'Cal', days: ['wed'], weeks: 'A', start: '19:00', end: '20:00' },
  ],
};
const NOW = '2026-01-06T12:00:00+01:00'; // a Tuesday in an A week, Europe/Copenhagen

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };

  // ---- fake repo: path -> { sha, text }. One injected conflict on inbox.json, and a switch to take the API down.
  const repo = {}; let shaN = 0, conflictOnce = true, down = false; const puts = [];
  const sha = () => 'sha' + (++shaN);
  const put = (p, obj) => { repo[p] = { sha: sha(), text: typeof obj === 'string' ? obj : JSON.stringify(obj) }; };
  const handler = async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname.split('/contents/')[1];
    if (down) return route.abort('failed');
    if (req.headers()['authorization'] !== 'Bearer ' + CFG.token) return route.fulfill({ status: 401, body: '{}' });
    if (req.method() === 'GET') {
      if (!repo[p]) return route.fulfill({ status: 404, body: '{"message":"Not Found"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: repo[p].sha, content: Buffer.from(repo[p].text, 'utf8').toString('base64') }) });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData()); puts.push(p + ': ' + body.message);
      if (repo[p] && body.sha !== repo[p].sha) return route.fulfill({ status: 409, body: '{"message":"conflict"}' });
      if (p === 'inbox.json' && conflictOnce && repo[p] && JSON.parse(repo[p].text).items.length) { // another writer sneaks in once
        conflictOnce = false;
        put(p, { version: 1, items: [...JSON.parse(repo[p].text).items, { id: 'other1', text: 'Written by other device', block: 'hus', created: '2026-01-05', updated: '2026-01-05T10:00:00.000Z', done: null }] });
        return route.fulfill({ status: 409, body: '{"message":"conflict"}' });
      }
      put(p, Buffer.from(body.content, 'base64').toString('utf8'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: repo[p].sha } }) });
    }
    route.fulfill({ status: 500, body: '{}' });
  };
  const errs = [];
  const browser = await chromium.launch();
  const device = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
    await ctx.clock.install({ time: new Date(NOW) });
    await ctx.route('https://api.github.com/**', handler);
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(label + ': ' + e.message));
    return page;
  };
  const names = page => page.$$eval('#tl .name', els => els.map(e => e.firstChild.textContent));
  const synced = page => page.waitForFunction(() => /^synced/.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  const settled = async page => { await page.waitForTimeout(250); await page.waitForFunction(() => !/syncing/.test(document.getElementById('status').textContent), null, { timeout: 5000 }); };
  const inbox = () => JSON.parse(repo['inbox.json'].text).items;

  put('template.json', TEMPLATE);
  const p1 = await device('p1');
  await p1.goto(APP);

  await check('before setup: the shell shows no schedule', async () => {
    assert.strictEqual(await p1.textContent('#status'), 'not set up');
    assert.deepStrictEqual(await names(p1), []);
    assert.match(await p1.textContent('#t-src'), /Set up the data repo/);
    assert.strictEqual(await p1.textContent('#h-sub'), 'Week 2');
  });

  await p1.click('#f-setup');
  await p1.fill('#s-owner', CFG.owner); await p1.fill('#s-repo', CFG.repo); await p1.fill('#s-token', CFG.token);
  await p1.click('#s-save'); await synced(p1);

  await check('setup: first write creates inbox.json', async () => {
    assert.deepStrictEqual(inbox(), []);
    assert.match(puts[0], /^inbox\.json: overblik: setup/);
  });
  await check('template.json drives Today, the week line and the cache', async () => {
    assert.deepStrictEqual(await names(p1), ['Wake', 'Desk', 'Praktisk']);
    assert.strictEqual(await p1.textContent('#h-sub'), 'Week 2 · A week · club on Wednesday');
    assert.match(await p1.textContent('#t-src'), /^from template\.json/);
    assert.deepStrictEqual(await p1.evaluate(() => JSON.parse(localStorage.getItem('overblik.tpl')).events.length), 6);
  });
  await check('template rules: A/B weeks, next block, two-week horizon', async () => {
    const r = await p1.evaluate(() => ({
      wedA: templateDay(new Date(2026, 0, 7, 12)).events.map(e => e.name),
      wedB: templateDay(new Date(2026, 0, 14, 12)).events.map(e => e.name),
      letters: [weekLetter(new Date(2026, 0, 5)), weekLetter(new Date(2026, 0, 11)), weekLetter(new Date(2026, 0, 12)), weekLetter(new Date(2025, 11, 30))],
      pNoon: nextBlock('praktisk', new Date(2026, 0, 6, 12, 0), null),
      pLate: nextBlock('praktisk', new Date(2026, 0, 6, 18, 45), null),
      fremtid: nextBlock('fremtid', new Date(2026, 0, 6, 12, 0), null),
      hus: nextBlock('hus', new Date(2026, 0, 6, 12, 0), null),
      cardNoMinutes: nextBlock('hus', new Date(2026, 0, 6, 12, 0), { next: [{ block: 'hus', label: 'Moved' }] }),
    }));
    assert.deepStrictEqual(r.wedA, ['Wake', 'Desk', 'Club']);
    assert.deepStrictEqual(r.wedB, ['Wake', 'Desk']);
    assert.deepStrictEqual(r.letters, ['A', 'A', 'B', 'B']);
    assert.deepStrictEqual(r.pNoon, { label: 'Today 18:00', minutes: 45 });
    assert.deepStrictEqual(r.pLate, { label: 'Tue 18:00', minutes: 45 });
    assert.deepStrictEqual(r.fremtid, { label: 'Sun 09:00', minutes: 60 });
    assert.deepStrictEqual(r.hus, { label: 'Sat 17 Jan 10:00', minutes: 120 });
    assert.deepStrictEqual(r.cardNoMinutes, { label: 'Moved', minutes: 120 });
  });

  await p1.fill('#cap', 'Call the bank (20m)'); await p1.press('#cap', 'Enter'); await settled(p1);
  await p1.click('.chip.hus'); await p1.fill('#cap', 'Oil the chain'); await p1.press('#cap', 'Enter'); await settled(p1);

  await check('capture: items land in the right block, concurrent writer is merged', async () => {
    assert.deepStrictEqual(inbox().map(i => [i.text, i.block, i.done]).sort(), [
      ['Call the bank (20m)', 'praktisk', null], ['Oil the chain', 'hus', null], ['Written by other device', 'hus', null]]);
    assert.ok(puts.filter(m => /overblik: add/.test(m)).length >= 3, 'the conflicted write was retried');
  });
  await check('Next up uses block lengths from the template', async () => {
    assert.strictEqual(await p1.textContent('.group.praktisk .when'), 'Today 18:00 · 45 min');
    assert.strictEqual(await p1.textContent('.group.praktisk .fill-l'), '20 of 45 min planned');
    assert.strictEqual(await p1.textContent('#groups .group.hus .when'), 'Sat 17 Jan 10:00 · 120 min');
  });

  await p1.click('.group.praktisk .item .box'); await settled(p1);
  await check('done toggle is written with a timestamp', async () => {
    const it = inbox().find(i => i.text.startsWith('Call the bank'));
    assert.ok(it.done && !Number.isNaN(Date.parse(it.done)));
    assert.match(puts[puts.length - 1], /overblik: done \(2 open\)/);
  });

  put('today.json', { date: '2026-01-06', week: 'A', generated: '2026-01-06T04:47:00+01:00',
    events: [{ start: '13:00', end: '14:00', name: 'Card event', kind: 'block', block: 'praktisk', source: 'Cal' }],
    info: ['Reminder one'], next: [{ block: 'praktisk', label: 'Today 13:00', minutes: 30 }], conflicts: [] });
  await p1.reload(); await synced(p1);
  await check('today.json for today replaces the template', async () => {
    assert.deepStrictEqual(await names(p1), ['Card event']);
    assert.match(await p1.textContent('#t-src'), /^from planner card, 04:47/);
    assert.match(await p1.textContent('#fyi'), /Reminder one/);
    assert.strictEqual(await p1.textContent('#h-sub'), 'Week 2 · A week · club on Wednesday');
  });
  put('today.json', { date: '2026-01-05', week: 'A', events: [{ start: '13:00', end: '14:00', name: 'Stale', kind: 'quiet' }] });
  await p1.reload(); await synced(p1);
  await check('a card for another day is ignored', async () => {
    assert.deepStrictEqual(await names(p1), ['Wake', 'Desk', 'Praktisk']);
  });

  const p2 = await device('p2');
  await p2.goto(APP);
  await p2.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  await p2.reload(); await synced(p2);
  await check('cold second device sees open and done-today items and the template', async () => {
    const texts = await p2.$$eval('.item .txt', els => els.map(e => e.firstChild.textContent));
    assert.deepStrictEqual(texts.sort(), ['Call the bank', 'Oil the chain', 'Written by other device']);
    assert.deepStrictEqual(await names(p2), ['Wake', 'Desk', 'Praktisk']);
  });

  down = true; await p2.reload(); await settled(p2);
  await check('API unreachable: cached template and items still render, capture queues', async () => {
    assert.match(await p2.textContent('#status'), /sync failed|offline/);
    assert.deepStrictEqual(await names(p2), ['Wake', 'Desk', 'Praktisk']);
    await p2.fill('#cap', 'Queued while down'); await p2.press('#cap', 'Enter'); await settled(p2);
    assert.match(await p2.textContent('#f-note'), /changes waiting to sync/);
    assert.ok(!inbox().some(i => i.text === 'Queued while down'));
  });
  down = false; await p2.reload(); await synced(p2);
  await check('queued item is written once the API is back', async () => {
    assert.ok(inbox().some(i => i.text === 'Queued while down'));
  });

  put('template.json', { version: 1, events: [{ name: 'Broken', days: ['mon'], start: '25:99', end: '26:00' }] });
  await p2.reload(); await synced(p2);
  await check('a malformed template.json never replaces the last good copy', async () => {
    assert.deepStrictEqual(await names(p2), ['Wake', 'Desk', 'Praktisk']);
    assert.match(await p2.textContent('#t-src'), /format error, showing the last good copy/);
  });
  put('template.json', '<script>not json');
  const p3 = await device('p3');
  await p3.goto(APP);
  await p3.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  await p3.reload(); await synced(p3);
  await check('fresh device with an unreadable template: empty Today, clear message, items intact', async () => {
    assert.deepStrictEqual(await names(p3), []);
    assert.match(await p3.textContent('#t-src'), /No template\.json.*format error$/);
    assert.ok((await p3.$$('.item')).length >= 3);
  });

  await check('no page errors', async () => assert.deepStrictEqual(errs, []));

  if (process.env.SHOT) { put('template.json', TEMPLATE); await p2.reload(); await synced(p2); await p2.screenshot({ path: process.env.SHOT, fullPage: true }); }
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

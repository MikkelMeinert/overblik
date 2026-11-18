// Playwright test of Overblik against a mocked GitHub Contents API.
// Run: node tests/test_sync.js        (exit code 0 = all checks passed)
// Optional: SHOT_PLAN=/path/plan.png saves a screenshot of the first device with the evening plan loaded.
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

  // ---- the evening plan: tomorrow.json next to today's card
  const TOMORROW = { date: '2026-01-07', week: 'A', generated: '2026-01-06T18:30:00+01:00', plan_id: '2026-01-07@x',
    events: [{ start: '06:45', end: '07:45', name: 'Wake', kind: 'body', source: 'Cal · 60 min' }, { start: '08:00', end: '16:00', name: 'Desk', kind: 'work', source: 'office' },
      { start: '18:30', end: '19:30', name: 'Praktisk', kind: 'block', block: 'praktisk', source: 'Cal · 60 min · moved from 16:30' }],
    options: [{ start: '19:00', end: '21:00', name: 'Open court', source: 'Cal' }], info: ['A birthday'],
    next: [{ block: 'praktisk', label: 'Tomorrow 18:30', minutes: 60, start: '2026-01-07T18:30:00+01:00', end: '2026-01-07T19:30:00+01:00' }],
    conflicts: ['Call home 18:00 to 18:30 overlaps Cook (17:00 to 19:00)'],
    adjustments: ['Desk ends 15:00 instead of 17:00: Dentist', 'Praktisk 18:30 to 19:30 instead of 16:30 to 17:30: overlaps Squash (16:30 to 18:30)'],
    away: [{ from: '07:45', to: '16:00', for: ['Desk'] }], pack: [{ for: 'Gym 07:00', items: ['shoes', 'towel'] }],
    changes: [{ calendar: 'Cal', uid: 'u1', title: 'Praktisk', date: '2026-01-07', from: { start: '16:30', end: '17:30' }, to: { start: '18:30', end: '19:30' }, reason: 'x' }],
    proposals: [
      { what: 'Praktisk', from: { start: '16:30', end: '17:30' }, why: 'overlaps Squash (16:30 to 18:30)', action: 'moved', slots: [{ date: '2026-01-07', start: '18:30', end: '19:30', label: 'Tomorrow 18:30 to 19:30' }, { date: '2026-01-08', start: '16:30', end: '17:30', label: 'Thu 16:30 to 17:30' }] },
      { what: 'Call home', from: { start: '18:00', end: '18:30' }, why: 'overlaps Cook (17:00 to 19:00)', action: 'move', slots: [{ date: '2026-01-07', start: '16:30', end: '17:00', label: 'Tomorrow 16:30 to 17:00' }] },
      { what: 'Hus', from: { start: '11:00', end: '12:30' }, why: 'overlaps Trip (06:00 to 21:30)', action: 'skip', slots: [] },
      { what: 'Dentist 19:30 to 20:30 overlaps Dinner (19:00 to 21:00)', why: 'two fixed commitments', action: 'choose', slots: [] }] };
  put('today.json', { date: '2026-01-06', week: 'A', generated: '2026-01-06T04:47:00+01:00',
    events: [{ start: '13:00', end: '14:00', name: 'Praktisk', kind: 'block', block: 'praktisk', source: 'Cal' }], info: [],
    options: [{ start: '19:00', end: '20:00', name: 'Late swim', source: 'Cal' }],
    next: [{ block: 'praktisk', label: 'Today 13:00', minutes: 60, start: '2026-01-06T13:00:00+01:00', end: '2026-01-06T14:00:00+01:00' },
           { block: 'praktisk', label: 'Tomorrow 16:30', minutes: 60, start: '2026-01-07T16:30:00+01:00', end: '2026-01-07T17:30:00+01:00' }],
    conflicts: ['Praktisk 13:00 to 14:00 overlaps Lunch out (12:30 to 13:30)'], adjustments: ['Desk ends 15:00 instead of 17:00: Dentist'] });
  put('tomorrow.json', TOMORROW);
  await p1.reload(); await synced(p1);
  await check('Today shows the planner\'s conflicts, adjustments and options', async () => {
    const notes = await p1.$$eval('#t-notes li', els => els.map(e => e.textContent));
    assert.deepStrictEqual(notes, ['Conflict Praktisk 13:00 to 14:00 overlaps Lunch out (12:30 to 13:30)', 'Adjusted Desk ends 15:00 instead of 17:00: Dentist']);
    assert.deepStrictEqual(await names(p1), ['Praktisk', 'Late swim']);
    assert.strictEqual(await p1.getAttribute('#tl li:nth-child(2)', 'class'), 'opt');
    assert.strictEqual(await p1.textContent('#t-sum'), '1 h in blocks', 'an option is not counted as planned time');
  });
  await check('Tomorrow: the plan, what to pack, and a card per proposal', async () => {
    assert.ok(await p1.isVisible('#tm-sec'));
    assert.deepStrictEqual(await p1.$$eval('#tm-tl .name', els => els.map(e => e.firstChild.textContent)), ['Wake', 'Desk', 'Praktisk', 'Open court']);
    assert.strictEqual(await p1.$$eval('#tm-tl li.past, #tm-tl li.now', els => els.length), 0, 'nothing in tomorrow is past or now');
    assert.strictEqual(await p1.textContent('#tm-sum'), 'leave 07:45');
    const notes = await p1.$$eval('#tm-notes li', els => els.map(e => e.textContent));
    assert.deepStrictEqual(notes, ['Away 07:45 to 16:00 (Desk)', 'Pack for Gym 07:00 shoes, towel', 'Adjusted Desk ends 15:00 instead of 17:00: Dentist'], 'a moved block is shown as a card, not twice');
    assert.deepStrictEqual(await p1.$$eval('#tm-props .tag', els => els.map(e => e.textContent)), ['Moved', 'Yours to move', 'No room', 'Yours to choose']);
    assert.deepStrictEqual(await p1.$$eval('#tm-props .prop.moved .slot', els => els.map(e => e.textContent + (e.classList.contains('first') ? '*' : ''))), ['Tomorrow 18:30 to 19:30*', 'Thu 16:30 to 17:30']);
    assert.match(await p1.textContent('#tm-props .prop.move'), /Call home.*18:00 to 18:30.*overlaps Cook.*Tomorrow 16:30 to 17:00.*Drag it/s);
    assert.match(await p1.getAttribute('#tm-props .prop.move a', 'href'), /^calshow:\d+$/);
    assert.strictEqual(await p1.textContent('#tm-src'), 'planned 18:30 · 1 calendar change for the Mac to write');
    assert.match(await p1.textContent('#fyi') + await p1.textContent('#tm-fyi'), /A birthday/);
  });
  if (process.env.SHOT_PLAN) await p1.screenshot({ path: process.env.SHOT_PLAN, fullPage: true });
  await p1.fill('#cap', 'Pay the bill'); await p1.press('#cap', 'Enter'); await settled(p1);
  await check('Next up drops a block that has ended and follows the evening plan', async () => {
    assert.strictEqual(await p1.textContent('.group.praktisk .when'), 'Today 13:00 · 60 min');
    await p1.clock.fastForward('02:05:00');   // 14:05: today's block is over
    await p1.waitForFunction(() => /Tomorrow/.test(document.querySelector('.group.praktisk .when').textContent), null, { timeout: 5000 });
    assert.strictEqual(await p1.textContent('.group.praktisk .when'), 'Tomorrow 18:30 · 60 min', 'the moved time from tomorrow.json wins over the morning card for that day');
    assert.strictEqual(await p1.getAttribute('#tl li:first-child', 'class'), 'past');
  });
  await check('picking an option writes choices.json, dropping it removes the key', async () => {
    await p1.click('#tm-tl .pick'); await settled(p1);
    assert.deepStrictEqual(JSON.parse(repo['choices.json'].text).options, { '2026-01-07|Open court': 'yes' });
    assert.strictEqual(await p1.getAttribute('#tm-tl .pick', 'aria-pressed'), 'true');
    assert.strictEqual(await p1.textContent('#tm-tl .pick'), 'Going');
    assert.ok(!(await p1.getAttribute('#tm-tl li:nth-child(4)', 'class') || '').includes('opt'), 'a picked option is no longer dimmed');
    await p1.reload(); await synced(p1);
    assert.strictEqual(await p1.getAttribute('#tm-tl .pick', 'aria-pressed'), 'true', 'the pick survives a reload');
    await p1.click('#tm-tl .pick'); await settled(p1);
    assert.deepStrictEqual(JSON.parse(repo['choices.json'].text).options, {});
  });
  delete repo['today.json']; put('tomorrow.json', { ...TOMORROW, date: '2026-01-06' });
  await p1.reload(); await synced(p1);
  await check('last evening\'s plan stands in as Today until the morning card exists', async () => {
    assert.deepStrictEqual(await names(p1), ['Wake', 'Desk', 'Praktisk', 'Open court']);
    assert.match(await p1.textContent('#t-src'), /^from last evening's plan, 18:30/);
    assert.ok(!(await p1.isVisible('#tm-sec')), 'no Tomorrow section without a plan for tomorrow');
  });
  delete repo['tomorrow.json']; delete repo['choices.json'];

  const p2 = await device('p2');
  await p2.goto(APP);
  await p2.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  await p2.reload(); await synced(p2);
  await check('cold second device sees open and done-today items and the template', async () => {
    const texts = await p2.$$eval('.item .txt', els => els.map(e => e.firstChild.textContent));
    assert.deepStrictEqual(texts.sort(), ['Call the bank', 'Oil the chain', 'Pay the bill', 'Written by other device']);
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

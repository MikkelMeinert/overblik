// Pages behind a tab bar, short conflicts, "Accept suggested", the Week page (hours per area) and newspaper reading.
// Made-up plan, week and books. Run: node tests/test_pages.js        (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST', tbRepo: 'tankebaenken-data' };
const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TEMPLATE = { version: 1, anchor_a_monday: '2026-01-05', events: [
  { name: 'Praktisk', kind: 'block', block: 'praktisk', source: 'Arbejde', days: ['mon', 'thu'], start: '16:30', end: '17:30' },
  { name: 'Tankebænken', kind: 'quiet', source: 'Læsning', days: ALL, start: '20:40', end: '21:30' } ] };
const TODAY = { date: '2026-01-06', week: 'A', generated: '2026-01-06T04:47:00+01:00', info: [],
  events: [ { start: '10:00', end: '21:00', name: 'Visit', kind: 'quiet', source: 'Transport' },
            { start: '20:40', end: '21:30', name: 'Tankebænken', kind: 'quiet', source: 'Hjem' } ],
  conflicts: [ 'Praktisk 10:00 to 11:00 overlaps Visit (10:00 to 21:00)', 'Hus 11:00 to 12:30 overlaps Visit (10:00 to 21:00)',
               'Gym 07:00 to 07:45 overlaps a work meeting (07:30 to 08:00)', 'Work meeting 18:00 to 18:30 is outside 08:00 to 16:00' ],
  load: { heavy: true, sessions: 2, why: 'Padel 07:00, Squash 16:30', from: '07:00', late_end: null, after_late: '22:15' },
  gaps: [ { start: '21:00', end: '21:40', id: 'a1', text: 'Ring til banken', minutes: 10 } ] };
const slot = (date, start, end, label) => ({ date, start, end, label });
const TOMORROW = { date: '2026-01-07', week: 'A', generated: '2026-01-06T18:30:00+01:00', plan_id: '2026-01-07@p', info: [],
  events: [ { start: '07:00', end: '07:45', name: 'Gym', kind: 'body', source: 'Transport',
              pm: { calendar: 'Transport', uid: 'g7', date: '2026-01-07', from: { start: '07:00', end: '07:45' }, to: { date: '2026-01-07', start: '16:00', end: '16:45' } } } ],
  proposals: [
    { what: 'Fremtid', from: { start: '09:00', end: '10:30' }, why: 'overlaps Dentist (09:00 to 10:00)', action: 'moved', slots: [slot('2026-01-07', '11:00', '12:30', 'Tomorrow 11:00 to 12:30')] },
    { what: 'Gym', from: { start: '17:00', end: '18:00' }, why: 'overlaps Dinner (17:00 to 20:00)', action: 'move', calendar: 'Transport', uid: 'g1', date: '2026-01-07',
      slots: [slot('2026-01-07', '07:30', '08:30', 'Tomorrow 07:30 to 08:30'), slot('2026-01-07', '20:00', '21:00', 'Tomorrow 20:00 to 21:00')] },
    { what: 'Call home', from: { start: '18:00', end: '18:30' }, why: 'overlaps Dinner (17:00 to 20:00)', action: 'move', calendar: 'Hjem', uid: 'c1', date: '2026-01-07',
      slots: [slot('2026-01-08', '18:00', '18:30', 'Thu 18:00 to 18:30')] },
    { what: 'Praktisk', from: { start: '16:30', end: '17:30' }, why: 'overlaps Dinner (17:00 to 20:00)', action: 'skip', slots: [] } ],
  changes: [], away: [], pack: [] };
const hours = o => ({ Work: 0, Training: 0, Sport: 0, ...o });
const WEEKLY = [ { week: '2026-W47', hours: hours({ Work: 40, Training: 4, Sport: 8.5, Praktisk: 3 }) },
                 { week: '2026-W48', hours: hours({ Work: 38, Training: 3, Sport: 6, Praktisk: 2 }) },
                 { week: '2026-W49', hours: hours({ Work: 36, Training: 5, Sport: 4, Praktisk: 1 }) } ].map(l => JSON.stringify(l)).join('\n') + '\n';
const STATE = { version: 1, appVersion: '1.1.1', stones: [], quarry: [],
  books: [ { id: 'b-0006', title: 'Kongens fald', author: 'J. V. Jensen', kind: 'easy', status: 'reading', earnedBy: null, addedAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z' } ],
  readingLog: [], counters: { stone: 0, quarry: 0, book: 6, reading: 0, journal: 0 }, settings: {}, backup: {} };

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n').slice(0,12).join(' ')); }
  };
  const repos = { 'overblik-data': { 'template.json': JSON.stringify(TEMPLATE), 'today.json': JSON.stringify(TODAY), 'tomorrow.json': JSON.stringify(TOMORROW),
      'shadow/weekly_log.jsonl': WEEKLY, 'inbox.json': JSON.stringify({ version: 1, items: [
        { id: 'a1', text: 'Ring til banken', block: 'praktisk', created: '2026-01-05', updated: '2026-01-05T10:00:00Z', done: null },
        { id: 'a2', text: 'A wish for the app', block: 'app', created: '2026-01-05', updated: '2026-01-05T10:00:00Z', done: null } ] }) },
    'tankebaenken-data': { 'state.json': JSON.stringify(STATE) } };
  const handler = async route => {
    const req = route.request(); const u = new URL(req.url()); const repo = u.pathname.split('/')[3]; const p = decodeURIComponent(u.pathname.split('/contents/')[1]);
    const store = repos[repo] || {}; const sha = k => 'sha-' + k + '-' + (store['_v' + k] || 0);
    if (req.method() === 'GET') {
      if (store[p] === undefined) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: sha(p), content: Buffer.from(store[p]).toString('base64') }) });
    }
    const body = JSON.parse(req.postData());
    if (store[p] !== undefined && body.sha !== sha(p)) return route.fulfill({ status: 409, body: '{}' });
    store[p] = Buffer.from(body.content, 'base64').toString('utf8'); store['_v' + p] = (store['_v' + p] || 0) + 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: sha(p) } }) });
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await ctx.clock.install({ time: new Date('2026-01-06T20:45:00+01:00') });
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(cfg => { localStorage.setItem('overblik.cfg', JSON.stringify(cfg)); localStorage.removeItem('overblik.page'); }, CFG);
  const idle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !tbBusy && /^synced/.test(document.getElementById('status').textContent), null, { timeout: 5000 }); };
  await page.reload(); await idle();
  const shown = () => page.$$eval('.page', els => els.filter(e => !e.hidden).map(e => e.dataset.page));
  const shot = async n => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, n + '.png'), fullPage: true }); };
  const tabs = () => page.$$eval('#tabs button', els => els.filter(e => !e.hidden).map(e => e.dataset.tab + (e.getAttribute('aria-current') ? '*' : '')));

  await check('one page at a time, Today first; a tab with nothing to show is hidden', async () => {
    assert.deepStrictEqual(await shown(), ['today']);
    assert.deepStrictEqual(await tabs(), ['today*', 'tomorrow', 'todos', 'tb', 'week'], 'no beach.json: no Beach tab');
    assert.ok(await page.isVisible('#cap'), 'the capture box is on every page');
  });
  await shot('1-today');
  await check('Today: conflicts in few words, one line per thing they clash with', async () => {
    assert.deepStrictEqual(await page.$$eval('#t-notes .conf', els => els.map(e => e.textContent)), [
      'Conflict Praktisk 10:00, Hus 11:00 clash with Visit', 'Conflict Gym 07:00 clashes with a work meeting', 'Conflict Work meeting 18:00 to 18:30 is outside 08:00 to 16:00']);
  });
  await check('day load: a heavy-day line, a late-evening line, and a quick to-do in free time at home', async () => {
    const notes = await page.$$eval('#t-notes li.load', els => els.map(e => e.textContent));
    assert.deepStrictEqual(notes, ['Heavy day Padel 07:00, Squash 16:30. To-do blocks after 07:00 are offered on lighter days.',
      'Late evening It ended 22:15: an early workout is offered in the afternoon.']);
    const gap = await page.$eval('#tl li.gap', e => e.innerText.replace(/\s+/g, ' ').trim());
    assert.match(gap, /^21:00 21:40 Ring til banken free at home · a quick one, 10 m, if you feel like it Do it$/);
  });
  await check('badges: proposals waiting for him, and open to-dos', async () => {
    assert.strictEqual(await page.textContent('#tab-tm-n'), '3', 'two to move and one with no room; what the planner moved is not counted');
    assert.strictEqual(await page.textContent('#tab-td-n'), '1', 'an app wish is not a to-do');
  });
  await check('a tab shows its page, is remembered, and the address names it', async () => {
    await page.click('#tabs [data-tab="todos"]');
    assert.deepStrictEqual(await shown(), ['todos']);
    assert.ok(await page.isVisible('#groups')); assert.ok(!(await page.isVisible('#tl')));
    assert.match(page.url(), /#todos$/);
    await page.goto(APP); await idle();
    assert.deepStrictEqual(await shown(), ['todos'], 'remembered on this device');
    await page.goto(APP + '#tomorrow'); await idle();
    assert.deepStrictEqual(await shown(), ['tomorrow'], 'the evening push opens #tomorrow');
  });
  await check('Tomorrow: short cards, the first slot marked as suggested', async () => {
    assert.deepStrictEqual(await page.$$eval('#tm-props .p-w', els => els.map(e => e.textContent)),
      ['clashes with Dentist', 'clashes with Dinner', 'clashes with Dinner', 'clashes with Dinner']);
    assert.deepStrictEqual(await page.$$eval('#tm-props .prop.move button.slot', els => els.map(e => e.textContent)),
      ['Tomorrow 07:30 to 08:30suggested', 'Tomorrow 20:00 to 21:00', 'Thu 18:00 to 18:30suggested']);
    assert.strictEqual(await page.textContent('#acc-all'), 'Accept suggested (2)');
  });
  await shot('2-tomorrow');
  await check('a morning workout has an Afternoon button; a tap asks the calendar writer to move it, a second takes it back', async () => {
    const b = '#tm-tl button[data-pm]';
    assert.strictEqual(await page.textContent(b), 'Afternoon 16:00');
    await page.click(b); await idle();
    let acc = JSON.parse(repos['overblik-data']['accepts.json']).items.find(i => i.id === 'pm|2026-01-07|g7');
    assert.deepStrictEqual([acc.calendar, acc.uid, acc.title, acc.date, acc.from.start, acc.to.start, acc.to.end], ['Transport', 'g7', 'Gym', '2026-01-07', '07:00', '16:00', '16:45']);
    assert.strictEqual(await page.textContent(b), 'Moving to 16:00');
    await page.click(b); await idle();
    assert.ok(!JSON.parse(repos['overblik-data']['accepts.json']).items.some(i => i.id === 'pm|2026-01-07|g7'));
  });
  await check('"Accept suggested" accepts the first slot of every open card in one tap', async () => {
    await page.click('#tm-props .prop.move button.slot >> nth=1'); await idle();   // he picked Gym's second slot himself; that one stays
    await page.click('#acc-all'); await idle();
    const acc = JSON.parse(repos['overblik-data']['accepts.json']).items.map(i => `${i.title} ${i.to.date} ${i.to.start} ${i.uid} ${i.calendar}`);
    assert.deepStrictEqual(acc, ['Gym 2026-01-07 20:00 g1 Transport', 'Call home 2026-01-08 18:00 c1 Hjem']);
    assert.ok(!(await page.$('#acc-all')), 'nothing left to accept');
    assert.match(await page.textContent('#tm-props .acc-all'), /All answered/);
    assert.strictEqual(await page.textContent('#tab-tm-n'), '1', 'only the card with no room is left');
  });
  await check('Week: hours per area by week, the build week shown but not in the average', async () => {
    await page.click('#tabs [data-tab="week"]');
    assert.deepStrictEqual(await page.$$eval('.wk thead th', els => els.map(e => e.textContent)), ['h', 'W47', 'W48', 'W49', 'avg']);
    const rows = await page.$$eval('.wk tbody tr', els => els.map(e => [...e.children].map(c => c.textContent).join(' ')));
    assert.deepStrictEqual(rows, ['Work 40.0 38.0 36.0 37.0', 'Training 4.0 3.0 5.0 4.0', 'Sport 8.5 6.0 4.0 5.0', 'Praktisk 3.0 2.0 1.0 1.5'], 'areas with no hours in any week are left out');
    assert.strictEqual(await page.$eval('.wk tfoot tr', e => [...e.children].map(c => c.textContent).join(' ')), 'Total 55.5 49.0 46.0 47.5');
    assert.match(await page.textContent('#wk-src'), /^W47 was the build week: shown, not in the average\. Average of 2 weeks\..*\(shadow run\)\.$/);
  });
  await shot('3-week');
  await check('the evening Tankebænken row jumps to the Tankebænken page', async () => {
    await page.click('#tabs [data-tab="today"]');
    await page.click('#tl [data-tbgo="read"]');
    assert.deepStrictEqual(await shown(), ['tb']);
    assert.strictEqual(await page.$eval('#tb-read', e => e.hidden), false);
  });
  await check('newspaper reading is logged like a book, kept off the library, and counted as news', async () => {
    await page.selectOption('#tb-r-book', 'news');
    await page.click('.tb-mins .pick[data-min="10"]'); await idle();
    const st = JSON.parse(repos['tankebaenken-data']['state.json']);
    const news = st.books.find(b => b.kind === 'news');
    assert.ok(news && news.title === 'Newspaper' && news.id === 'b-0007' && news.owned === false, 'one library entry of kind news, with a real id');
    assert.deepStrictEqual(st.readingLog.map(r => `${r.bookId} ${r.minutes} ${r.date}`), ['b-0007 10 2026-01-06']);
    await page.selectOption('#tb-r-book', 'news');
    await page.click('.tb-mins .pick[data-min="15"]'); await idle();
    const st2 = JSON.parse(repos['tankebaenken-data']['state.json']);
    assert.strictEqual(st2.books.filter(b => b.kind === 'news').length, 1, 'the second read uses the same entry');
    const pr = JSON.parse(repos['overblik-data']['practice.json']).days['2026-01-06'];
    assert.deepStrictEqual([pr.reading_min, pr.reading_sessions, pr.news_min], [25, 2, 25]);
    assert.match(await page.textContent('#tb-r-list'), /Newspaper: 15 min/);
    assert.ok(!/Newspaper/.test(await page.textContent('#tb-lib')), 'not among the books');
    assert.ok(!/<optgroup[^>]*>[^]*Newspaper/.test(await page.innerHTML('#tb-r-book')), 'offered once, at the top, not again among the books');
  });
  await check('packing rules: added with a weekday and a starting week, listed with the next date, removed', async () => {
    await page.click('#tabs [data-tab="todos"]');
    if (await page.evaluate(() => document.getElementById('pk').hidden)) await page.click('#pk-toggle');
    await page.fill('#pk-item', 'sand socks'); await page.selectOption('#pk-for', 'Every day');
    await page.selectOption('#pk-when', '14'); await page.selectOption('#pk-on', 'mon');
    assert.deepStrictEqual(await page.$$eval('#pk-start option', o => o.map(x => x.textContent)), ['first Mon 12 Jan', 'first Mon 19 Jan']);
    await page.selectOption('#pk-start', '2026-01-19'); await page.click('#pk-form button'); await idle();
    await page.fill('#pk-item', 'lunchbox'); await page.selectOption('#pk-for', 'Work'); await page.selectOption('#pk-when', ''); await page.click('#pk-form button'); await idle();
    const rules = JSON.parse(repos['overblik-data']['packing.json']).rules;
    assert.deepStrictEqual(rules.map(r => [r.item, r.for, (r.on || []).join(), r.every || 0, r.from || '']),
      [['sand socks', 'Every day', 'mon', 14, '2026-01-19'], ['lunchbox', 'Work', '', 0, '']]);
    assert.deepStrictEqual(await page.$$eval('#pk-list li > span', e => e.map(x => x.textContent)),
      ['sand socks · every day out · every other Monday · next Mon 19 Jan', 'lunchbox · Work · every time · next Tue 6 Jan']);
    await page.click('#pk-list [data-pkdel] >> nth=1'); await idle();
    assert.ok(JSON.parse(repos['overblik-data']['packing.json']).rules.find(r => r.item === 'lunchbox').removed, 'removed is kept, so other devices learn it');
    assert.strictEqual(await page.textContent('#pk-count'), '1');
  });
  await shot('4-tankebaenken');
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

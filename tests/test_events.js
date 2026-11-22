// Events captured in Overblik: the day and time read from the text, events.json written for the Mac job.
// Made-up events, a mocked GitHub API. Run: node tests/test_events.js        (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST' };

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };
  const store = {};
  const handler = async route => {
    const req = route.request(); const p = new URL(req.url()).pathname.split('/contents/')[1];
    const sha = k => 'sha-' + k + '-' + (store['_v' + k] || 0);
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
  const ctx = await browser.newContext({ viewport: { width: 400, height: 1200 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await require('./_all_pages')(ctx);
  await ctx.clock.install({ time: new Date('2026-01-10T11:00:00+01:00') });   // a Saturday
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  await page.reload();
  const settle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !syncing, null, { timeout: 5000 }); };
  const parse = t => page.evaluate(t => { const e = parseEvent(t); return e && { date: e.date, start: e.start, end: e.end, title: e.title }; }, t);
  const pressed = () => page.$eval('.chip[aria-pressed="true"]', e => e.dataset.block);
  const type = async t => { await page.fill('#cap', ''); await page.type('#cap', t); };

  await check('day and time are read from Danish and English text; the rest is the title', async () => {
    assert.deepStrictEqual(await parse('i morgen 10-21 forældre'), { date: '2026-01-11', start: '10:00', end: '21:00', title: 'Forældre' });
    assert.deepStrictEqual(await parse('fredag kl 14 tandlæge'), { date: '2026-01-16', start: '14:00', end: '15:00', title: 'Tandlæge' });
    assert.deepStrictEqual(await parse('22/1 18.30-20 middag med S'), { date: '2026-01-22', start: '18:30', end: '20:00', title: 'Middag med S' });
    assert.deepStrictEqual(await parse('dinner 19:00-22:00 tomorrow'), { date: '2026-01-11', start: '19:00', end: '22:00', title: 'Dinner' });
    assert.deepStrictEqual(await parse('5 dec 10-12 julefrokost'), { date: '2026-12-05', start: '10:00', end: '12:00', title: 'Julefrokost' });
    assert.deepStrictEqual(await parse('fra 9 til 10.30 i overmorgen løb'), { date: '2026-01-12', start: '09:00', end: '10:30', title: 'Løb' });
  });
  await check('today\'s weekday means today, unless the time has passed; no day means the next time it comes', async () => {
    assert.strictEqual((await parse('lørdag 15-16 kaffe')).date, '2026-01-10');
    assert.strictEqual((await parse('lørdag 9-10 løb')).date, '2026-01-17');
    assert.deepStrictEqual(await parse('10-21'), { date: '2026-01-11', start: '10:00', end: '21:00', title: 'Event' });
    assert.strictEqual((await parse('kl 14 call')).date, '2026-01-10');
  });
  await check('no time, a time that cannot be, or past midnight is not an event', async () => {
    assert.strictEqual(await parse('Inviter til nytår 30 min'), null);
    assert.strictEqual(await parse('i morgen forældre'), null);
    assert.strictEqual(await parse('i morgen kl 25'), null);
    assert.strictEqual(await parse('i dag 23-1 fest'), null);
  });
  await check('a day and a time make the Event chip light up; a to-do stays a to-do', async () => {
    await type('i morgen 10-21 forældre'); assert.strictEqual(await pressed(), 'event');
    assert.strictEqual(await page.$eval('#ev-cal', e => e.hidden), false);
    assert.match(await page.textContent('#ev-prev'), /Sun 11 Jan · 10:00 to 21:00 · Forældre/);
    await type('Opsæt motionsfradrag til skat'); assert.strictEqual(await pressed(), 'praktisk');
    assert.strictEqual(await page.$eval('#ev-cal', e => e.hidden), true);
  });
  await check('saving writes events.json for the Mac job, in the calendar he picked, and not the inbox', async () => {
    await type('i morgen 10-21 forældre'); await page.selectOption('#ev-cal', 'S&M'); await page.press('#cap', 'Enter'); await settle();
    const ev = JSON.parse(store['events.json']).items;
    assert.strictEqual(ev.length, 1);
    assert.deepStrictEqual({ ...ev[0], id: 'x', created: 'x', updated: 'x' }, { id: 'x', title: 'Forældre', calendar: 'S&M', date: '2026-01-11', start: '10:00', end: '21:00', created: 'x', updated: 'x' });
    assert.match(ev[0].id, /^[A-Za-z0-9_-]{1,40}$/, 'an id the Mac job accepts');
    assert.ok(!(store['inbox.json'] || '').includes('forældre'));
    assert.match(await page.textContent('#ev-list'), /Sun 11 Jan 10:00 to 21:00 Forældre · S&M/);
    assert.strictEqual(await page.inputValue('#ev-cal'), 'Transport', 'the calendar goes back to Transport');
  });
  await check('an event without a time is not saved; the hint says what is missing', async () => {
    await page.click('.chip.event'); await page.fill('#cap', 'i morgen forældre'); await page.press('#cap', 'Enter'); await settle();
    assert.strictEqual(JSON.parse(store['events.json']).items.length, 1);
    assert.match(await page.textContent('#ev-prev'), /Add a time/);
    assert.strictEqual(await page.inputValue('#cap'), 'i morgen forældre', 'the text stays for him to fix');
  });
  await check('another device\'s event is kept; cancel marks it so the Mac job leaves it', async () => {
    const cur = JSON.parse(store['events.json']);
    cur.items.push({ id: 'other1', title: 'Padel', calendar: 'Transport', date: '2026-01-13', start: '07:00', end: '08:00', created: 'x', updated: '2026-01-10T10:00:00Z' });
    store['events.json'] = JSON.stringify(cur); store['_vevents.json'] = (store['_vevents.json'] || 0) + 1;
    await page.fill('#cap', ''); await page.click('#ev-list [data-evcancel]'); await settle();
    const ev = JSON.parse(store['events.json']).items;
    assert.strictEqual(ev.length, 2); assert.strictEqual(ev.find(e => e.title === 'Forældre').cancelled, true);
    assert.ok(!ev.find(e => e.id === 'other1').cancelled);
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n')); console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();

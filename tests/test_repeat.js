// Repeating to-dos: the interval read from his words or set in the edit form, done moves the next date on, and an item
// that keeps not getting done asks to be reconsidered. Made-up items, no network. Run: node tests/test_repeat.js
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 1600 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await require('./_all_pages')(ctx);
  await ctx.clock.install({ time: new Date('2026-01-10T11:00:00+01:00') });   // a Saturday
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(() => localStorage.setItem('overblik.items', JSON.stringify([
    { id: 'old', text: 'Ring til farmor', block: 'praktisk', created: '2025-12-01', updated: 'x', done: null, repeat: 7, due: '2025-12-25' },
    { id: 'old2', text: 'Rens filter', block: 'hus', created: '2025-12-01', updated: 'x', done: null, repeat: 7, due: '2025-12-20' },
    { id: 'later', text: 'Skift sengetøj', block: 'hus', created: '2025-12-01', updated: 'x', done: null, repeat: 14, due: '2026-01-15' },
    { id: 'plain', text: 'Køb pærer', block: 'hus', created: '2026-01-01', updated: 'x', done: null } ])));
  await page.reload();
  const item = t => page.evaluate(t => JSON.parse(localStorage.getItem('overblik.items')).find(i => i.text === t || i.id === t), t);
  const add = async t => { await page.fill('#cap', t); await page.press('#cap', 'Enter'); };
  // what is planned: Next up and the blocks in the backlog; the "Repeating, not due yet" list (26 Nov) is not planning
  const shown = () => page.evaluate(() => document.getElementById('groups').innerText + [...document.querySelectorAll('#backlog .group:not(.later)')].map(e => e.innerText).join(''));
  const later = () => page.evaluate(() => [...document.querySelectorAll('#backlog .group.later li')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));

  await check('the interval is read from his words, and the item is due now', async () => {
    await add('Vand planter hver weekend'); await add('Klip hår hver anden søndag'); await add('Billeder til farmor every other week'); await add('Betal husleje hver måned');
    assert.deepStrictEqual([(await item('Vand planter hver weekend')).repeat, (await item('Vand planter hver weekend')).due], [7, '2026-01-10']);
    assert.strictEqual((await item('Klip hår hver anden søndag')).repeat, 14);
    assert.strictEqual((await item('Billeder til farmor every other week')).repeat, 14);
    assert.strictEqual((await item('Betal husleje hver måned')).repeat, 30);
  });
  await check('an item that is not due yet stays out of Next up and the backlog', async () => {
    assert.ok(!(await shown()).includes('Skift sengetøj'));
    assert.ok((await later()).some(t => /^Skift sengetøj.*every other week · Thu 15 Jan \d+ m$/.test(t)), 'listed under Repeating with its rhythm and next date: ' + JSON.stringify(await later()));
    assert.ok((await shown()).includes('Køb pærer'));
  });
  await check('done moves a repeating item to its next date instead of ticking it off', async () => {
    await page.click('button.box[data-id="' + (await item('Vand planter hver weekend')).id + '"]');
    const it = await item('Vand planter hver weekend');
    assert.deepStrictEqual([it.done, it.due, it.count], [null, '2026-01-17', 1]);
    assert.ok(it.last && it.updated !== 'x');
    assert.ok(!(await shown()).includes('Vand planter'), 'gone until it is due again');
  });
  await check('the edit form sets or clears the interval', async () => {
    await page.click('button.txt[data-edit="plain"]'); await page.selectOption('#e-repeat', '7'); await page.click('#e-save');
    assert.deepStrictEqual([(await item('plain')).repeat, (await item('plain')).due], [7, '2026-01-10']);
    await page.click('button.txt[data-edit="plain"]'); await page.selectOption('#e-repeat', ''); await page.click('#e-save');
    assert.ok(!(await item('plain')).repeat);
  });
  await check('not done for two of its intervals: he is asked to keep it, do it less often or drop it', async () => {
    assert.ok(await page.$('[data-rc="old"]'), 'the question shows on the overdue item');
    assert.ok(!(await page.$('[data-rc="later"]')));
    await page.click('[data-rc="old"][data-v="less"]');
    const it = await item('old'); assert.deepStrictEqual([it.repeat, it.due], [14, '2026-01-10']);
    assert.ok(!(await page.$('[data-rc="old"]')), 'asked again only after two new intervals');
    await page.click('[data-rc="old2"][data-v="drop"]');
    const d = await item('old2'); assert.ok(d.done && !d.repeat, 'dropped: done, no longer repeating');
  });
  await check('every workday, every Monday, every other Monday, once per weekend (26 Nov)', async () => {
    const r = await page.evaluate(() => ['Pak madkasse hver hverdag', 'Every workday stretch', 'Løb hver dag', 'Padel every monday', 'Beach hver anden mandag', 'Vand planter hver weekend'].map(parseRepeat));
    assert.deepStrictEqual(r, [{ repeat: 1, on: ['mon', 'tue', 'wed', 'thu', 'fri'] }, { repeat: 1, on: ['mon', 'tue', 'wed', 'thu', 'fri'] }, { repeat: 1 },
      { repeat: 7, on: ['mon'] }, { repeat: 14, on: ['mon'] }, { repeat: 7, on: ['sat'] }]);
    const n = await page.evaluate(() => [
      nextDue('2026-01-09', 1, WORKDAYS),     // done Friday: next Monday
      nextDue('2026-01-12', 7, ['mon']),      // done on its Monday: the next Monday
      nextDue('2026-01-14', 7, ['mon']),      // done late on Wednesday: still the next Monday
      nextDue('2026-01-12', 14, ['mon']),     // every other Monday
      nextDue('2026-01-10', 7, ['sat']),      // a weekend item done Saturday: next Saturday, not Sunday
      firstOn('2026-01-10', WORKDAYS)]);      // captured on a Saturday: first due Monday
    assert.deepStrictEqual(n, ['2026-01-12', '2026-01-19', '2026-01-19', '2026-01-26', '2026-01-17', '2026-01-12']);
  });
  await check('the edit form offers every workday and a weekday', async () => {
    if (await page.evaluate(() => document.getElementById('backlog').hidden)) await page.click('#b-toggle');   // earlier checks filled Next up
    await page.click('button.txt[data-edit="plain"]'); await page.selectOption('#e-repeat', 'wd'); await page.click('#e-save');
    let it = await item('plain'); assert.deepStrictEqual([it.repeat, it.on, it.due], [1, ['mon', 'tue', 'wed', 'thu', 'fri'], '2026-01-12']);
    await page.evaluate(() => { editing = 'plain'; render(); });   // not due until Monday, so it is out of the lists: open its form directly
    await page.selectOption('#e-repeat', '14'); await page.selectOption('#e-on', 'thu'); await page.click('#e-save');
    it = await item('plain'); assert.deepStrictEqual([it.repeat, it.on, it.due], [14, ['thu'], '2026-01-15']);
    await page.evaluate(() => { editing = 'plain'; render(); }); await page.selectOption('#e-repeat', ''); await page.click('#e-save');
    it = await item('plain'); assert.ok(!it.repeat && !it.on && it.norepeat, 'No repeat is remembered, so the words are not read again');
  });
  await check('older items get the repeat their words say, once; packing rules and app wishes do not', async () => {
    const out = await page.evaluate(() => { const l = [
      { id: 'a', text: 'Vand planter hver weekend', block: 'praktisk', done: null },
      { id: 'b', text: 'Billeder til farmor men en gang hver anden uge cirka', block: 'praktisk', done: null },
      { id: 'c', text: 'Every workday I want to bring a tupper ware box', block: 'hus', done: null },
      { id: 'd', text: 'Socks every other week', block: 'app', done: null },
      { id: 'e', text: 'Klip hår hver søndag', block: 'praktisk', done: null, norepeat: true } ];
      const n = repeatFromText(l); return [n, l.map(i => [i.repeat || 0, (i.on || []).join(), i.due || ''])]; });
    assert.deepStrictEqual(out, [2, [[7, 'sat', '2026-01-10'], [14, '', '2026-01-10'], [0, '', ''], [0, '', ''], [0, '', '']]]);
  });
  await check('a ticked app wish is kept under Built with its date', async () => {
    await page.evaluate(() => { items.push({ id: 'w1', text: 'Tabs at the top', block: 'app', created: '2026-01-02', updated: 'x', done: '2026-01-05T10:00:00Z' }); render(); });
    assert.match(await page.textContent('details.built'), /Built \(1\)\s*2026-01-05 Tabs at the top/);
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n')); console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();

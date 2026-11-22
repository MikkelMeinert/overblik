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
  const shown = () => page.evaluate(() => document.getElementById('groups').innerText + document.getElementById('backlog').innerText);

  await check('the interval is read from his words, and the item is due now', async () => {
    await add('Vand planter hver weekend'); await add('Klip hår hver anden søndag'); await add('Billeder til farmor every other week'); await add('Betal husleje hver måned');
    assert.deepStrictEqual([(await item('Vand planter hver weekend')).repeat, (await item('Vand planter hver weekend')).due], [7, '2026-01-10']);
    assert.strictEqual((await item('Klip hår hver anden søndag')).repeat, 14);
    assert.strictEqual((await item('Billeder til farmor every other week')).repeat, 14);
    assert.strictEqual((await item('Betal husleje hver måned')).repeat, 30);
  });
  await check('an item that is not due yet stays out of Next up and the backlog', async () => {
    assert.ok(!(await shown()).includes('Skift sengetøj'));
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
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n')); console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();

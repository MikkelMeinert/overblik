// Capture that sorts itself: the block guessed while typing. Made-up items.
// Run: node tests/test_capture.js        (exit code 0 = all checks passed)
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
  const ctx = await browser.newContext({ timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP);
  await page.evaluate(() => localStorage.setItem('overblik.items', JSON.stringify([
    { id: '1', text: 'Kalendergaver til mor', block: 'praktisk', created: '2026-01-01', updated: 'x', done: null },
    { id: '2', text: 'Ophæng af spejl i gangen', block: 'hus', created: '2026-01-01', updated: 'x', done: '2026-01-02T10:00:00Z' },
    { id: '3', text: 'Tænk over næste skridt i jobbet', block: 'fremtid', created: '2026-01-01', updated: 'x', done: null } ])));
  await page.reload();
  const pressed = () => page.$eval('.chip[aria-pressed="true"]', e => e.dataset.block);
  const type = async t => { await page.fill('#cap', ''); await page.type('#cap', t); };

  await check('his own filing decides: words he used before go to the same block', async () => {
    await type('Spejl i soveværelset'); assert.strictEqual(await pressed(), 'hus');
    await type('Næste skridt med pensionen'); assert.strictEqual(await pressed(), 'fremtid');
    await type('Gaver til far'); assert.strictEqual(await pressed(), 'praktisk');
  });
  await check('seed words when he has filed nothing like it', async () => {
    await type('Reparer cykeldæk (30m)'); assert.strictEqual(await pressed(), 'hus');
    await type('Overvej ny karriere'); assert.strictEqual(await pressed(), 'fremtid');
  });
  await check('no signal is Praktisk', async () => {
    await type('Ring til banken'); assert.strictEqual(await pressed(), 'praktisk');
  });
  await check('a chip he taps wins until the item is saved', async () => {
    await type('Ring til '); await page.click('.chip.fremtid'); await page.type('#cap', 'banken');
    assert.strictEqual(await pressed(), 'fremtid');
    await page.press('#cap', 'Enter');
    const it = await page.evaluate(() => JSON.parse(localStorage.getItem('overblik.items')).find(i => i.text === 'Ring til banken'));
    assert.strictEqual(it.block, 'fremtid');
    assert.strictEqual(await pressed(), 'praktisk', 'reset after saving');
    await page.type('#cap', 'Mal stuen'); assert.strictEqual(await pressed(), 'hus', 'guessing again for the next item');
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

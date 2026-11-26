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
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n').slice(0,8).join(' ')); }
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'Europe/Copenhagen', locale: 'en-GB' });
  await require('./_all_pages')(ctx);
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
  await check('the backlog is folded until he opens it, and stays as he left it', async () => {
    assert.strictEqual(await page.$eval('#backlog', e => e.hidden), true);
    assert.strictEqual(await page.getAttribute('#b-toggle', 'aria-expanded'), 'false');
    await page.click('#b-toggle');
    assert.strictEqual(await page.$eval('#backlog', e => e.hidden), false);
    await page.reload();
    assert.strictEqual(await page.$eval('#backlog', e => e.hidden), false, 'open after a reload');
    await page.click('#b-toggle'); assert.strictEqual(await page.$eval('#backlog', e => e.hidden), true);
  });
  await check('tapping an item\'s text edits it: new words and another block, not done', async () => {
    await page.click('button.txt[data-edit="1"]');
    assert.strictEqual(await page.$eval('[data-id="1"].box', () => 1), 1);
    await page.fill('#e-text', 'Kalendergaver til mor og far (20m)'); await page.selectOption('#e-block', 'hus'); await page.click('#e-save');
    const it = await page.evaluate(() => JSON.parse(localStorage.getItem('overblik.items')).find(i => i.id === '1'));
    assert.strictEqual(it.text, 'Kalendergaver til mor og far (20m)'); assert.strictEqual(it.block, 'hus'); assert.strictEqual(it.done, null);
    assert.notStrictEqual(it.updated, 'x', 'updated, so the newest wins on merge');
    assert.ok(!(await page.$('#e-text')), 'editor closed');
  });
  await check('cancel leaves the item as it was', async () => {
    await page.click('button.txt[data-edit="3"]'); await page.fill('#e-text', 'something else'); await page.click('#e-cancel');
    const it = await page.evaluate(() => JSON.parse(localStorage.getItem('overblik.items')).find(i => i.id === '3'));
    assert.strictEqual(it.text, 'Tænk over næste skridt i jobbet');
  });
  await check('wishes for the app get their own chip and list, out of the to-do blocks', async () => {
    await type('Feature for the app: dark mode'); assert.strictEqual(await pressed(), 'app');
    await page.press('#cap', 'Enter');
    const it = await page.evaluate(() => JSON.parse(localStorage.getItem('overblik.items')).find(i => i.text === 'Feature for the app: dark mode'));
    assert.strictEqual(it.block, 'app');
    assert.ok(!(await page.textContent('#groups')).includes('dark mode'), 'not in Next up');
    assert.strictEqual(await page.$eval('#apps', e => e.hidden), true, 'folded');
    await page.click('#a-toggle'); assert.match(await page.textContent('#apps'), /dark mode/);
    assert.match(await page.textContent('#a-count'), /1 open/);
  });
  await check('an item can be moved into the App list by editing it', async () => {
    await page.click('button.txt[data-edit="3"]'); await page.selectOption('#e-block', 'app'); await page.click('#e-save');
    assert.match(await page.textContent('#apps'), /næste skridt/);
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

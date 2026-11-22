// Service worker and evening push. Serves the app over http://127.0.0.1 (a service worker needs http or https),
// mocks the GitHub Contents API, and stubs the browser's push service, which a test browser cannot reach.
// Run: node tests/test_push.js        (exit code 0 = all checks passed)
const { chromium } = require('playwright');
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.resolve(__dirname, '..');
const CFG = { owner: 'someone', repo: 'overblik-data', branch: 'main', token: 'github_pat_TEST' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

(async () => {
  const results = []; let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); results.push('ok    ' + name); }
    catch (e) { failed++; results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
  };

  // ---- the service worker on its own: install list, cache name, push and click handlers
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  await check('sw.js: a versioned cache name and the whole shell', async () => {
    assert.match(sw, /const CACHE = "overblik-v\d+";/);
    for (const f of ['index.html', 'manifest.webmanifest', 'icon-180.png']) assert.ok(sw.includes(`"${f}"`), f);
  });
  await check('sw.js: a push shows one notification with the body and a link to the app', async () => {
    const on = {}, shown = [];
    const self = { addEventListener: (t, f) => { on[t] = f; }, registration: { scope: 'https://x.test/overblik/', showNotification: (t, o) => { shown.push([t, o]); return Promise.resolve(); } },
      location: { origin: 'https://x.test' }, clients: {}, skipWaiting() {} };
    vm.runInNewContext(sw, { self, caches: {}, fetch: () => {}, URL, Promise });
    let wait; on.push({ data: { json: () => ({ title: 'Overblik', body: 'Sun 22 Nov: nothing to decide', url: './#tomorrow' }) }, waitUntil: p => { wait = p; } });
    await wait;
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0][1].body, 'Sun 22 Nov: nothing to decide');
    assert.strictEqual(shown[0][1].tag, 'overblik-evening', 'a later push replaces the earlier one');
    assert.strictEqual(shown[0][1].data.url, './#tomorrow');
    on.push({ data: { json: () => { throw new Error('x'); }, text: () => 'plain text' }, waitUntil: p => { wait = p; } });
    await wait;
    assert.strictEqual(shown[1][1].body, 'plain text', 'a payload that is not JSON still shows');
  });

  // ---- the app over http
  const server = http.createServer((req, res) => {
    const f = path.join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URLAPP = `http://127.0.0.1:${server.address().port}/`;

  const repo = {}; let n = 0; const puts = [];
  const handler = async route => {
    const req = route.request(); const p = new URL(req.url()).pathname.split('/contents/')[1];
    if (req.method() === 'GET') {
      if (!repo[p]) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: repo[p].sha, content: Buffer.from(repo[p].text).toString('base64') }) });
    }
    const body = JSON.parse(req.postData());
    if (repo[p] && body.sha !== repo[p].sha) return route.fulfill({ status: 409, body: '{}' });
    repo[p] = { sha: 's' + (++n), text: Buffer.from(body.content, 'base64').toString('utf8') }; puts.push(p + ': ' + body.message);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: repo[p].sha } }) });
  };
  const errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, timezoneId: 'Europe/Copenhagen', locale: 'en-GB', serviceWorkers: 'allow' });
  await require('./_all_pages')(ctx);
  await ctx.route('https://api.github.com/**', handler);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ status: 200, body: '' }));
  // the push service is out of reach in a test browser: subscribe and getSubscription are stubbed, permission is granted
  await ctx.addInitScript(() => {
    let current = null; window.__subscribeArgs = [];
    let perm = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => perm });
    Notification.requestPermission = async () => (perm = 'granted');
    PushManager.prototype.getSubscription = async function () { return current; };
    PushManager.prototype.subscribe = async function (o) {
      window.__subscribeArgs.push(o.applicationServerKey.length);
      current = { toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: async () => { current = null; return true; } };
      return current;
    };
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(URLAPP);
  await page.evaluate(cfg => localStorage.setItem('overblik.cfg', JSON.stringify(cfg)), CFG);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true), null, { timeout: 8000 });
  await page.evaluate(() => navigator.serviceWorker.ready);

  await check('the service worker registers and takes control', async () => {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
  });
  await check('offline, the app still opens from the cache', async () => {
    await ctx.setOffline(true);
    await page.reload();
    assert.ok(await page.$('#cap'), 'the capture box is there');
    assert.strictEqual(await page.title(), 'Overblik');
    await ctx.setOffline(false);
  });

  await page.reload();
  await page.click('#f-setup');
  await page.waitForFunction(() => document.getElementById('p-msg').textContent === 'off', null, { timeout: 5000 });
  await page.click('#p-toggle');
  await page.waitForFunction(() => document.getElementById('p-msg').textContent === 'on for this device', null, { timeout: 5000 });

  await check('turning push on writes one subscription for this device to push.json', async () => {
    const subs = JSON.parse(repo['push.json'].text).subscriptions;
    assert.strictEqual(subs.length, 1);
    assert.strictEqual(subs[0].endpoint, 'https://push.example/abc');
    assert.deepStrictEqual(subs[0].keys, { p256dh: 'P', auth: 'A' });
    assert.ok(subs[0].device_id && subs[0].device, 'device id and name');
    assert.deepStrictEqual(await page.evaluate(() => window.__subscribeArgs), [65], 'the VAPID public key is a 65-byte P-256 point');
    assert.strictEqual(await page.textContent('#p-toggle'), 'Turn off evening push');
  });
  await check('another device keeps its own entry', async () => {
    const other = { device_id: 'other', device: 'Mac', endpoint: 'https://push.example/mac', keys: { p256dh: 'Q', auth: 'B' } };
    const cur = JSON.parse(repo['push.json'].text); cur.subscriptions.push(other);
    repo['push.json'] = { sha: 's' + (++n), text: JSON.stringify(cur) };
    await page.click('#p-toggle');
    await page.waitForFunction(() => document.getElementById('p-msg').textContent === 'off', null, { timeout: 5000 });
    const subs = JSON.parse(repo['push.json'].text).subscriptions;
    assert.deepStrictEqual(subs.map(s => s.device_id), ['other'], 'turning off removes only this device');
    assert.match(puts[puts.length - 1], /^push\.json: overblik: push \(1 device\)$/);
  });
  await check('no page errors', async () => assert.deepStrictEqual(errs, []));

  await browser.close(); server.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

// Turning on MAC filtering: the warning, the "how to find your MAC address" pop-up and back,
// cancel and confirm, adding this device, and nothing saved until Save.
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { sleep, check, makeApp, server, page, done } = require('../helpers/app.js');

(async () => {
  const env = makeApp();
  const s = server(env);
  await s.start();
  const cfg = () => JSON.parse(fs.readFileSync(path.join(env.APP, 'data/config.json'), 'utf8')).macFiltering;
  const c = await page(connect, { width: 1280, height: 900 });
  await c.login(env.base);
  await c.go(env.base + '/admin/settings');
  await c.until(`!!document.querySelector('#mac-toggle')`);
  const dialogTitle = `document.querySelector('.dialog h2')?.textContent ?? ''`;
  const toggle = () => c.evaluate(`document.querySelector('#mac-toggle').click()`);
  const checked = () => c.evaluate(`document.querySelector('#mac-toggle').checked`);

  await toggle();
  await c.until(`${dialogTitle} === 'Turn on MAC filtering?'`, 3000);
  let text = await c.evaluate(`document.querySelector('.dialog').innerText`);
  check('ticking the box: a warning to add your own MAC address first', /add its MAC address to the\s+approved list first/.test(text) && /lock yourself out/.test(text), text.slice(0, 120).replace(/\n/g, ' '));
  check('opened on the Pi itself (localhost): says this device stays allowed', /on the noticeboard Pi itself/.test(text));
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-mac-warning.png'));

  await c.click('How to find your MAC address');
  await c.until(`${dialogTitle} === 'How to find your MAC address'`, 2000);
  text = await c.evaluate(`document.querySelector('.dialog').innerText`);
  check('"How to find your MAC address" replaces it with Windows, Mac and Linux steps', ['Windows', 'getmac /v', 'Mac', 'ifconfig en0', 'Linux', 'ip link'].every((w) => text.includes(w)) && (await c.evaluate(`document.querySelectorAll('.dialog').length`)) === 1);
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-mac-howto.png'));
  await c.click('OK');
  check('OK goes back to the warning', await c.until(`${dialogTitle} === 'Turn on MAC filtering?'`, 2000));
  await c.click('How to find your MAC address');
  await c.until(`${dialogTitle} === 'How to find your MAC address'`, 2000);
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check('Esc on the how-to also goes back to the warning', await c.until(`${dialogTitle} === 'Turn on MAC filtering?'`, 2000));

  await c.click('Cancel');
  await sleep(200);
  check('Cancel: pop-up gone, the box unticked, nothing saved', !(await c.evaluate(`!!document.querySelector('.dialog')`)) && !(await checked()) && cfg().enabled === false);
  await toggle();
  await c.until(`${dialogTitle} === 'Turn on MAC filtering?'`, 2000);
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(200);
  check('Esc on the warning cancels too', !(await checked()) && !(await c.evaluate(`!!document.querySelector('.dialog')`)));

  await toggle();
  await c.until(`${dialogTitle} === 'Turn on MAC filtering?'`, 2000);
  await c.click('Turn on MAC filtering');
  await sleep(200);
  check('Confirm: the box stays ticked, and it says Save is needed', (await checked()) && /starts once you click Save/.test(await c.evaluate(`document.body.innerText`)) && cfg().enabled === false);
  await toggle();   // unticking needs no warning
  await sleep(200);
  check('unticking asks nothing', !(await c.evaluate(`!!document.querySelector('.dialog')`)) && !(await checked()));

  // Seen from another device: the server's view of this device's MAC, faked
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/settings/my-device*' }] });
  c.on(async (msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    await c.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ local: false, mac: 'aa:bb:cc:dd:ee:ff' })).toString('base64') });
  });
  await toggle();
  await c.until(`/isn't on the list yet/.test(document.querySelector('.dialog')?.innerText ?? '')`, 3000);
  check('from another device: shows its MAC address and offers to add it', (await c.evaluate(`document.querySelector('.dialog').innerText`)).includes('aa:bb:cc:dd:ee:ff'));
  await c.click('Add it to the list');
  check('"Add it to the list": added, and the pop-up says so', await c.until(`/already on the approved list/.test(document.querySelector('.dialog').innerText) && document.body.innerText.includes('This device')`, 2000));
  await c.click('Turn on MAC filtering');
  await c.evaluate(`[...document.querySelectorAll('.card')].find((x) => x.querySelector('h2')?.textContent === 'MAC filtering').querySelector('.btn-primary').click()`);
  await sleep(800);
  const saved = cfg();
  check('Save: filtering on, with this device approved', saved.enabled === true && saved.approved.some((a) => a.mac === 'aa:bb:cc:dd:ee:ff' && a.label === 'This device'), JSON.stringify(saved.approved));
  await c.send('Fetch.disable');

  // Addresses copied from Windows (dashes) are stored with colons
  await c.evaluate(`(() => { const i = document.querySelector('input[placeholder="aa:bb:cc:dd:ee:ff"]'); i.value = '1A-2B-3C-4D-5E-6F'; i.dispatchEvent(new Event('input')); })()`);
  await c.click('Add');
  check('a Windows-style address (dashes) is added with colons', (await c.evaluate(`document.body.innerText`)).includes('1a:2b:3c:4d:5e:6f'));

  // On a phone, the pop-ups fit
  await c.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await toggle(); await toggle();
  await c.until(`${dialogTitle} === 'Turn on MAC filtering?'`, 2000);
  await c.click('How to find your MAC address');
  await sleep(300);
  const fits = await c.evaluate(`(() => { const r = document.querySelector('.dialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`);
  check('phone: the pop-ups fit the screen', fits);
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-mac-howto-phone.png'));
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

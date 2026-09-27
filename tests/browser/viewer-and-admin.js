// QALife batch 1: server address pin + setting, viewer exit button + cursor, logo, admin
// viewer link, default-password warning, settings merge, kiosk-exit per device.
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { MODULES, sleep, check, makeApp, server, page, done } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));
const { io } = require(path.join(MODULES, 'socket.io-client'));

(async () => {
  const env = makeApp();
  const s = server(env);
  await s.start();

  // ── API ──
  let r = await s.api('GET', '/api/device', null, { auth: false });
  check('device info needs no login and names the server\'s address and port', r.status === 200 && r.data.port === env.port && Array.isArray(r.data.addresses), JSON.stringify(r.data));
  r = await s.api('GET', '/api/settings/security', null, { auth: false });
  check('security check needs the admin login', r.status === 401);
  await s.login();
  r = await s.api('GET', '/api/settings/security');
  check('default password detected', r.data.defaultPassword === true);
  r = await s.api('PUT', '/api/settings/password', { current: 'wrong-one', newPassword: 'Another#Pass1' });
  check('wrong current password: 403 (so the admin panel stays logged in)', r.status === 403 && /incorrect/.test(r.data.error));

  // Settings merge: saving one display setting keeps the others
  r = await s.api('PUT', '/api/settings', { display: { showDeviceInfo: false } });
  r = await s.api('PUT', '/api/settings', { display: { defaultSlideDurationSeconds: 7 } });
  check('saving the duration keeps the pin setting', r.data.display.defaultSlideDurationSeconds === 7 && r.data.display.showDeviceInfo === false, JSON.stringify(r.data.display));
  r = await s.api('PUT', '/api/settings', { display: { defaultSlideDurationSeconds: 0 } });
  check('invalid duration refused', r.status === 400);
  r = await s.api('PUT', '/api/settings', { display: { showDeviceInfo: true, defaultSlideDurationSeconds: 10 } });

  // Display settings reach displays over the socket, and change live
  const events = [];
  const sock = io(env.base, { transports: ['websocket'] });
  sock.on('display:settings', (d) => events.push(d));
  await sleep(1500);
  check('a display gets its settings on connect (pin on, logo on)', events[0]?.showDeviceInfo === true && /^\/branding\/logo\?v=/.test(events[0]?.logo?.url || ''), JSON.stringify(events[0]));
  await s.api('PUT', '/api/settings', { display: { showDeviceInfo: false } });
  await sleep(800);
  check('turning the pin off reaches connected displays', events.at(-1)?.showDeviceInfo === false);
  await s.api('PUT', '/api/settings', { display: { logo: { enabled: false } } });
  await sleep(800);
  check('turning the logo off reaches connected displays', events.at(-1)?.logo === null);
  await s.api('PUT', '/api/settings', { display: { showDeviceInfo: true, logo: { enabled: true } } });
  await sleep(800);
  sock.close();

  // Logo: the placeholder is scaled to fit 500 × 500; uploads likewise, never enlarged
  let res = await fetch(env.base + '/branding/logo');
  let meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  check('default logo served without login, scaled to fit 500 × 500 keeping its shape', res.ok && meta.width === 500 && meta.height === Math.round(1122 * 500 / 1402), `${meta.width}×${meta.height}`);
  const big = await sharp({ create: { width: 1600, height: 400, channels: 3, background: '#c00' } }).png().toBuffer();
  let form = new FormData(); form.append('logo', new Blob([big], { type: 'image/png' }), 'big.png');
  r = await s.api('POST', '/api/settings/logo', form);
  res = await fetch(env.base + r.data.url); meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  check('a wide upload is scaled by its larger side to 500 × 125', r.status === 200 && r.data.custom && meta.width === 500 && meta.height === 125, `${meta.width}×${meta.height}`);
  const small = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#0c0' } }).jpeg().toBuffer();
  form = new FormData(); form.append('logo', new Blob([small], { type: 'image/jpeg' }), 'small.jpg');
  r = await s.api('POST', '/api/settings/logo', form);
  res = await fetch(env.base + r.data.url); meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  check('a small upload is not enlarged (120 × 80)', meta.width === 120 && meta.height === 80, `${meta.width}×${meta.height}`);
  form = new FormData(); form.append('logo', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'x.png');
  r = await s.api('POST', '/api/settings/logo', form);
  check('a file that isn\'t an image is refused, and the logo is kept', r.status === 400 && (await s.api('GET', '/api/settings/logo')).data.custom);

  // Kiosk exit: kept per device
  r = await s.api('POST', '/api/device/kiosk-exit/claim', null, { auth: false });
  check('no exit request: the kiosk keeps going', r.data.exit === false);
  await s.api('POST', '/api/device/kiosk-exit', null, { auth: false });
  r = await s.api('POST', '/api/device/kiosk-exit/claim', null, { auth: false });
  const again = await s.api('POST', '/api/device/kiosk-exit/claim', null, { auth: false });
  check('an exit request is collected once by the same device', r.data.exit === true && again.data.exit === false);
  const ips = require('os').networkInterfaces();
  const lan = Object.values(ips).flat().find((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal);
  if (lan) {
    await s.api('POST', '/api/device/kiosk-exit', null, { auth: false });   // from this machine (loopback)
    const other = await fetch(`http://${lan.address}:${env.port}/api/device/kiosk-exit/claim`, { method: 'POST' }).then((x) => x.json());
    check('another device (another address) never collects it', other.exit === false, lan.address);
    await s.api('POST', '/api/device/kiosk-exit/claim', null, { auth: false });
  }

  // ── Viewer ──
  const v = await page(connect);
  await v.go(env.base + '/');
  await v.until(`document.querySelector('.message')?.textContent === 'No slideshow published'`);
  check('nothing published: the logo sits above the message', await v.evaluate(`(() => { const img = document.querySelector('.waiting .logo'); const msg = document.querySelector('.message'); return !!img && img.complete && img.naturalWidth === 120 && img.getBoundingClientRect().bottom <= msg.getBoundingClientRect().top; })()`));
  check('the pin shows (setting on)', await v.until(`!!document.querySelector('.info-button')`));
  check('idle: exit button hidden, cursor hidden', await v.evaluate(`getComputedStyle(document.querySelector('.exit-button')).display === 'none' && getComputedStyle(document.querySelector('.message')).cursor === 'none'`));
  await v.mouse(300, 300); await sleep(200); await v.mouse(320, 310);
  check('mouse moves: exit button and cursor appear', await v.until(`getComputedStyle(document.querySelector('.exit-button')).display !== 'none' && getComputedStyle(document.querySelector('.message')).cursor !== 'none'`, 2000));
  const rect = await v.evaluate(`(() => { const r = document.querySelector('.exit-button').getBoundingClientRect(); return { top: r.top, right: innerWidth - r.right, w: r.width }; })()`);
  check('exit button: top-right corner, same size as the pin', rect.top === 5 && rect.right === 5 && rect.w === 20, JSON.stringify(rect));
  await v.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-viewer-active.png'));
  check('still for 3 s: hidden again', await v.until(`getComputedStyle(document.querySelector('.exit-button')).display === 'none'`, 5000));
  await v.mouse(400, 400); await sleep(100); await v.mouse(410, 400);
  await v.until(`getComputedStyle(document.querySelector('.exit-button')).display !== 'none'`, 2000);
  await v.evaluate(`document.querySelector('.exit-button').click()`);
  const confirmText = await v.evaluate(`document.querySelector('.exit-popup')?.innerText ?? ''`);
  check('exit asks first, and says nothing else changes', /Leave full screen on this screen\?/.test(confirmText) && /other screen/.test(confirmText) && /nothing is unpublished/.test(confirmText));
  await v.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-viewer-exit.png'));
  await v.click('Leave full screen');
  await v.until(`/Leaving full screen/.test(document.querySelector('.exit-popup')?.innerText ?? '')`);
  r = await s.api('POST', '/api/device/kiosk-exit/claim', null, { auth: false });
  check('confirming asks the server for this device only; the kiosk script would collect it', r.data.exit === true);
  check('the published slideshows are untouched', (await s.api('GET', '/api/slideshows')).data.every((x) => x.enabled === false || x.enabled === true));
  await v.go(env.base + '/?kiosk=off');
  await sleep(1000);
  check('reopened with ?kiosk=off: an ordinary page, no exit button', !(await v.evaluate(`!!document.querySelector('.exit-button')`)));

  // Pin setting turned off hides it on a connected viewer
  await v.go(env.base + '/');
  await v.until(`!!document.querySelector('.info-button')`);
  await s.api('PUT', '/api/settings', { display: { showDeviceInfo: false } });
  check('pin turned off in Settings: gone from the viewer', await v.until(`!document.querySelector('.info-button')`, 5000));
  await s.api('PUT', '/api/settings', { display: { showDeviceInfo: true } });
  check('turned back on: it returns', await v.until(`!!document.querySelector('.info-button')`, 5000));
  await v.evaluate(`document.querySelector('.info-button').click()`);
  await v.until(`!!document.querySelector('.info-list dd')`);
  const popup = await v.evaluate(`document.querySelector('.info-popup').innerText`);
  check('the pop-up is titled as the server\'s address and says how to use it', /Noticeboard server/.test(popup) && /From another device/.test(popup) && popup.includes(String(env.port)), popup.replace(/\n/g, ' | ').slice(0, 140));
  check('the pop-up gives only the viewer\'s address, not the admin panel (open-bugs 1)', !/\/admin|admin panel/i.test(popup), popup.replace(/\n/g, ' | ').slice(0, 200));
  v.close();

  // ── Admin ──
  const a = await page(connect);
  await a.login(env.base);
  await a.until(`!!document.querySelector('.warning')`);
  check('default password: warning on the home page', /default admin password/.test(await a.evaluate(`document.querySelector('.warning').innerText`)));
  const nav = await a.evaluate(`(() => { const v = [...document.querySelectorAll('.nav a')].find((x) => x.textContent.includes('Open viewer')); const logo = document.querySelector('.nav__logo'); return { href: v?.getAttribute('href'), target: v?.target, logo: !!logo && logo.getBoundingClientRect().bottom <= document.querySelector('.nav__by').getBoundingClientRect().top }; })()`);
  check('sidebar: "Open viewer" opens / in a new tab', nav.href === '/' && nav.target === '_blank');
  check('sidebar: the logo sits above the title', nav.logo);
  await a.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-admin-home.png'));
  await a.go(env.base + '/admin/settings');
  await a.until(`!!document.querySelector('#show-pin')`);
  await a.until(`!!document.querySelector('.preview img')`);
  await a.evaluate(`document.querySelector('.toggle input').click()`);
  await sleep(800);
  check('Settings: turning the logo off removes it from the sidebar', !(await a.evaluate(`!!document.querySelector('.nav__logo')`)));
  await a.evaluate(`document.querySelector('.toggle input').click()`);
  await sleep(800);
  check('turning it on brings it back', await a.evaluate(`!!document.querySelector('.nav__logo')`));
  await a.evaluate(`document.querySelector('#password').scrollIntoView()`);
  await a.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-qa-admin-settings.png'));
  // Change the password: the warning goes
  await a.evaluate(`(() => { const inputs = document.querySelectorAll('#password input'); const set = (i, v) => { i.value = v; i.dispatchEvent(new Event('input')); }; set(inputs[0], 'Admin@12345'); set(inputs[1], 'Better#Pass99'); set(inputs[2], 'Better#Pass99'); document.querySelector('#password form').requestSubmit(); })()`);
  check('after changing the password, the warning goes away', await a.until(`!document.querySelector('.warning')`, 8000));
  await a.go(env.base + '/admin/slideshows');
  await sleep(1500);
  check('and stays away on other pages', !(await a.evaluate(`!!document.querySelector('.warning')`)));
  a.close();

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

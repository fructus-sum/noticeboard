// The updater's warnings are on every admin page (SYSTEM_DESIGN §3.6), and the viewer shows a
// warning mark while the installer needs running again (§3.5): "back on main" and "Run the
// installer again on this Pi" on the Slideshows, slideshow and Settings pages but not the login
// page; closing "back on main" closes it on every page; the red triangle in the viewer's
// bottom-right corner, about 20 px, with only "Please check the Admin panel for details.", gone
// once the installer has run.
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3940 });
  // The installer last ran one version before the one this version needs (system-requirements.json)
  const NEEDED = require('../../system-requirements.json').installer.version;
  const record = (version) => fs.writeFileSync(path.join(env.APP, 'data/installer.json'),
    JSON.stringify({ version, branch: 'main', commit: 'x', time: '2026-09-01T10:00:00Z' }));
  record(NEEDED - 1);
  fs.writeFileSync(path.join(env.APP, 'data/update-notice.json'), JSON.stringify({
    type: 'branch-merged', branch: 'feature/a', commit: 'x', time: '2026-09-26T16:00:00Z',
    message: 'The branch feature/a has been merged into main, so its features are now part of main.',
  }));
  const s = server(env);
  await s.start();
  await s.login();
  const folder = (await s.api('POST', '/api/slideshows', { name: 'Warnings' })).data.folder;

  const c = await page(connect, { width: 1280, height: 800 });
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCookies');
  await c.login(env.base);
  const notices = `[!!document.querySelector('.page-notices .notice'), !!document.querySelector('.page-notices .installer')]`;
  for (const [name, url] of [['Slideshows', '/admin/slideshows'], ['a slideshow', `/admin/slideshows/${folder}`], ['Settings', '/admin/settings']]) {
    await c.go(env.base + url);
    await c.until(`${notices}.every(Boolean)`, 8000);
    const [merged, installer] = await c.evaluate(notices);
    check(`${name} page: both notices shown`, merged && installer, `back on main ${merged}, installer ${installer}`);
  }
  // Moving between pages inside the admin panel (no reload): still there
  await c.evaluate(`document.querySelector('a[href="/admin/slideshows"]')?.click()`);
  await sleep(600);
  check('after moving to another page: still shown', (await c.evaluate(notices)).every(Boolean));
  // Closing "back on main" closes it on every page
  await c.evaluate(`document.querySelector('.notice__close').click()`);
  await c.until(`!document.querySelector('.page-notices .notice')`, 5000);
  await c.go(env.base + '/admin/settings');
  await c.until(`!!document.querySelector('.page-notices .installer')`, 8000);
  check('"back on main" closed: gone from the other pages too', !(await c.evaluate(`!!document.querySelector('.page-notices .notice')`)));
  // Not on the login page
  await c.send('Network.clearBrowserCookies');
  await c.go(env.base + '/admin/login');
  await c.until(`!!document.querySelector('input[type=password]')`, 8000);
  check('the login page: no notices', !(await c.evaluate(`!!document.querySelector('.page-notices, .installer, .notice')`)));
  c.close();

  // The viewer's warning mark
  const v = await page(connect, { width: 1280, height: 720 });
  await v.go(env.base + '/?kiosk=off');
  const shown = await v.until(`!!document.querySelector('.installer-warning')`, 8000);
  const box = shown ? await v.evaluate(`(() => { const r = document.querySelector('.installer-warning svg').getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom, w: r.width, h: r.height, color: getComputedStyle(document.querySelector('.installer-warning path')).fill }; })()`) : null;
  check('viewer: a red triangle in the bottom-right corner, about 20 px',
    shown && box.w === 20 && box.h === 20 && box.right < 20 && box.bottom < 20 && box.color === 'rgb(220, 38, 38)', JSON.stringify(box));
  await v.evaluate(`document.querySelector('.installer-warning').click()`);
  await v.until(`!!document.querySelector('.installer-popup')`, 3000);
  const message = await v.evaluate(`document.querySelector('.installer-popup').innerText.replace('×', '').trim()`);
  check('clicking it shows only "Please check the Admin panel for details."', message === 'Please check the Admin panel for details.', JSON.stringify(message));
  await v.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check('Esc closes the message', await v.until(`!document.querySelector('.installer-popup')`, 3000));
  // The installer has run: gone (checked when a display connects)
  record(NEEDED);
  await v.go(env.base + '/?kiosk=off');
  await sleep(1500);
  check('once the installer has run, the mark is gone', !(await v.evaluate(`!!document.querySelector('.installer-warning')`)));
  // No record at all (not set up by the installer, e.g. a PC): nothing to say
  fs.rmSync(path.join(env.APP, 'data/installer.json'));
  await v.go(env.base + '/?kiosk=off');
  await sleep(1500);
  check('no installer record: no mark', !(await v.evaluate(`!!document.querySelector('.installer-warning')`)));
  v.close();

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

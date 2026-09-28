// The update schedule in the admin panel and on the screens (SYSTEM_DESIGN §14 D41): the schedule
// form in Software updates; a waiting version with its three choices (Update now, Set a time, or
// waiting for the automatic install); with manual updates, the "Update available" notice on every
// page (no close button) and the viewer's warning mark, both staying until the new version runs.
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep, shot } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3947 });
  const units = path.join(env.T, 'systemd');
  for (const [dir, unit] of [['timers.target.wants', 'noticeboard-update.timer'], ['paths.target.wants', 'noticeboard-update.path']]) {
    fs.mkdirSync(path.join(units, dir), { recursive: true });
    fs.writeFileSync(path.join(units, dir, unit), '');
  }
  const data = (f) => path.join(env.APP, 'data', f);
  const requestFile = path.join(env.APP, 'tmp', 'update-request');
  const s = server(env);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();

  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!document.querySelector('#update-every')`);
  check('the schedule starts as every 15 minutes', (await c.evaluate(`document.querySelector('#update-every').value`)) === '15min');
  const updatesText = `[...document.querySelectorAll('.facts dd')][1]?.innerText ?? ''`;
  check('  … as the card says', (await c.evaluate(updatesText)).startsWith('Checked every 15 minutes.'));

  // Daily at 06:30
  await c.evaluate(`(() => { const e = document.querySelector('#update-every'); e.value = 'daily'; e.dispatchEvent(new Event('change')); })()`);
  await c.until(`!!document.querySelector('#update-time')`);
  await c.evaluate(`(() => { const t = document.querySelector('#update-time'); t.value = '06:30'; t.dispatchEvent(new Event('input')); })()`);
  await c.evaluate(`document.querySelector('form.schedule button[type=submit]').click()`);
  check('saved: the card says daily at 06:30', await c.until(`(${updatesText}).startsWith('Checked every 15 minutes; installed daily at 06:30.')`));
  check('  … the file for update.sh and a check request', fs.readFileSync(data('update-schedule.env'), 'utf8').includes('NOTICEBOARD_UPDATE_EVERY=daily') && fs.readFileSync(requestFile, 'utf8') === 'check\n');
  fs.rmSync(requestFile);

  // update.sh found a new version that isn't due yet
  const check_ = { result: 'available', branch: 'main', message: 'A new version is waiting.', time: new Date().toISOString(),
    available: 'b'.repeat(40), availableSubject: 'Better slides', availableDate: '2026-09-27T10:00:00Z', nextInstall: '2026-09-29T06:30:00Z' };
  fs.writeFileSync(data('update-check.json'), JSON.stringify(check_));
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!document.querySelector('.waiting')`);
  const box = await c.evaluate(`document.querySelector('.waiting').innerText`);
  check('the waiting version, with its three choices', box.includes('Update available') && box.includes('Better slides') && box.includes('installed automatically at')
    && box.includes('Update now') && box.includes('Set a time'), box.replace(/\s+/g, ' '));
  check('automatic updates: no page notice', !(await c.evaluate(`!!document.querySelector('.page-notices .page-warning')`)));
  const v = await page(connect, { width: 1280, height: 720 });
  await v.go(env.base + '/?kiosk=off');
  await sleep(2000);
  check('automatic updates: no mark on the screens', !(await v.evaluate(`!!document.querySelector('.installer-warning')`)));

  // Manual updates
  await c.evaluate(`(() => { const e = document.querySelector('#update-every'); e.value = 'manual'; e.dispatchEvent(new Event('change')); })()`);
  await c.evaluate(`document.querySelector('form.schedule button[type=submit]').click()`);
  await c.until(`(${updatesText}).startsWith('Checked once a day; installed only when you choose.')`);
  fs.writeFileSync(data('update-check.json'), JSON.stringify({ ...check_, nextInstall: '' }));
  for (const url of ['/admin/slideshows', '/admin/settings']) {
    await c.go(env.base + url);
    const shown = await c.until(`(document.querySelector('.page-notices .page-warning')?.innerText ?? '').includes('Update available')`, 8000);
    check(`manual: "Update available" on the ${url.split('/').pop()} page, with nothing to close`, shown && !(await c.evaluate(`!!document.querySelector('.page-notices .page-warning button')`)));
  }
  check('  … it links to Software updates', (await c.evaluate(`document.querySelector('.page-notices .page-warning a').getAttribute('href')`)) === '/admin/settings#updates');
  check('  … and the card stays open', await c.evaluate(`document.querySelector('#updates .card-toggle').getAttribute('aria-disabled') === 'true'`));
  await v.go(env.base + '/?kiosk=off');
  check('manual: the warning mark on the screens', await v.until(`!!document.querySelector('.installer-warning')`, 8000));

  // Set a time: next 00:00 by default
  await c.until(`!!document.querySelector('.waiting')`);
  await c.click('Set a time');
  await c.until(`!!document.querySelector('.waiting input[type=datetime-local]')`);
  const value = await c.evaluate(`document.querySelector('.waiting input[type=datetime-local]').value`);
  check('Set a time: the next 00:00 by default', /T00:00$/.test(value), value);
  await c.evaluate(`[...document.querySelectorAll('.waiting button')].find((b) => b.textContent.trim() === 'Save').click()`);
  check('  … saved: "It will be installed at"', await c.until(`(document.querySelector('.waiting')?.innerText ?? '').includes('It will be installed at')`));
  check('  … in the file for update.sh', /NOTICEBOARD_UPDATE_AT=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/.test(fs.readFileSync(data('update-schedule.env'), 'utf8')));
  await c.go(env.base + '/admin/slideshows');
  check('  … the notice stays until the Server is up to date', await c.until(`!!document.querySelector('.page-notices .page-warning')`, 8000));
  await v.go(env.base + '/?kiosk=off');
  check('  … and so does the mark', await v.until(`!!document.querySelector('.installer-warning')`, 8000));
  await c.screenshot(shot('update-available.png'));

  // Update now
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!document.querySelector('.waiting')`);
  c.on((msg) => { if (msg.method === 'Page.javascriptDialogOpening') c.send('Page.handleJavaScriptDialog', { accept: true }); });
  await c.click('Update now');
  check('Update now: the update is requested, the card shows it waiting to start',
    await c.until(`(document.querySelector('.progress')?.innerText ?? '').includes('Waiting for the update to start')`) && fs.readFileSync(requestFile, 'utf8') === 'install-now\n');
  await c.screenshot(shot('update-now.png'));

  v.close();
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

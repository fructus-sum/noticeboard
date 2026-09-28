// Restore Defaults in the admin panel (SYSTEM_DESIGN §14 D42): the warning lists everything that
// is reset and kept, the port and password, and recommends running the installer afterwards with
// its command; cancelling changes nothing; confirming asks for the restore and shows it running.
// Without the updater it says why it can't.
const fs = require('fs');
const path = require('path');
const { makeApp, server, page, check, done, shot } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3949, keepSample: true });
  const s = server(env);
  const units = path.join(env.T, 'systemd');
  const marker = path.join(env.APP, 'data', 'restore-defaults');
  const card = `[...document.querySelectorAll('section.card')].find((c) => c.querySelector('.card-toggle')?.textContent.trim() === 'Delete content')`;

  // Without the updater
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();
  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!(${card})`);
  await c.click('Restore Defaults');
  check('without the updater: it says why it can\'t, no dialog', await c.until(`(${card}).innerText.includes("isn't set up")`) && !(await c.evaluate(`!!document.querySelector('.danger-dialog')`)));
  await s.stop();

  // With it
  for (const [dir, unit] of [['timers.target.wants', 'noticeboard-update.timer'], ['paths.target.wants', 'noticeboard-update.path']]) {
    fs.mkdirSync(path.join(units, dir), { recursive: true });
    fs.writeFileSync(path.join(units, dir, unit), '');
  }
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!(${card})`);
  await c.click('Restore Defaults');
  await c.until(`!!document.querySelector('.danger-dialog')`);
  const text = await c.evaluate(`document.querySelector('.danger-dialog').innerText`);
  for (const [what, words] of [
    ['every slideshow deleted, the sample as new', 'Every slideshow is deleted'],
    ['the password back to Admin@12345', 'Admin@12345'],
    ['MAC filtering off', 'MAC filtering is turned off'],
    ['the port back to 3000, and settable again', 'The port goes back to 3000'],
    ['the history, backups and logs deleted', 'the update history, the settings backups and the logs'],
    ['the software reinstalled from the branch', 'reinstalled from the latest version of main'],
    ['what is kept', 'Kept: the branch'],
    ['running the installer again is recommended, no more reminders', 'no more reminders'],
    ['the installer command', 'curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash'],
  ]) check(`the warning: ${what}`, text.includes(words));
  await c.screenshot(shot('restore-defaults-warning.png'));
  await c.click('Cancel');
  check('Cancel: nothing asked for', await c.until(`!document.querySelector('.danger-dialog')`) && !fs.existsSync(marker));

  await c.click('Restore Defaults');
  await c.until(`document.activeElement?.id === 'restore-defaults-password'`);
  await c.send('Input.insertText', { text: 'Admin@12345' });
  await c.evaluate(`document.querySelector('.danger-dialog').requestSubmit()`);
  await c.until(`document.activeElement?.textContent.trim() === 'Cancel, keep everything'`);
  await c.click('Confirm, restore defaults');
  check('confirmed: "Restoring defaults…" and the request for update.sh', await c.until(`(${card}).innerText.includes('Restoring defaults')`)
    && fs.existsSync(marker) && fs.readFileSync(path.join(env.APP, 'tmp', 'update-request'), 'utf8') === 'restore-defaults\n');
  check('  … the card stays open while it runs', await c.evaluate(`(${card}).querySelector('.card-toggle').getAttribute('aria-disabled') === 'true'`));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

// Full update in the admin panel (SYSTEM_DESIGN §18.7 phase 2): on main with root's system step set
// up, "Full update…" asks for the admin password and a final confirmation, then the request "full"
// for update.sh and the progress; Cancel changes nothing; on a branch the card says to run the
// installer by hand instead, with its command; and after a failed system step, every admin page
// says what went wrong.
const fs = require('fs');
const path = require('path');
const { makeApp, server, page, check, done, shot, git } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3931 });
  git(env.APP, 'checkout', '-q', '-B', 'main');
  const units = path.join(env.T, 'systemd');
  for (const [dir, unit] of [['timers.target.wants', 'noticeboard-update.timer'], ['paths.target.wants', 'noticeboard-update.path'], ['paths.target.wants', 'noticeboard-system.path']]) {
    fs.mkdirSync(path.join(units, dir), { recursive: true });
    fs.writeFileSync(path.join(units, dir, unit), '');
  }
  const requestFile = path.join(env.APP, 'tmp', 'update-request');
  const s = server(env);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units });
  await s.login();
  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  const card = `document.querySelector('#updates')`;
  const cardText = () => c.evaluate(`(${card})?.innerText ?? ''`);

  await c.go(`${env.base}/admin/settings`);
  await c.until(`(${card})?.innerText.includes('Full update')`);
  check('on main with the system step: "Full update…" and what it does', (await cardText()).includes('Runs the installer of main\'s latest Release on the Server')
    && await c.evaluate(`[...document.querySelectorAll('#updates button')].some((b) => b.textContent.trim() === 'Full update…')`));

  await c.click('Full update…');
  await c.until(`!!document.querySelector('.danger-dialog')`);
  const text = await c.evaluate(`document.querySelector('.danger-dialog').innerText`);
  check('the dialog: the installer runs as the administrator, then the Release again; content kept', text.includes('Run the installer of main\'s latest Release')
    && text.includes('Install that Release again') && text.includes('audio shows and settings are kept'), text.replace(/\s+/g, ' ').slice(0, 200));
  await c.screenshot(shot('full-update-dialog.png'));
  await c.click('Cancel');
  check('Cancel: nothing asked for', await c.until(`!document.querySelector('.danger-dialog')`) && !fs.existsSync(requestFile));

  await c.click('Full update…');
  await c.until(`document.activeElement?.id === 'full-update-password'`);
  await c.send('Input.insertText', { text: 'Admin@12345' });
  await c.evaluate(`document.querySelector('.danger-dialog').requestSubmit()`);
  await c.until(`document.activeElement?.textContent.trim() === 'Cancel, change nothing'`);
  await c.click('Confirm, run a full update');
  check('confirmed: the request "full" for update.sh, and the card shows it waiting to start',
    await c.until(`(${card})?.innerText.includes('Full update requested')`) && fs.readFileSync(requestFile, 'utf8').trim() === 'full', (await cardText()).replace(/\s+/g, ' ').slice(0, 300));
  fs.rmSync(requestFile, { force: true });
  fs.rmSync(path.join(env.APP, 'data', 'update-status.json'), { force: true });

  // After a failed system step, for a Release not running yet: the notice on every page
  fs.writeFileSync(path.join(env.APP, 'tmp', 'system-result'), JSON.stringify({ commit: 'c'.repeat(40), release: 'v0.9.1', result: 'failed', message: 'E: Unable to locate package cage.', time: new Date().toISOString() }));
  await c.go(`${env.base}/admin/slideshows`);
  const notice = await c.until(`(document.querySelector('.installer')?.innerText ?? '').includes('this time it didn\\'t work')`, 8000);
  check('a failed system step: every page says what went wrong, with the installer command', notice
    && (await c.evaluate(`document.querySelector('.installer').innerText`)).includes('Release v0.9.1') && (await c.evaluate(`document.querySelector('.installer').innerText`)).includes('Unable to locate package cage'));
  fs.rmSync(path.join(env.APP, 'tmp', 'system-result'));

  // Following a branch: the installer is run by hand
  git(env.APP, 'checkout', '-q', '-B', 'feature/x');
  fs.writeFileSync(path.join(env.APP, 'data', 'update-branch.env'), 'NOTICEBOARD_BRANCH=feature/x\n');
  await c.go(`${env.base}/admin/settings`);
  await c.until(`(${card})?.innerText.includes('Full update')`);
  const branchText = await cardText();
  check('on a branch: no Full update button; run the installer by hand, with the branch\'s command', branchText.includes('This noticeboard follows feature/x')
    && branchText.includes('noticeboard/feature/x/installers/install.sh') && !(await c.evaluate(`[...document.querySelectorAll('#updates button')].some((b) => b.textContent.trim() === 'Full update…')`)));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

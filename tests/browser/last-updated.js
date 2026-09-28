// "Last updated" in the sidebar: when this noticeboard installed the version it runs (the same
// time as "Last update" in Software updates), else when the version was made.
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { git, check, makeApp, server, page, done } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3912 });
  const commit = git(env.APP, 'rev-parse', 'HEAD');
  const made = git(env.APP, 'log', '-1', '--format=%cI');
  const statusFile = path.join(env.APP, 'data/update-status.json');
  const status = (s) => (s ? fs.writeFileSync(statusFile, JSON.stringify(s)) : fs.rmSync(statusFile, { force: true }));
  const s = server(env);
  await s.start();
  await s.login();
  const c = await page(connect, { width: 1280, height: 900 });
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCookies');
  await c.login(env.base);
  const fmt = (iso) => c.evaluate(`new Date(${JSON.stringify(iso)}).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`);
  const sidebar = async () => {
    await c.go(env.base + '/admin/settings');
    await c.until(`!!document.querySelector('.nav__updated') && [...document.querySelectorAll('.card')].some((e) => e.querySelector('h2')?.textContent === 'Software updates' && e.innerText.includes('Running'))`);
    return c.evaluate(`({ text: document.querySelector('.nav__updated').innerText.replace(/\\s+/g, ' ').trim(), title: document.querySelector('.nav__updated').title })`);
  };

  // Like an installed Server: updated to this version by the updater, some minutes after it was made
  const installed = new Date(Date.parse(made) + 13 * 60 * 1000 + 26 * 1000).toISOString();
  status({ state: 'updated', branch: 'main', commit, message: `Updated to ${commit.slice(0, 7)} from main.`, time: installed });
  let side = await sidebar();
  check('updated by the updater: the sidebar shows when it was installed', side.text === `Last updated ${await fmt(installed)}`, side.text);
  const card = await c.evaluate(`[...document.querySelectorAll('.card')].find((e) => e.querySelector('h2')?.textContent === 'Software updates').innerText`);
  check('the same time as Last update in Software updates', card.includes(await c.evaluate(`new Date(${JSON.stringify(installed)}).toLocaleString()`)));
  check('the tooltip still says when the version was made', side.title.includes(`made ${await fmt(made)}`) && side.title.includes(`Version ${commit.slice(0, 7)}`), side.title);
  const api = (await s.api('GET', '/api/settings/version')).data.version;
  check('the API gives both times', api.installedAt === installed && api.date === made && api.commit === commit, JSON.stringify(api));

  status({ state: 'updated', branch: 'main', commit, message: 'Installed with the installer.', time: '2026-09-20T08:00:00Z' });
  check('installed by the installer: that time', (await sidebar()).text === `Last updated ${await fmt('2026-09-20T08:00:00Z')}`);

  for (const [name, st] of [
    ['no update recorded (e.g. a copy the updater never touched): when the version was made', null],
    ['the last update was of another version: when this one was made', { state: 'updated', commit: 'f'.repeat(40), time: installed }],
    ['the last update was rolled back: when this version was made', { state: 'rolled-back', commit, time: installed }],
    ['an update in progress: when this version was made', { state: 'updating', commit, time: installed }],
    ['a broken time in the status file: when this version was made', { state: 'updated', commit, time: 'yesterday' }],
  ]) {
    status(st);
    side = await sidebar();
    check(name, side.text === `Last updated ${await fmt(made)}`, side.text);
  }
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

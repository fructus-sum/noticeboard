// Admin cards that fold away to their title (SYSTEM_DESIGN §14 D39): the title stays, the state
// is remembered after a reload, the header buttons hide while folded, and folding never hides a
// warning: the page warnings stay, and a card holding a warning (the default password, a failed
// update, a failed slide) stays open and can't be folded.
const fs = require('fs');
const path = require('path');
const { makeApp, server, page, check, done, sleep, shot } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

const card = (title) => `[...document.querySelectorAll('section.card')].find((c) => c.querySelector('.card-toggle')?.textContent.trim().startsWith(${JSON.stringify(title)}))`;
const state = (title) => `(() => { const c = ${card(title)}; if (!c) return null; const t = c.querySelector('.card-toggle'); const b = c.querySelector('.card-body');
  return { expanded: t.getAttribute('aria-expanded'), locked: t.getAttribute('aria-disabled') === 'true', bodyShown: getComputedStyle(b).display !== 'none', titleShown: t.getBoundingClientRect().height > 0, actions: !!c.querySelector('.card-actions') }; })()`;

(async () => {
  const env = makeApp({ port: 3943 });
  // The last update failed: the Software updates card has a warning to show
  fs.writeFileSync(path.join(env.APP, 'data/update-status.json'), JSON.stringify({ state: 'failed', branch: 'main', commit: 'x', message: 'Didn\'t install 1234567 from main: test.', time: '2026-09-01T10:00:00Z' }));
  const s = server(env);
  await s.start();
  await s.login();
  const folder = (await s.api('POST', '/api/slideshows', { name: 'Folding' })).data.folder;

  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  // Nothing remembered from before (a browser that ran this test already)
  await c.evaluate(`localStorage.removeItem('noticeboard:collapsedCards')`);
  await c.send('Page.reload');
  await c.until(`document.querySelectorAll('section.card .card-toggle').length === 7`);
  const titles = await c.evaluate(`[...document.querySelectorAll('.card-toggle')].map((t) => t.textContent.trim())`);
  check('the seven Settings cards can fold', titles.join('|') === 'Branding|Display|MAC filtering|Port|Change password|Software updates|Delete content', titles.join('|'));
  const closed = await c.evaluate(`[...document.querySelectorAll('.card-toggle')].filter((t) => t.getAttribute('aria-expanded') !== 'true').map((t) => t.textContent.trim())`);
  check('every card starts open', closed.length === 0, `closed: ${closed.join(', ')} · stored: ${await c.evaluate(`localStorage.getItem('noticeboard:collapsedCards')`)}`);

  // Fold Display and Branding
  await c.evaluate(`${card('Display')}.querySelector('.card-toggle').click()`);
  await c.evaluate(`${card('Branding')}.querySelector('.card-toggle').click()`);
  let d = await c.evaluate(state('Display'));
  check('folding hides the body, the title stays', d.expanded === 'false' && !d.bodyShown && d.titleShown, JSON.stringify(d));
  check('it is remembered in this browser', (await c.evaluate(`localStorage.getItem('noticeboard:collapsedCards')`)) === '["settings-display","settings-branding"]');
  await c.send('Page.reload');
  await c.until(`document.querySelectorAll('section.card .card-toggle').length === 7`);
  d = await c.evaluate(state('Display'));
  const b = await c.evaluate(state('Branding'));
  const m = await c.evaluate(state('MAC filtering'));
  check('after a reload they are still folded, the others open', !d.bodyShown && !b.bodyShown && m.bodyShown, JSON.stringify({ d, b, m }));
  await c.evaluate(`${card('Display')}.querySelector('.card-toggle').click()`);
  check('opening it again shows the body', (await c.evaluate(state('Display'))).bodyShown);

  // Warnings: the page warning stays; the Password and Software updates cards stay open
  check('the default-password warning is still shown', await c.evaluate(`!!document.body.innerText.includes('still uses the default admin password')`));
  await c.evaluate(`${card('Change password')}.querySelector('.card-toggle').click()`);
  const pw = await c.evaluate(state('Change password'));
  check('with the default password, the Password card stays open and can\'t fold', pw.locked && pw.bodyShown && pw.expanded === 'true', JSON.stringify(pw));
  await c.evaluate(`${card('Software updates')}.querySelector('.card-toggle').click()`);
  const up = await c.evaluate(state('Software updates'));
  check('after a failed update, Software updates stays open and can\'t fold', up.locked && up.bodyShown, JSON.stringify(up));
  check('the chevron is hidden on a card that can\'t fold', await c.evaluate(`getComputedStyle(${card('Change password')}.querySelector('.card-toggle'), '::before').visibility === 'hidden'`));

  // The password changed: the card can fold now
  await s.api('PUT', '/api/settings/password', { current: 'Admin@12345', newPassword: 'Another@123' });
  await c.send('Page.reload');
  await c.until(`document.querySelectorAll('section.card .card-toggle').length === 7`);
  await sleep(500);
  await c.evaluate(`${card('Change password')}.querySelector('.card-toggle').click()`);
  const pw2 = await c.evaluate(state('Change password'));
  check('once the password is changed, the Password card folds', !pw2.locked && !pw2.bodyShown, JSON.stringify(pw2));
  check('the settings link to #password still finds the card', await c.evaluate(`!!document.getElementById('password')?.classList.contains('card')`));
  await c.screenshot(shot('collapsible-settings.png'));

  // The slideshow page: header buttons hide while folded; a failed slide keeps Slides open
  await c.go(`${env.base}/admin/slideshows/${folder}`);
  await c.until(`document.querySelectorAll('section.card .card-toggle').length === 2`);
  let st = await c.evaluate(state('Settings'));
  check('the slideshow\'s Settings card shows Edit while open', st.actions && (await c.evaluate(`${card('Settings')}.querySelector('.card-actions').textContent.trim()`)) === 'Edit');
  await c.evaluate(`${card('Settings')}.querySelector('.card-toggle').click()`);
  st = await c.evaluate(state('Settings'));
  check('folded, its Edit button is hidden', !st.actions && !st.bodyShown, JSON.stringify(st));
  await c.evaluate(`${card('Slides')}.querySelector('.card-toggle').click()`);
  const sl = await c.evaluate(state('Slides'));
  check('Slides folds, hiding + Upload', !sl.bodyShown && !sl.actions, JSON.stringify(sl));
  check('the disabled-slideshow banner is not in a card and stays', await c.evaluate(`document.body.innerText.includes('This slideshow is')`));

  const bad = new FormData();
  bad.append('files', new Blob(['not an image'], { type: 'image/png' }), 'broken.png');
  await s.api('POST', `/api/slideshows/${folder}/slides`, bad);
  for (let i = 0; i < 40; i++) {
    if ((await s.api('GET', `/api/slideshows/${folder}/slides`)).data.some((x) => x.status === 'error')) break;
    await sleep(250);
  }
  await c.send('Page.reload');
  await c.until(`document.querySelectorAll('section.card .card-toggle').length === 2`);
  await c.until(`!!document.querySelector('.slide-name')`);
  const sl2 = await c.evaluate(state('Slides'));
  check('with a failed slide, Slides is open and can\'t fold', sl2.locked && sl2.bodyShown, JSON.stringify(sl2));
  check('the slideshow Settings card is still folded', !(await c.evaluate(state('Settings'))).bodyShown);
  await c.screenshot(shot('collapsible-slideshow.png'));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

// The admin panel on a phone: nothing runs off the screen or out of its box (boxes grow
// instead), and the sidebar collapses to icons with a toggle that's remembered.
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { MODULES, sleep, check, makeApp, server, page, done } = require('../helpers/app.js');
const sharp = require(path.join(MODULES, 'sharp'));

// Anything wider than the screen, or poking out of its card
const overflow = `(() => {
  const problems = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('page ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
  for (const card of document.querySelectorAll('.card')) {
    const r = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('button, a, input, code, .badge, .tag, img')) {
      const e = el.getBoundingClientRect();
      if (e.width && (e.right > r.right + 1 || e.left < r.left - 1)) problems.push((el.textContent || el.tagName).trim().slice(0, 20) + ' outside its card');
    }
  }
  if (document.querySelector('main').getBoundingClientRect().left < document.querySelector('.nav').getBoundingClientRect().right - 1) problems.push('page under the menu');
  return problems;
})()`;

(async () => {
  const env = makeApp({ keepSample: true });
  const s = server(env);
  await s.start();
  await s.login();
  for (const name of ['Weekly notices for the whole building and car park', 'Canteen']) {
    const ss = (await s.api('POST', '/api/slideshows', { name })).data;
    const f = new FormData();
    f.append('files', new Blob([await sharp({ create: { width: 800, height: 450, channels: 3, background: '#39c' } }).png().toBuffer()], { type: 'image/png' }), 'x.png');
    await s.api('POST', `/api/slideshows/${ss.folder}/slides`, f);
  }
  await sleep(2500);
  const sample = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { enabled: true });

  // ── Phone ──
  const c = await page(connect);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await c.go(env.base + '/admin/login');
  await c.evaluate(`localStorage.clear()`);
  await c.login(env.base);
  await c.until(`document.querySelectorAll('.ss-row').length >= 3`);
  await sleep(500);
  let nav = await c.evaluate(`({ w: document.querySelector('.nav').getBoundingClientRect().width, collapsed: document.querySelector('.nav').classList.contains('nav--collapsed'), labels: [...document.querySelectorAll('.nav__label')].filter((l) => l.offsetParent).length, links: [...document.querySelectorAll('.nav a.nav__link')].map((a) => a.getAttribute('aria-label')) })`);
  check('phone: the menu starts collapsed to icons (56 px, no labels)', nav.collapsed && Math.round(nav.w) === 56 && nav.labels === 0, JSON.stringify(nav));
  check('each icon is named for screen readers and tooltips', nav.links.join('|') === 'Slideshows|Settings|Help, opens in a new tab|Open viewer, in a new tab');
  let problems = await c.evaluate(overflow);
  check('phone, Slideshows: nothing off-screen or outside its box', problems.length === 0, problems.join('; '));
  const rows = await c.evaluate(`[...document.querySelectorAll('.ss-row')].map((r) => Math.round(r.getBoundingClientRect().height))`);
  check('rows grew to fit their buttons (taller than a one-line row)', rows.every((h) => h > 80), rows.join(', '));
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-mobile-list-collapsed.png'));

  await c.evaluate(`document.querySelector('.nav__toggle').click()`);
  await sleep(300);
  nav = await c.evaluate(`({ w: document.querySelector('.nav').getBoundingClientRect().width, labels: [...document.querySelectorAll('.nav__label')].filter((l) => l.offsetParent).length })`);
  problems = await c.evaluate(overflow);
  check('toggle: the menu expands with its words (200 px)', Math.round(nav.w) === 200 && nav.labels === 5, JSON.stringify(nav));
  check('expanded on a phone: still nothing off-screen or outside its box', problems.length === 0, problems.join('; '));
  await c.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-mobile-list-expanded.png'));
  await c.send('Page.reload');
  await c.until(`!!document.querySelector('.nav')`);
  check('the choice is remembered after a reload', !(await c.evaluate(`document.querySelector('.nav').classList.contains('nav--collapsed')`)));
  await c.evaluate(`document.querySelector('.nav__toggle').click()`);

  for (const [name, url, ready] of [
    ['slideshow page', `/admin/slideshows/${sample.folder}`, `document.querySelectorAll('.slide-row').length >= 5`],
    ['Settings', '/admin/settings', `!!document.querySelector('.preview img') && !!document.querySelector('.facts')`],
  ]) {
    await c.go(env.base + url);
    await c.until(ready, 8000);
    await sleep(700);
    problems = await c.evaluate(overflow);
    check(`phone, ${name}: nothing off-screen or outside its box`, problems.length === 0, problems.join('; '));
    await c.screenshot(path.join(require('os').tmpdir(), `noticeboard-test-mobile-${name.replace(/\W+/g, '-')}.png`));
  }
  await c.go(`${env.base}/admin/slideshows/${sample.folder}`);
  await c.until(`document.querySelectorAll('.slide-row').length >= 5`);
  await c.click('Edit');
  await sleep(400);
  problems = await c.evaluate(overflow);
  check('phone, editing a slideshow: the form fits', problems.length === 0, problems.join('; '));
  c.close();

  // ── Desktop: as before unless the toggle is used ──
  const d = await page(connect, { width: 1280, height: 800 });
  await d.go(env.base + '/admin/slideshows');
  await d.evaluate(`localStorage.clear()`);
  await d.send('Page.reload');
  await d.until(`document.querySelectorAll('.ss-row').length >= 3`);
  await sleep(400);
  nav = await d.evaluate(`({ w: document.querySelector('.nav').getBoundingClientRect().width, collapsed: document.querySelector('.nav').classList.contains('nav--collapsed') })`);
  const oneLine = await d.evaluate(`[...document.querySelectorAll('.ss-row')].every((r) => r.getBoundingClientRect().height < 90)`);
  check('desktop: the menu starts expanded, and rows stay one line', !nav.collapsed && Math.round(nav.w) === 200 && oneLine, JSON.stringify(nav));
  await d.evaluate(`document.querySelector('.nav__toggle').click()`);
  await sleep(300);
  check('desktop: it can be collapsed to icons too', Math.round(await d.evaluate(`document.querySelector('.nav').getBoundingClientRect().width`)) === 56);
  await d.screenshot(path.join(require('os').tmpdir(), 'noticeboard-test-desktop-collapsed.png'));
  await d.evaluate('localStorage.clear()');   // leave the test browser as it was
  d.close();

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

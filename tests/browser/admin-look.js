// How the admin panel looks, as the browser computes it: the login page, the slideshow list (a
// published, an unpublished, a hidden and the sample slideshow), the Settings page and the MAC
// filtering pop-up, on a desktop and on a phone. Recorded in tests/fixtures/admin-look.json
// from the code before the global styles moved into styles/base.css and the repeated pieces into
// shared components; it must look exactly the same (NB_UPDATE_SNAPSHOT=1 records it again, only for a deliberate change).
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'admin-look.json');
const PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'border', 'border-radius', 'outline',
  'background-color', 'color', 'opacity', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'text-decoration-line', 'cursor', 'gap', 'flex-wrap', 'justify-content', 'align-items',
  'grid-template-columns', 'box-shadow', 'z-index', 'max-width', 'overflow-y', 'min-height', 'text-align'];

// finder: a CSS selector, or "text:<tag>:<text>" for the first <tag> whose text starts with <text>
const styles = (finder) => `(() => {
  let el;
  const f = ${JSON.stringify(finder)};
  if (f.startsWith('text:')) {
    const [, tag, text] = f.split(':');
    el = [...document.querySelectorAll(tag)].find((e) => e.textContent.trim().startsWith(text));
  } else el = document.querySelector(f);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of ${JSON.stringify(PROPS)}) out[p] = cs.getPropertyValue(p);
  return out;
})()`;

const LIST = {
  'body': 'body', 'layout': '.layout', 'main': 'main.main', 'page title': 'h1', 'card (row)': '.ss-row',
  'row info': '.ss-info', 'row actions': '.ss-actions', 'Published badge': 'text:span:Published',
  'Disabled badge': 'text:span:Disabled', 'Disable button': 'text:button:Disable', 'Publish button': 'text:button:Publish',
  'Manage button': 'text:button:Manage', 'Hide button': 'text:button:Hide', 'Delete button': 'text:button:Delete',
  'Hidden tag': 'text:span:Hidden', 'Sample tag': 'text:span:Sample', 'New slideshow button': 'text:button:+ New slideshow',
  'hide hidden button': 'text:button:Hide hidden', 'device banner': 'main .card', 'nav': '.nav', 'nav link (active)': '.nav__link.router-link-active',
  'password warning': '.warning',
};
const SETTINGS = {
  // The Display card and what's in it, found by name (Branding is above it since 0.7.2)
  'settings card': '[data-card=settings-display]', 'card title': '[data-card=settings-display] h2', 'field label': '[data-card=settings-display] label', 'text input': '[data-card=settings-display] input[type=number]',
  'checkbox row': '[data-card=settings-display] .field', 'primary button': '[data-card=settings-display] .btn-primary', 'ghost button': 'text:button:Add',
};
const MAC_WARNING = {
  'overlay': '.overlay', 'dialog': '.dialog', 'dialog title': '.dialog h2', 'important box': '.important',
  'how-to link': '.link', 'dialog actions': '.actions', 'dialog cancel': '.actions .btn-ghost', 'dialog confirm': '.actions .btn-primary',
};

async function capture(c, map, prefix) {
  const out = {};
  for (const [name, finder] of Object.entries(map)) out[`${prefix} ${name}`] = await c.evaluate(styles(finder));
  return out;
}

(async () => {
  const env = makeApp({ port: 3936, keepSample: true });
  const s = server(env);
  await s.start();
  await s.login();
  const a = (await s.api('POST', '/api/slideshows', { name: 'On air' })).data.folder;
  await s.api('PUT', `/api/slideshows/${a}`, { enabled: true });
  await s.api('POST', '/api/slideshows', { name: 'Draft' });
  const h = (await s.api('POST', '/api/slideshows', { name: 'Put away' })).data.folder;
  await s.api('PUT', `/api/slideshows/${h}`, { hidden: true });

  const look = {};
  for (const [device, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 412, height: 915 }]]) {
    const c = await page(connect, size);
    if (device === 'phone') await c.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 2.625, mobile: true });
    await c.send('Network.enable');
    await c.send('Network.clearBrowserCookies');
    await c.go(env.base + '/admin/login');
    await c.evaluate('localStorage.clear()');
    await c.until(`!!document.querySelector('input[type=password]')`);
    Object.assign(look, await capture(c, { 'login card': '.login-card', 'login input': 'input[type=password]', 'login button': 'button[type=submit]', 'login title': 'h1' }, `${device}:`));
    await c.login(env.base);
    await c.until(`document.querySelectorAll('.ss-row').length >= 3`);
    await c.click('Show hidden');
    await sleep(400);
    Object.assign(look, await capture(c, LIST, `${device}:`));
    await c.go(env.base + '/admin/settings');
    await c.until(`!!document.querySelector('#mac-toggle')`);
    await sleep(500);
    Object.assign(look, await capture(c, SETTINGS, `${device}: settings`));
    await c.evaluate(`document.querySelector('#mac-toggle').click()`);
    await c.until(`!!document.querySelector('.dialog')`);
    await sleep(300);
    Object.assign(look, await capture(c, MAC_WARNING, `${device}: MAC warning`));
    await c.evaluate('localStorage.clear()');
    c.close();
  }
  await s.stop();

  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(look, null, 2)}\n`);
    const missing = Object.keys(look).filter((k) => !look[k]);
    check(`recorded the look of ${Object.keys(look).length} admin elements in tests/fixtures/admin-look.json`, missing.length === 0, missing.join(', '));
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    let same = 0;
    for (const name of Object.keys(want)) {
      const diffs = Object.keys(want[name] || {}).filter((p) => want[name][p] !== look[name]?.[p]);
      if (!look[name] || diffs.length) check(`${name}: looks the same`, false, diffs.map((p) => `${p}: ${want[name][p]} → ${look[name]?.[p]}`).join('; ') || 'not found');
      else same += 1;
    }
    check(`${same} of ${Object.keys(want).length} admin elements look exactly the same`, same === Object.keys(want).length);
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

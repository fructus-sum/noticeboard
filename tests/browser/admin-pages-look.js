// How the admin panel's larger pages look, as the browser computes it: the slideshow page (its
// settings, the edit form with the schedule, the slide list, the preview), the Settings cards and
// the Software updates card with its branch check and switch dialog. Recorded in
// tests/fixtures/admin-pages-look.json from the code before these pages were split into
// components; they must look exactly the same (NB_UPDATE_SNAPSHOT=1 records it again, only for a deliberate change).
// The copy runs on a fixed branch name, so its texts are the same whichever branch the tests run from.
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep, git, REPO, lookFixture } = require('../helpers/app.js');
const { startFakeGitHub } = require('../helpers/github.js');

const SNAPSHOT = lookFixture('admin-pages-look.json');   // per system: fonts, and so sizes, differ
const PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'border', 'border-radius', 'outline',
  'background-color', 'color', 'opacity', 'font-family', 'font-size', 'font-weight', 'line-height', 'cursor', 'gap',
  'flex-wrap', 'justify-content', 'align-items', 'grid-template-columns', 'box-shadow', 'z-index', 'max-width',
  'text-transform', 'object-fit', 'overflow-y'];

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
const text = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? '').replace(/\\s+/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID').replace(/[0-9a-f]{7,40}/g, 'SHA').replace(/\\d{1,2}\\/\\d{1,2}\\/\\d{4}, \\d{1,2}:\\d{2}:\\d{2}(?: [AP]M)?/g, 'TIME').trim()`;   // a time, 24-hour or with AM/PM (Linux's Chrome)

async function capture(c, map, prefix) {
  const out = {};
  for (const [name, finder] of Object.entries(map)) out[`${prefix} ${name}`] = await c.evaluate(styles(finder));
  return out;
}

(async () => {
  const env = makeApp({ port: 3938, keepSample: true });
  git(env.APP, 'checkout', '-q', '-B', 'feature/look-test');   // the Software updates card shows it
  // The updater's systemd units, so branch switching is available
  const units = path.join(env.T, 'systemd');
  fs.mkdirSync(path.join(units, 'timers.target.wants'), { recursive: true });
  fs.mkdirSync(path.join(units, 'paths.target.wants'), { recursive: true });
  fs.writeFileSync(path.join(units, 'timers.target.wants/noticeboard-update.timer'), '');
  fs.writeFileSync(path.join(units, 'paths.target.wants/noticeboard-update.path'), '');
  // A last update to show
  fs.writeFileSync(path.join(env.APP, 'data/update-status.json'), JSON.stringify({ state: 'updated', branch: 'main', commit: 'x', message: 'Updated to 1234567 from main.', time: '2026-09-01T10:00:00Z' }));
  // Checking main shows main's latest Release (SYSTEM_DESIGN §18.6), from a stand-in GitHub: a
  // commit on top of the copy's own, published as v0.1.0 in a bare copy of this repository that
  // becomes its origin (so this repository gets no tag, and the Release isn't older than what
  // runs). Its software list names one program no machine has, so the switch dialog's "Missing
  // software" step and its text are the same on every machine.
  const origin = path.join(env.T, 'origin.git');
  git(env.T, 'clone', '-q', '--bare', REPO, 'origin.git');
  git(env.T, 'clone', '-q', env.APP, 'release');
  const release = path.join(env.T, 'release');
  const list = JSON.parse(fs.readFileSync(path.join(release, 'system-requirements.json'), 'utf8'));
  list.software = [{ name: 'Widget', commands: ['no-such-program-xyz'], versionArgs: ['--version'], versions: '*', neededFor: 'Showing widgets.', install: 'sudo apt install widget' }];
  fs.writeFileSync(path.join(release, 'system-requirements.json'), JSON.stringify(list, null, 2));
  git(release, 'commit', '-qam', 'Release 0.1.0');
  git(release, 'push', '-q', origin, 'HEAD:refs/tags/v0.1.0');
  git(env.APP, 'remote', 'set-url', 'origin', origin);
  const mock = path.join(env.T, 'mock');
  fs.mkdirSync(mock);
  fs.writeFileSync(path.join(mock, 'release'), 'v0.1.0\n');
  const github = await startFakeGitHub(mock);
  const s = server(env);
  await s.start({ NOTICEBOARD_SYSTEMD_DIR: units, NOTICEBOARD_GITHUB_API: github.url });
  await s.login();
  const sample = (await s.api('GET', '/api/slideshows')).data.find((x) => x.sample);
  for (let i = 0; i < 80; i++) {
    const slides = (await s.api('GET', `/api/slideshows/${sample.folder}/slides`)).data;
    if (!slides.some((x) => x.thumbnailPending)) break;
    await sleep(250);
  }
  await s.api('PUT', `/api/slideshows/${sample.folder}`, { slideDurationSeconds: 3 });

  const look = {};
  const texts = {};
  const c = await page(connect, { width: 1280, height: 900 });
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCookies');
  await c.login(env.base);

  // ── The slideshow page (tall enough for no scrollbar, so widths don't depend on timing) ──
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2400, deviceScaleFactor: 1, mobile: false });
  await c.go(`${env.base}/admin/slideshows/${sample.folder}`);
  await c.until(`document.querySelectorAll('.slide-row').length >= 5`, 8000);
  await sleep(500);
  Object.assign(look, await capture(c, {
    'back button': 'text:button:← Back', 'title': 'h1', 'sample tag': 'text:span:Sample', 'settings card': '.card',
    'settings facts': '.card .card-body > div:first-child', 'status badge': 'text:span:Disabled', 'publish toggle': 'text:button:Publish',
    'hide button': 'text:button:Hide', 'disabled banner': 'text:span:This slideshow is', 'slides card title': 'text:h2:Slides',
    'upload button': 'text:label:+ Upload', 'slide row': '.slide-row', 'slide thumb': '.slide-thumb', 'thumb image': '.slide-thumb img',
    'play mark': '.slide-thumb__play', 'status pill': '.badge', 'move up': 'text:button:↑', 'delete slide': 'text:button:✕',
  }, 'slideshow:'));
  texts['slideshow page'] = await c.evaluate(text('main'));
  await c.click('Edit');
  await sleep(300);
  await c.evaluate(`(() => { const sel = document.querySelector('select'); sel.value = 'timed'; sel.dispatchEvent(new Event('change')); })()`);
  await sleep(300);
  Object.assign(look, await capture(c, {
    'form grid': 'form > div', 'name input': 'input[type=text]', 'priority input': 'input[type=number]', 'duration radio': 'input[type=radio]',
    'duration label': 'text:label:Use the default', 'schedule select': 'select', 'time input': 'input[type=time]', 'day checkbox': 'input[type=checkbox]',
    'day label': 'text:label:Mon', 'save button': 'text:button:Save',
  }, 'slideshow edit:'));
  texts['slideshow edit form'] = await c.evaluate(text('form'));
  await c.click('Cancel');
  await sleep(300);
  await c.evaluate(`document.querySelector('.slide-thumb').click()`);
  await c.until(`!!document.querySelector('.overlay--pinned')`);
  await sleep(300);
  Object.assign(look, await capture(c, {
    'preview overlay': '.overlay', 'preview box': '.box', 'preview image': '.media', 'preview caption': '.caption', 'preview close': '.close',
  }, 'slideshow:'));
  await c.evaluate(`document.querySelector('.close').click()`);

  // ── Settings (always taller than the screen) ──
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.go(env.base + '/admin/settings');
  await c.until(`!!document.querySelector('.facts')`, 8000);
  await sleep(700);
  Object.assign(look, await capture(c, {
    'display card': '[data-card=settings-display]', 'pin checkbox label': 'label[for=show-pin]', 'updates commit code': '.facts code', 'mac add input': 'input[placeholder="aa:bb:cc:dd:ee:ff"]',
    'mac add button': 'text:button:Add', 'logo preview': '.preview', 'logo upload': '.upload', 'password card': '#password',
    'password input': '#password input', 'updates facts': '.facts', 'updates term': '.facts dt', 'updates pill': '.pill',
    'branch form input': '.row input', 'check button': 'text:button:Check branch',
  }, 'settings:'));
  // The Display card's Save (found by name: Branding is above it since 0.7.2)
  await c.evaluate(`[...document.querySelectorAll('[data-card=settings-display] button')].find((b) => b.textContent.trim() === 'Save').click()`);
  await sleep(400);
  look['settings: saved message'] = await c.evaluate(styles('[data-card=settings-display] .success-msg'));
  texts['settings: saved message'] = await c.evaluate(`document.querySelector('[data-card=settings-display] .success-msg')?.textContent ?? ''`);
  texts['settings page'] = await c.evaluate(text('main'));
  await c.evaluate(`(() => { const el = document.querySelector('.row input'); el.value = 'main'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await c.click('Check branch');
  await c.until(`/installs its latest Release/.test(document.body.innerText)`, 20000);
  await sleep(300);
  Object.assign(look, await capture(c, { 'check result': '.checked', 'software panel': '.software', 'switch button': 'text:button:Switch to main' }, 'settings:'));
  await c.click('Switch to main');
  // main's Release lists a program no machine has (above), so the 'Missing software' step comes first
  await c.until(`!!document.querySelector('.dialog')`);
  await sleep(300);
  Object.assign(look, await capture(c, {
    'switch overlay': '.overlay', 'switch dialog': '.dialog', 'switch warnings': '.warnings', 'switch accept': '.accept',
    'switch actions': '.dialog .actions', 'switch continue': 'text:button:Continue',
  }, 'settings:'));
  texts['switch dialog'] = await c.evaluate(text('.dialog'));
  await c.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);
  texts['after Esc'] = await c.evaluate(`!!document.querySelector('.dialog') ? 'dialog still open' : ([...([...document.querySelectorAll('section.card')].find((c) => c.querySelector('.card-toggle')?.textContent.trim() === 'Software updates')?.querySelectorAll('p.muted:last-of-type') ?? [])].find((el) => !el.closest('.schedule, .waiting'))?.textContent ?? '')`);
  c.close();
  await s.stop();
  await github.close();

  const record = { look, texts };
  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(record, null, 2)}\n`);
    const missing = Object.keys(look).filter((k) => !look[k]);
    check(`recorded ${Object.keys(look).length} elements and ${Object.keys(texts).length} texts in ${path.relative(path.join(__dirname, '..', '..'), SNAPSHOT)}`, missing.length === 0, missing.join(', '));
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    let same = 0;
    for (const name of Object.keys(want.look)) {
      const diffs = Object.keys(want.look[name] || {}).filter((p) => want.look[name][p] !== look[name]?.[p]);
      if (!look[name] || diffs.length) check(`${name}: looks the same`, false, diffs.map((p) => `${p}: ${want.look[name][p]} → ${look[name]?.[p]}`).join('; ') || 'not found');
      else same += 1;
    }
    check(`${same} of ${Object.keys(want.look).length} elements look exactly the same`, same === Object.keys(want.look).length);
    for (const name of Object.keys(want.texts)) {
      check(`${name}: the same text`, want.texts[name] === texts[name], want.texts[name] === texts[name] ? '' : `was: ${want.texts[name]}\n        now: ${texts[name]}`);
    }
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

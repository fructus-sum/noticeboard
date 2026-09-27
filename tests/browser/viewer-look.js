// How the viewer's own controls look: the location pin, the exit button and their pop-ups, as the
// browser computes their styles (position, size, colours, fonts…). Refactor stage 8 moves them onto
// shared components; they must look exactly the same. Recorded in tests/fixtures/viewer-look.json
// from the code before stage 8 (NB_UPDATE_SNAPSHOT=1 records it again, only for a deliberate change).
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');

const SNAPSHOT = path.join(__dirname, '..', 'fixtures', 'viewer-look.json');
const PROPS = ['position', 'top', 'left', 'right', 'width', 'height', 'min-width', 'max-width', 'padding', 'border',
  'border-radius', 'background-color', 'color', 'opacity', 'cursor', 'display', 'align-items', 'justify-content',
  'z-index', 'transform', 'box-shadow', 'font-family', 'font-size', 'line-height', 'transition'];

const styles = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of ${JSON.stringify(PROPS)}) out[p] = cs.getPropertyValue(p);
  const svg = el.querySelector(':scope > svg');
  if (svg) { const s = getComputedStyle(svg); out.svg = [s.width, s.height, s.fill].join(' '); }
  return out;
})()`;

(async () => {
  const env = makeApp({ port: 3935 });
  const s = server(env);
  await s.start();
  const c = await page(connect, { width: 1280, height: 720 });
  await c.go(env.base + '/');
  await c.until(`!!document.querySelector('.info-button')`);
  await sleep(500);
  const look = {};
  look['pin'] = await c.evaluate(styles('.info-button'));
  await c.mouse(300, 300);
  await c.mouse(320, 320);
  await c.until(`getComputedStyle(document.querySelector('.exit-button')).display !== 'none'`, 3000);
  look['exit button (shown)'] = await c.evaluate(styles('.exit-button'));
  await c.evaluate(`document.querySelector('.info-button').click()`);
  await c.until(`!!document.querySelector('.info-popup')`);
  await sleep(400);
  look['pin pop-up'] = await c.evaluate(styles('.info-popup'));
  look['pin pop-up close'] = await c.evaluate(styles('.info-close'));
  await c.evaluate(`document.querySelector('.info-close').click()`);
  await c.mouse(340, 340);
  await c.evaluate(`document.querySelector('.exit-button').click()`);
  await c.until(`!!document.querySelector('.exit-popup')`);
  await sleep(300);
  look['exit pop-up'] = await c.evaluate(styles('.exit-popup'));
  look['exit pop-up buttons'] = await c.evaluate(styles('.exit-actions button'));
  c.close();
  await s.stop();

  if (!fs.existsSync(SNAPSHOT) || process.env.NB_UPDATE_SNAPSHOT === '1') {
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(look, null, 2)}\n`);
    check(`recorded the look of ${Object.keys(look).length} viewer controls in tests/fixtures/viewer-look.json`, Object.values(look).every(Boolean));
  } else {
    const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    for (const name of Object.keys(want)) {
      const diffs = Object.keys(want[name] || {}).filter((p) => want[name][p] !== look[name]?.[p]);
      check(`${name}: looks the same`, look[name] && diffs.length === 0, diffs.map((p) => `${p}: ${want[name][p]} → ${look[name]?.[p]}`).join('; '));
    }
  }
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

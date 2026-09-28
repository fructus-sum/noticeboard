// A card's messages (SYSTEM_DESIGN §18.5 item 11): "Saved." clears itself after 2 seconds, but its
// timer never clears a later message: an error shown straight after stays, until its ✕ dismisses it
// or the next message replaces it. Checked on Settings → MAC filtering (adding a MAC that's already
// listed says "Already in list").
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3967 });
  const s = server(env);
  await s.start();
  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!document.querySelector('input[placeholder="aa:bb:cc:dd:ee:ff"]')`);
  const card = `[...document.querySelectorAll('section.card')].find((x) => x.querySelector('#mac-toggle'))`;
  const message = `((${card}).querySelector('.success-msg, .error-msg')?.textContent ?? '').replace('✕', '').trim()`;
  const add = (mac) => c.evaluate(`(() => {
    const i = document.querySelector('input[placeholder="aa:bb:cc:dd:ee:ff"]'); i.value = ${JSON.stringify(mac)}; i.dispatchEvent(new Event('input'));
    [...(${card}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add').click();
  })()`);
  const clickSave = () => c.evaluate(`[...(${card}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save').click()`);

  await add('aa:bb:cc:dd:ee:01');
  await clickSave();
  check('saving shows "Saved."', await c.until(`${message} === 'Saved.'`, 3000), await c.evaluate(message));
  await add('aa:bb:cc:dd:ee:01');
  check('an error straight after replaces it', await c.until(`${message} === 'Already in list'`, 1000), await c.evaluate(message));
  await sleep(2600);
  check('  … and "Saved."\'s timer doesn\'t clear it', await c.evaluate(message) === 'Already in list', await c.evaluate(message) || '(nothing)');
  await c.evaluate(`(${card}).querySelector('.flash-dismiss').click()`);
  check('  … its ✕ dismisses it', await c.until(`${message} === ''`, 1000));
  await clickSave();
  check('a success still clears itself', await c.until(`${message} === 'Saved.'`, 3000) && await c.until(`${message} === ''`, 4000));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

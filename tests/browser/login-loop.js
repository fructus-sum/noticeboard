// A first-time visitor (no login cookie) opens the admin panel: the login page must load once
// and stay put, and logging in must work. Counts full page loads over several seconds.
const { connect } = require('../helpers/cdp.js');
const { sleep, check, makeApp, server, page, done } = require('../helpers/app.js');

(async () => {
  const env = makeApp();
  const s = server(env);
  await s.start();
  const c = await page(connect);
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCookies');
  let loads = 0;
  c.on((msg) => { if (msg.method === 'Page.loadEventFired') loads += 1; });
  await c.send('Page.navigate', { url: env.base + '/admin/' });
  await sleep(6000);
  check('no login cookie: the login page loads once and stays (no reload loop)', loads === 1, `${loads} page loads in 6 s`);
  await c.until(`!!document.querySelector('input[type=password]')`);
  await c.evaluate(`(() => { const i = document.querySelector('input[type=password]'); i.value = 'Admin@12345'; i.dispatchEvent(new Event('input')); document.querySelector('form').requestSubmit(); })()`);
  check('logging in works', await c.until(`location.pathname === '/admin/slideshows' && !!document.querySelector('.nav')`, 5000));
  const before = loads;
  await sleep(3000);
  check('and stays logged in, no reload', loads === before && (await c.evaluate(`location.pathname`)) === '/admin/slideshows');
  await c.send('Network.clearBrowserCookies');
  loads = 0;
  await c.send('Page.navigate', { url: env.base + '/admin/settings' });
  await sleep(5000);
  check('logged out on a deep link: sent to the login page, which stays', loads <= 2 && (await c.evaluate(`location.pathname`)) === '/admin/login', `${loads} loads, at ${await c.evaluate('location.pathname')}`);
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

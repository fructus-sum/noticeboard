// The login page: a wrong password is shown on the page (no reload, no navigation), too many tries
// are refused with the server's message, and the right password opens the slideshow list.
const { connect } = require('../helpers/cdp.js');
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3937 });
  const s = server(env);
  await s.start();
  const c = await page(connect);
  await c.send('Network.enable');
  await c.send('Network.clearBrowserCookies');
  await c.go(env.base + '/admin/');
  check('not logged in: the admin panel opens the login page', await c.until(`location.pathname === '/admin/login' && !!document.querySelector('input[type=password]')`));

  const tryPassword = async (pw) => {
    await c.evaluate(`window.__stay = true; (() => { const i = document.querySelector('input[type=password]'); i.value = ${JSON.stringify(pw)}; i.dispatchEvent(new Event('input')); document.querySelector('form').requestSubmit(); })()`);
    await c.until(`!!document.querySelector('.error-msg') || location.pathname !== '/admin/login'`, 5000);
    await sleep(300);
    return c.evaluate(`({ error: document.querySelector('.error-msg')?.textContent ?? '', path: location.pathname, stayed: window.__stay === true })`);
  };
  let r = await tryPassword('wrong-one');
  check('wrong password: "Invalid password" on the page, no reload, still on the login page', r.error === 'Invalid password' && r.path === '/admin/login' && r.stayed, JSON.stringify(r));
  for (let i = 0; i < 4; i++) r = await tryPassword('wrong-again');
  r = await tryPassword('wrong-sixth');
  check('the sixth try in 15 minutes: the server\'s "too many" message', /Too many login attempts/.test(r.error) && r.path === '/admin/login', r.error);

  // A fresh server (the limit is per server run), then the right password
  await s.stop();
  await s.start();
  await c.go(env.base + '/admin/login');
  await c.until(`!!document.querySelector('input[type=password]')`);
  r = await tryPassword('Admin@12345');
  check('right password: the slideshow list', await c.until(`location.pathname === '/admin/slideshows'`, 5000), r.path);
  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

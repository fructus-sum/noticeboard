// The port and the "Restart the Server" box (SYSTEM_DESIGN §18.5 item 4): Settings → Port saves a
// new port; the box appears on every admin page, saying what changes and what to do on the Clients;
// "Restart the Server now…" asks for the password and a last chance, the Server stops (systemd
// would start it again: the test does), and the page moves to the new address by itself, where the
// box is gone.
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3962 });
  const s = server(env);
  await s.start();
  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!document.querySelector('#server-port')`);
  check('Settings → Port shows the port in use', await c.evaluate(`document.querySelector('#server-port').value`) === '3962');

  // The field has the same limits as the Server (the API test checks the Server's own answer)
  check('a port below 1024 or above 65535 is refused by the field', await c.evaluate(`(() => { const i = document.querySelector('#server-port'); const ok = []; for (const v of ['80', '70000', '3963']) { i.value = v; ok.push(i.checkValidity()); } return ok.join(','); })()`) === 'false,false,true');
  await c.evaluate(`(() => { const i = document.querySelector('#server-port'); i.value = '3963'; i.dispatchEvent(new Event('input')); i.form.requestSubmit(); })()`);
  const box = `(document.querySelector('.restart')?.innerText ?? '').replace(/\\s+/g, ' ')`;
  check('saved: the "Restart the Server" box appears', await c.until(`${box}.includes('Restart the Server') && ${box}.includes('from 3962 to 3963')`), await c.evaluate(box));
  check('  … it says what the Clients need', (await c.evaluate(box)).includes('Run the installer again on each Client'));
  await c.go(`${env.base}/admin/slideshows`);
  check('  … and it is on every admin page', await c.until(`${box}.includes('Restart the Server')`));

  // Restart: password, last chance
  await c.evaluate(`[...document.querySelectorAll('.restart button')].find((b) => b.textContent.includes('Restart the Server now')).click()`);
  await c.until(`document.activeElement?.id === 'restart-password'`);
  await c.send('Input.insertText', { text: 'Admin@12345' });
  await c.evaluate(`document.querySelector('.danger-dialog').requestSubmit()`);
  await c.until(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm, restart now')`);
  await c.click('Confirm, restart now');
  check('confirmed: the page waits for the Server', await c.until(`${box}.includes('Restarting')`, 5000), await c.evaluate(box));
  let down = false;
  for (let i = 0; i < 40 && !down; i++) {
    await sleep(250);
    down = await fetch(`${env.base}/api/auth/status`).then(() => false, () => true);
  }
  check('  … the Server stops', down);

  // As systemd would: start it again, on the saved port
  await s.stop();
  env.port = 3963;
  env.base = 'http://localhost:3963';
  await s.start();
  check('the page moves to the new address by itself', await c.until(`location.port === '3963' && location.pathname === '/admin/settings'`, 20000), await c.evaluate('location.href'));
  check('  … where there is nothing to restart', await c.until(`!!document.querySelector('#server-port') && !document.querySelector('.restart')`, 10000));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

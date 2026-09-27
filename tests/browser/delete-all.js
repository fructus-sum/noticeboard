// Delete All in the admin panel (SYSTEM_DESIGN §14 D40): the Settings card "Delete content", the
// warning listing each slideshow, the admin password, the last chance; cancelling at any step or a
// wrong password changes nothing; confirming leaves only the sample; with nothing to delete it
// says so instead of asking.
const { makeApp, server, page, check, done, sleep, shot } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3945, keepSample: true });
  const s = server(env);
  await s.start();
  await s.login();
  for (const name of ['Front desk', 'Canteen']) await s.api('POST', '/api/slideshows', { name });
  const count = async () => (await s.api('GET', '/api/slideshows')).data.length;

  const c = await page(connect, { width: 1100, height: 900 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  await c.until(`[...document.querySelectorAll('.card-toggle')].some((t) => t.textContent.trim() === 'Delete content')`);
  const flash = `(document.querySelector('.danger-dialog') ? '' : [...document.querySelectorAll('section.card')].pop().innerText)`;
  const typePassword = async (password) => {
    await c.until(`document.activeElement?.id === 'delete-all-password'`);
    await c.send('Input.insertText', { text: password });
    await c.evaluate(`document.querySelector('.danger-dialog').requestSubmit()`);
  };

  // Cancel at the password step
  await c.click('Delete All');
  check('the warning lists each slideshow and its slides', await c.until(`(document.querySelector('.danger-dialog')?.innerText ?? '').includes('Front desk (0 slides)') && document.querySelector('.danger-dialog').innerText.includes('Canteen (0 slides)')`));
  const text = await c.evaluate(`document.querySelector('.danger-dialog').innerText`);
  check('it says what is kept and that it can\'t be undone', text.includes("can't be undone") && text.includes('sample slideshow'));
  check('the password field has the focus', await c.until(`document.activeElement?.id === 'delete-all-password'`));
  await c.screenshot(shot('delete-all-warning.png'));
  await c.click('Cancel');
  check('Cancel: the dialog closes, nothing deleted', await c.until(`!document.querySelector('.danger-dialog')`) && (await count()) === 3);

  // A wrong password
  await c.click('Delete All');
  await typePassword('wrong-password');
  check('a wrong password: an error, nothing deleted', await c.until(`${flash}.includes('Incorrect password')`) && (await count()) === 3);

  // The last chance, cancelled
  await c.click('Delete All');
  await typePassword('Admin@12345');
  check('the right password: the last chance, Cancel focused', await c.until(`document.activeElement?.textContent.trim() === 'Cancel, keep them'`));
  await c.click('Cancel, keep them');
  check('cancelled at the last moment: nothing deleted', await c.until(`${flash}.includes('Cancelled at the last moment')`) && (await count()) === 3);

  // Confirmed
  await c.click('Delete All');
  await typePassword('Admin@12345');
  await c.until(`document.activeElement?.textContent.trim() === 'Cancel, keep them'`);
  await c.click('Confirm, delete them all');
  check('confirmed: "Deleted 2 slideshows"', await c.until(`${flash}.includes('Deleted 2 slideshows')`));
  const left = (await s.api('GET', '/api/slideshows')).data;
  check('only the sample is left', left.length === 1 && left[0].sample);

  // Nothing left to delete
  await c.click('Delete All');
  check('with only the sample left, it says there is nothing to delete', await c.until(`${flash}.includes('nothing to delete')`) && !(await c.evaluate(`!!document.querySelector('.danger-dialog')`)));
  await c.screenshot(shot('delete-all-done.png'));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

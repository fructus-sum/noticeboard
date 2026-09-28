// Settings → Display → Video format for new uploads and Existing videos (SYSTEM_DESIGN §14 D43,
// §16 #12): H.265 by default with both formats explained and the warning that some screens and
// browsers can't play it; choosing H.264 hides the warning and Save keeps it with the other display
// settings. "Convert existing videos" uses the saved format (it asks to save a changed choice
// first), warns before it starts, shows its progress and how it went.
const { makeApp, server, page, check, done, shot } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3951, keepSample: true });   // the sample slideshow has a video to convert
  const s = server(env);
  await s.start();
  await s.login();
  const c = await page(connect, { width: 1100, height: 1100 });
  await c.login(env.base);
  await c.go(`${env.base}/admin/settings`);
  await c.until(`!!document.querySelector('#video-format')`);
  check('the default is H.265', (await c.evaluate(`document.querySelector('#video-format').value`)) === 'h265');
  const help = await c.evaluate(`document.querySelector('.format-help')?.innerText ?? ''`);
  check('both formats are explained', help.includes('about half the file size') && help.includes('plays on every screen'), help.slice(0, 120));
  const warning = await c.evaluate(`document.querySelector('.format-warning')?.innerText ?? ''`);
  check('with H.265, the warning about screens that can\'t play it', warning.includes('H.265 may not play everywhere') && warning.includes("shows nothing for the video's length"), warning.slice(0, 120));
  await c.screenshot(shot('video-format.png'));

  const convertButton = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Convert existing videos'))`;
  await c.evaluate(`(() => { const e = document.querySelector('#video-format'); e.value = 'h264'; e.dispatchEvent(new Event('change')); })()`);
  check('with H.264, no warning', await c.until(`document.querySelectorAll('form .format-warning').length === 0`));
  check('a changed, unsaved choice: convert asks to save first', await c.until(`${convertButton}.disabled && document.body.innerText.includes('Save the new format first')`));
  await c.evaluate(`document.querySelector('#video-format').closest('form').requestSubmit()`);
  await c.until(`(document.querySelector('#video-format').closest('form').innerText).includes('Saved.')`);
  const saved = (await s.api('GET', '/api/settings')).data.display;
  check('Save keeps H.264 with the other display settings', saved.videoFormat === 'h264' && saved.defaultSlideDurationSeconds === 10 && saved.showDeviceInfo === true, JSON.stringify(saved));
  check('saved: convert offers H.264', await c.until(`!${convertButton}.disabled && ${convertButton}.textContent.includes('H.264')`));

  // Convert: the warning, then the progress, then how it went
  let question = '';
  c.on((msg) => { if (msg.method === 'Page.javascriptDialogOpening') { question = msg.params.message; c.send('Page.handleJavaScriptDialog', { accept: true }); } });
  await c.evaluate(`${convertButton}.click()`);
  check('it warns about the time and the Server being slower', question.includes('long time') && question.includes('slower'), question.slice(0, 120));
  check('then it shows how it went', await c.until(`document.body.innerText.includes('Last conversion to H.264')`, 120000));
  const summary = await c.evaluate(`document.querySelector('.convert__done')?.innerText ?? ''`);
  check('  … the sample\'s video is already H.264, so it\'s left as it is', /0 converted, 1 already H\.264/.test(summary), summary);
  await c.screenshot(shot('video-convert.png'));

  await c.send('Page.reload');
  await c.until(`!!document.querySelector('#video-format')`);
  check('after a reload it shows H.264', await c.until(`document.querySelector('#video-format').value === 'h264'`));

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

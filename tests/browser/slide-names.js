// Slide names in the admin panel (SYSTEM_DESIGN §14 D38): each row shows the slide's name (the
// uploaded file's name, or type and date for a slide from before names existed), renaming with ✎
// (Enter saves, Esc cancels, an empty name goes back to the file's name), and the preview and the
// delete question use the name.
const fs = require('fs');
const path = require('path');
const { MODULES, makeApp, server, page, check, done, sleep, shot } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');
const sharp = require(path.join(MODULES, 'sharp'));

const png = (colour) => sharp({ create: { width: 320, height: 180, channels: 3, background: colour } }).png().toBuffer();

(async () => {
  const env = makeApp({ port: 3942 });
  const s = server(env);
  await s.start();
  await s.login();

  const folder = (await s.api('POST', '/api/slideshows', { name: 'Named slides' })).data.folder;
  const form = new FormData();
  form.append('files', new Blob([await png('#39c')], { type: 'image/png' }), 'Poster – été.png');
  form.append('files', new Blob([await png('#c93')], { type: 'image/png' }), 'old.png');
  await s.api('POST', `/api/slideshows/${folder}/slides`, form);
  for (let i = 0; i < 40; i++) {
    const slides = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data;
    if (slides.every((x) => x.status === 'ready')) break;
    await sleep(250);
  }
  // The second slide as one uploaded before names existed
  const file = path.join(env.APP, 'data', 'slideshows', folder, 'slideshow.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete data.slides[1].originalName;
  data.slides[1].addedAt = '2026-03-12T14:02:00.000Z';
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  const c = await page(connect, { width: 1100, height: 800 });
  await c.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});
  await c.login(env.base);
  await c.go(`${env.base}/admin/slideshows/${folder}`);
  await c.until(`document.querySelectorAll('.slide-name').length === 2`);
  const names = await c.evaluate(`[...document.querySelectorAll('.slide-name')].map((e) => e.textContent.trim())`);
  check('a row shows the uploaded file\'s name', names[0] === 'Poster – été.png', names[0]);
  check('an older slide shows its type and date added', /^Image, added .*2026/.test(names[1]), names[1]);
  const detail = await c.evaluate(`document.querySelector('.slide-detail').textContent.replace(/\\s+/g, ' ').trim()`);
  check('the type and stored file name are the detail line', /^image · [0-9a-f-]{36}\.png$/.test(detail), detail);

  // Rename: ✎, type, Enter
  const renameButtons = `[...document.querySelectorAll('button')].filter((b) => b.title === 'Rename')`;
  await c.evaluate(`${renameButtons}[0].click()`);
  check('✎ opens a name field with the name selected', await c.until(`document.activeElement?.classList.contains('slide-name-input') && document.activeElement.value === 'Poster – été.png'`));
  check('the field allows the server\'s longest name', (await c.evaluate(`document.querySelector('.slide-name-input').maxLength`)) === 200);
  await c.send('Input.insertText', { text: 'Summer fair' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  check('Enter saves the new name', await c.until(`document.querySelector('.slide-name')?.textContent.trim() === 'Summer fair'`));
  const saved = (await s.api('GET', `/api/slideshows/${folder}/slides`)).data[0];
  check('the server has the name; the file is unchanged', saved.name === 'Summer fair' && saved.originalName === 'Poster – été.png' && saved.filename === data.slides[0].filename);

  // Esc cancels
  await c.evaluate(`${renameButtons}[0].click()`);
  await c.until(`!!document.querySelector('.slide-name-input')`);
  await c.send('Input.insertText', { text: 'Not this' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('Esc cancels', await c.until(`!document.querySelector('.slide-name-input') && document.querySelector('.slide-name').textContent.trim() === 'Summer fair'`));

  // Clearing goes back to the uploaded name
  await c.evaluate(`${renameButtons}[0].click()`);
  await c.until(`!!document.querySelector('.slide-name-input')`);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  check('an empty name goes back to the file\'s name', await c.until(`document.querySelector('.slide-name')?.textContent.trim() === 'Poster – été.png'`));

  // Naming the older slide, then the preview and the delete question
  await c.evaluate(`${renameButtons}[1].click()`);
  await c.until(`!!document.querySelector('.slide-name-input')`);
  await c.send('Input.insertText', { text: 'Opening hours' });
  await c.evaluate(`document.querySelector('.slide-name-input').blur()`);
  check('leaving the field saves too', await c.until(`[...document.querySelectorAll('.slide-name')][1]?.textContent.trim() === 'Opening hours'`));
  await c.evaluate(`document.querySelectorAll('.slide-thumb')[1].click()`);
  await c.until(`!!document.querySelector('.caption__name')`);
  check('the preview is titled with the name', (await c.evaluate(`document.querySelector('.caption__name').textContent.trim()`)) === 'Opening hours');
  await c.screenshot(shot('slide-names.png'));
  await c.evaluate(`document.querySelector('.close').click()`);

  let question = '';
  c.on((msg) => {
    if (msg.method !== 'Page.javascriptDialogOpening') return;
    question = msg.params.message;
    c.send('Page.handleJavaScriptDialog', { accept: false });
  });
  await c.evaluate(`document.querySelectorAll('.btn-danger')[1].click()`);
  await sleep(500);
  check('the delete question names the slide', question === 'Delete “Opening hours”?', question);
  check('declining it keeps the slide', (await c.evaluate(`document.querySelectorAll('.slide-name').length`)) === 2);

  c.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

// services/slideshowStore.js at its edges: missing, broken and unusual slideshow.json files, writing
// only when something changed, and concurrent updates not losing each other. Runs inside a
// throwaway app copy (the store's paths are fixed to its own folder), never on this repository's data/.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MODULES, makeApp, check, done } = require('../helpers/app.js');

if (process.env.NB_STORE_CHILD) {
  // Child: in the app copy
  const results = [];
  const t = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
  (async () => {
    const configService = require(path.join(process.cwd(), 'server/services/configService'));
    await configService.init();
    const store = require(path.join(process.cwd(), 'server/services/slideshowStore'));
    const dir = (f) => path.join(process.cwd(), 'data/slideshows', f);
    const file = (f) => path.join(dir(f), 'slideshow.json');
    const put = (f, text) => { fs.mkdirSync(dir(f), { recursive: true }); fs.writeFileSync(file(f), text); };

    t('missing file: no slides', JSON.stringify(store.readSlides('nope')) === '{"slides":[]}');
    put('broken', '{ not json');
    t('broken file: no slides', JSON.stringify(store.readSlides('broken')) === '{"slides":[]}');
    put('extra', JSON.stringify({ note: 'kept', slides: [{ id: 'a' }] }));
    t('other keys are kept', store.readSlides('extra').note === 'kept' && store.readSlides('extra').slides.length === 1);
    put('noslides', JSON.stringify({ note: 'x' }));
    t('no slides list: no slides (decision B0)', Array.isArray(store.readSlides('noslides').slides) && store.readSlides('noslides').slides.length === 0);
    put('array', '[1,2]');
    t('a file that is not an object: no slides', JSON.stringify(store.readSlides('array')) === '{"slides":[]}');

    put('same', JSON.stringify({ slides: [{ id: 'a' }, { id: 'b' }] }, null, 2));
    const before = fs.statSync(file('same')).mtimeMs;
    await new Promise((r) => setTimeout(r, 50));
    const r = await store.modifySlides('same', (data) => data.slides.length);
    t('an unchanged update returns its result without writing', r === 2 && fs.statSync(file('same')).mtimeMs === before);
    await store.modifySlides('same', (data) => { data.slides.reverse(); });
    t('a changed update is written, as pretty JSON', fs.readFileSync(file('same'), 'utf8') === JSON.stringify({ slides: [{ id: 'b' }, { id: 'a' }] }, null, 2));

    put('busy', JSON.stringify({ slides: [] }));
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.modifySlides('busy', async (data) => {
      await new Promise((res) => setTimeout(res, Math.random() * 10));
      data.slides.push({ id: `s${i}` });
    })));
    t('20 concurrent updates: none lost', store.readSlides('busy').slides.length === 20);
    await store.modifySlides('busy', () => { throw new Error('boom'); }).catch(() => {});
    await store.modifySlides('busy', (data) => { data.slides.push({ id: 'after' }); });
    t('a failed update doesn\'t block the next one', store.readSlides('busy').slides.length === 21);

    const created = await store.create({ name: 'My Show', priority: undefined, schedule: undefined });
    t('create: entry as before (unpublished, next priority, always)', created.folder === 'my-show' && created.enabled === false
      && created.priority === 1 && created.schedule.type === 'always' && typeof created.addedAt === 'string');
    t('create: an empty slideshow.json, pretty JSON', fs.readFileSync(file('my-show'), 'utf8') === JSON.stringify({ slides: [] }, null, 2)
      && fs.existsSync(path.join(dir('my-show'), 'slides')));
    const again = await store.create({ name: 'My Show' });
    t('create: a second one with the same name gets its own folder', again.folder === 'my-show-2' && again.priority === 2);
    t('find and list', store.find('my-show-2')?.name === 'My Show' && store.list().length === 2);
    t('replace: unknown folder → null', (await store.replace('nope', {})) === null);
    await store.replace('my-show', { ...created, name: 'Renamed' });
    t('replace: saved in place', store.list()[0].name === 'Renamed' && store.list()[1].folder === 'my-show-2');
    t('remove: unknown folder → false', (await store.remove('nope')) === false);
    t('remove: entry and folder gone', (await store.remove('my-show')) === true && !store.find('my-show') && !fs.existsSync(dir('my-show')));

    console.log(JSON.stringify(results));
  })().catch((e) => { console.log(JSON.stringify([{ name: 'ERROR ' + e.message, pass: false }])); });
} else {
  const env = makeApp({ port: 3929 });
  const child = spawnSync(process.execPath, [__filename], {
    cwd: env.APP, env: { ...process.env, NB_STORE_CHILD: '1', NODE_PATH: MODULES, NODE_ENV: 'production' }, encoding: 'utf8',
  });
  const line = (child.stdout || '').trim().split('\n').filter((l) => l.startsWith('[')).pop();
  const results = line ? JSON.parse(line) : [{ name: 'the child ran', pass: false, detail: (child.stderr || '').slice(-500) }];
  for (const r of results) check(r.name, r.pass, r.detail);
  done(env);
}

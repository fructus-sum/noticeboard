// An unreadable config.json is never overwritten (SYSTEM_DESIGN §18.5 item 8): every save keeps a
// last good copy; at start-up a broken config.json is kept as config.json.broken-<time> and the copy
// is restored (the settings as last saved), and the admin panel is told until someone dismisses it;
// with no copy either, the Server starts from its defaults, and says so; the broken files stay kept. On its defaults it listens on port 3000, so that part is
// skipped if something else already uses port 3000 on this PC.
const fs = require('fs');
const path = require('path');
const { makeApp, server, check, done } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3965 });
  const s = server(env);
  const data = (f) => path.join(env.APP, 'data', f);
  await s.start();
  await s.login();
  await s.api('PUT', '/api/settings', { display: { backgroundColor: '#123456' } });
  await s.api('POST', '/api/slideshows', { name: 'Kept' });
  const lastGood = JSON.parse(fs.readFileSync(data('config.last-good.json'), 'utf8'));
  const hasKept = (list) => list.some((x) => x.folder === 'kept');
  check('every save keeps a last good copy', lastGood.display?.backgroundColor === '#123456' && hasKept(lastGood.slideshows)
    && JSON.stringify(lastGood) === JSON.stringify(JSON.parse(fs.readFileSync(data('config.json'), 'utf8'))));
  check('no recovery to report while all is well', (await s.api('GET', '/api/settings/config-recovery')).data.recovery === null);

  // Broken, with a good copy
  await s.stop();
  fs.writeFileSync(data('config.json'), '{ this is not json');
  await s.start();
  await s.login();
  const settings = (await s.api('GET', '/api/settings')).data;
  check('a broken config.json: the last good copy is restored (settings as last saved)', settings.display?.backgroundColor === '#123456'
    && hasKept((await s.api('GET', '/api/slideshows')).data), JSON.stringify(settings.display));
  const broken = fs.readdirSync(path.join(env.APP, 'data')).filter((f) => f.startsWith('config.json.broken-'));
  check('  … the broken file is kept, as it was', broken.length === 1 && fs.readFileSync(data(broken[0]), 'utf8') === '{ this is not json', broken.join(','));
  const note = (await s.api('GET', '/api/settings/config-recovery')).data.recovery;
  check('  … and the admin panel is told', note?.restored === 'last-good' && note.brokenFile === broken[0], JSON.stringify(note));
  const dismissed = await s.api('DELETE', '/api/settings/config-recovery');
  check('  … until dismissed', dismissed.data.recovery === null && (await s.api('GET', '/api/settings/config-recovery')).data.recovery === null);

  // Broken, and no copy: on the defaults, so on port 3000
  await s.stop();
  if (await fetch('http://localhost:3000/').then(() => true, () => false)) {
    console.log('SKIPPED the no-copy part: something else is using port 3000 on this PC');
    done(env);
  }
  env.port = 3000;
  env.base = 'http://localhost:3000';
  fs.writeFileSync(data('config.json'), 'also broken');
  fs.rmSync(data('config.last-good.json'));
  await s.start();
  check('no copy either: the Server starts on its defaults (the default password)', (await s.login()) === 200);
  check('  … its slideshows aren\'t listed', !hasKept((await s.api('GET', '/api/slideshows')).data));
  const kept = fs.readdirSync(path.join(env.APP, 'data')).filter((f) => f.startsWith('config.json.broken-'));
  check('  … both broken files are kept', kept.length === 2 && kept.some((f) => fs.readFileSync(data(f), 'utf8') === 'also broken'), kept.join(','));
  const note2 = (await s.api('GET', '/api/settings/config-recovery')).data.recovery;
  check('  … and the admin panel is told it started from the defaults', note2?.restored === 'defaults', JSON.stringify(note2));
  check('  … the slideshow\'s folder is untouched', fs.existsSync(path.join(env.APP, 'data', 'slideshows', 'kept')));
  await s.api('PUT', '/api/settings', { display: { backgroundColor: '#654321' } });
  check('saving a setting writes the new config.json, next to the kept ones', JSON.parse(fs.readFileSync(data('config.json'), 'utf8')).display.backgroundColor === '#654321'
    && fs.readdirSync(path.join(env.APP, 'data')).filter((f) => f.startsWith('config.json.broken-')).length === 2);

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

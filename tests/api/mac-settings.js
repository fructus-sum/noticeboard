// MAC filtering's settings, checked and merged (SYSTEM_DESIGN §18.5 item 9): only the fields sent
// change (turning filtering on keeps the list); MACs are stored lower case with colons, must be well
// formed and appear once; labels are trimmed; the Server's own "localhost" entry always stays; a bad
// change is refused with the reason and changes nothing.
const { makeApp, server, check, done } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3966 });
  const s = server(env);
  await s.start();
  await s.login();
  const put = (macFiltering) => s.api('PUT', '/api/settings', { macFiltering });
  const current = async () => (await s.api('GET', '/api/settings')).data.macFiltering;

  const list = await put({ approved: [{ mac: 'localhost', label: 'Server itself' }, { mac: 'AA-BB-CC-DD-EE-01', label: '  Front desk  ' }] });
  const saved = await current();
  check('a list is saved: MACs lower case with colons, labels trimmed', list.status === 200 && saved.approved[1].mac === 'aa:bb:cc:dd:ee:01' && saved.approved[1].label === 'Front desk' && !!saved.approved[1].addedAt, JSON.stringify(saved));
  check('  … filtering stays off when only the list is sent', saved.enabled === false);

  await put({ enabled: true });
  const on = await current();
  check('turning filtering on keeps the list', on.enabled === true && on.approved.length === 2 && on.approved[1].mac === 'aa:bb:cc:dd:ee:01', JSON.stringify(on));

  const noLocal = await put({ approved: [{ mac: 'aa:bb:cc:dd:ee:02', label: 'Canteen' }] });
  const kept = await current();
  check('the Server\'s own entry always stays', noLocal.status === 200 && kept.approved[0].mac === 'localhost' && kept.approved.some((a) => a.mac === 'aa:bb:cc:dd:ee:02'), JSON.stringify(kept.approved));

  const before = JSON.stringify(await current());
  for (const [change, error, what] of [
    [{ enabled: 'yes' }, 'macFiltering.enabled must be true or false', 'enabled that isn\'t true or false'],
    [{ approved: 'aa:bb' }, 'macFiltering.approved must be a list', 'a list that isn\'t a list'],
    [{ approved: [{ mac: 'aa:bb:cc' }] }, '"aa:bb:cc" isn\'t a MAC address (six pairs of hex digits, e.g. aa:bb:cc:dd:ee:ff)', 'a short MAC'],
    [{ approved: [{ mac: 'aa:bb:cc:dd:ee:03' }, { mac: 'AA:BB:CC:DD:EE:03' }] }, 'aa:bb:cc:dd:ee:03 is in the list twice', 'the same MAC twice'],
    ['on', 'macFiltering must be an object', 'something that isn\'t an object'],
  ]) {
    const r = await put(change);
    check(`${what} is refused (400), with the reason`, r.status === 400 && r.data.error === error, JSON.stringify(r.data));
  }
  check('  … and none of them changed anything', JSON.stringify(await current()) === before);

  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

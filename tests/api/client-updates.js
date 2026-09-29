// What a Client only asks its Server for, to update itself (SYSTEM_DESIGN §18.7 phase 3): the
// version (the Release on main, else <branch>@<short commit>) with a hash of the installer's files
// (a change elsewhere keeps it), the installer at the running commit as a tar.gz, its ed25519
// signature, and the public key; the key pair is made on first need, kept in data/, mode 600.
//   node tests/run.js api client-updates
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeApp, server, check, done, git } = require('../helpers/app.js');

(async () => {
  const env = makeApp({ port: 3934 });
  git(env.APP, 'checkout', '-q', '-B', 'main');
  git(env.APP, 'tag', 'v0.9.0');
  const head = git(env.APP, 'rev-parse', 'HEAD');
  const keyFile = path.join(env.APP, 'data', 'client-signing.key');
  const s = server(env);
  await s.start();
  const get = async (p) => { const r = await fetch(env.base + p); return { status: r.status, type: r.headers.get('content-type') || '', body: Buffer.from(await r.arrayBuffer()) }; };
  const json = async (p) => JSON.parse((await get(p)).body.toString());

  check('no key before a Client asks for one', !fs.existsSync(keyFile));
  let v = await json('/api/client/version');
  check('on main at a Release: its tag, the commit and a hash', v.version === 'v0.9.0' && v.commit === head && /^[0-9a-f]{64}$/.test(v.clientHash), JSON.stringify(v));
  check('  … without logging in (a Client has no password), and still no key', !fs.existsSync(keyFile));

  const key = await get('/api/client/key');
  check('the public key: a PEM, made on first need', key.status === 200 && key.body.toString().startsWith('-----BEGIN PUBLIC KEY-----') && fs.existsSync(keyFile));
  if (process.platform !== 'win32') check('  … the private key readable by the server only (600)', (fs.statSync(keyFile).mode & 0o777) === 0o600);
  const again = await get('/api/client/key');
  check('  … the same key when asked again', again.body.equals(key.body));

  const bundle = await get('/api/client/bundle');
  const sig = await get('/api/client/bundle.sig');
  check('the bundle: a tar.gz', bundle.status === 200 && /gzip/.test(bundle.type) && bundle.body[0] === 0x1f && bundle.body[1] === 0x8b, bundle.type);
  check('the signature: 64 bytes', sig.status === 200 && sig.body.length === 64, String(sig.body.length));
  const publicKey = crypto.createPublicKey(key.body.toString());
  check('  … which verifies with the public key', crypto.verify(null, bundle.body, publicKey, sig.body));
  const changed = Buffer.from(bundle.body); changed[changed.length - 1] ^= 1;
  check('  … and fails for a changed bundle', !crypto.verify(null, changed, publicKey, sig.body));

  // openssl on the Client checks it the same way (installers/client/noticeboard-client)
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-client-'));
  for (const [f, b] of [['bundle.tar.gz', bundle.body], ['bundle.sig', sig.body], ['server.pub', key.body]]) fs.writeFileSync(path.join(T, f), b);
  const ssl = spawnSync('openssl', ['pkeyutl', '-verify', '-pubin', '-inkey', 'server.pub', '-rawin', '-in', 'bundle.tar.gz', '-sigfile', 'bundle.sig'], { cwd: T, encoding: 'utf8' });
  if (ssl.error) console.log('  skip  openssl isn\'t here: the signature checked by Node only');
  else check('  … and with openssl, as a Client checks it', ssl.status === 0, (ssl.stdout + ssl.stderr).trim());
  const list = spawnSync('tar', ['-tzf', 'bundle.tar.gz'], { cwd: T, encoding: 'utf8' }).stdout.split(/\r?\n/);
  check('the bundle holds the installer and the Client\'s parts only', ['installers/install.sh', 'installers/lib/client.sh', 'installers/client/kiosk.sh', 'installers/client/noticeboard-client', 'installers/root/noticeboard-system'].every((f) => list.includes(f))
    && !list.some((f) => f.startsWith('server/') || f.startsWith('installers/update.sh')), list.filter((f) => !f.endsWith('/')).slice(0, 8).join(' '));
  fs.rmSync(T, { recursive: true, force: true });

  // A change outside the installer keeps the hash (no screen restarts); one inside changes it
  fs.appendFileSync(path.join(env.APP, 'README.md'), '\nA change.\n');
  git(env.APP, 'commit', '-qam', 'readme');
  const readme = await json('/api/client/version');
  check('a Server update outside the installer: a new version, the same hash', readme.commit !== head && readme.version === `main@${readme.commit.slice(0, 7)}` && readme.clientHash === v.clientHash, JSON.stringify(readme));
  const newBundle = await get('/api/client/bundle');
  const newSig = await get('/api/client/bundle.sig');
  check('  … its bundle made for the new commit, signed with the same key', crypto.verify(null, newBundle.body, publicKey, newSig.body)
    && fs.readdirSync(path.join(env.APP, 'tmp')).filter((f) => f.startsWith('client-bundle-') && f.endsWith('.tar.gz')).length === 2);
  fs.appendFileSync(path.join(env.APP, 'installers', 'client', 'kiosk.sh'), '\n# A change.\n');
  git(env.APP, 'commit', '-qam', 'kiosk');
  v = await json('/api/client/version');
  check('a change to the Client\'s files: a new hash', v.clientHash !== readme.clientHash);

  git(env.APP, 'checkout', '-q', '-b', 'feature/x');
  v = await json('/api/client/version');
  check('on a branch: <branch>@<short commit>', v.version === `feature/x@${v.commit.slice(0, 7)}`, v.version);

  await s.stop();
  done(env);
})().catch((e) => { console.error(e); process.exit(1); });

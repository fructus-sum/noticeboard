// server/services/clientBundle.js — what a Client only downloads from its Server to update itself
//
// Responsibilities
//   The Server's side of "Clients follow their Server" (SYSTEM_DESIGN §18.7 phase 3): which version
//   of the Client's files it runs, those files as one signed bundle, and the public key a Client
//   pins at install. It never finds, tracks or contacts Clients: they ask.
//   The bundle is the installer at the running commit (installers/install.sh, lib/, client/, root/,
//   `git archive`), made once per commit in tmp/; a Client verifies its ed25519 signature with the
//   pinned key, then runs that installer with --apply. The key pair is made on first need
//   (data/client-signing.key, mode 600) and kept by Restore Defaults (contentReset KEPT_DATA).
//
// Provides
//   version()    → Promise<{ version, commit, clientHash }>  version: the Release's tag on main,
//                  else <branch>@<short commit>; clientHash: a SHA-256 of the installer files'
//                  `git ls-tree` at the running commit (a Server update that doesn't touch them
//                  restarts no screen)
//   bundle()     → Promise<{ file, signature }>  the tar.gz's path and its signature (64 bytes)
//   publicKey()  → Promise<string>  the public key, PEM (SPKI)
//
// Used by
//   routes/api/client.js
//
// Uses
//   ./updates/git, ./updates/releases (releaseAt), utils/pathHelpers (clientKeyPath,
//   clientBundlePath); Node crypto
//
// Change impact
//   installers/client/noticeboard-client (on every Client only) reads these answers: the version's
//   fields, the bundle's layout (installers/…) and the signature's form (raw ed25519 over the whole
//   file, checked with `openssl pkeyutl -verify -rawin`) must stay as they are (§15).
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { git } = require('./updates/git');
const { releaseAt } = require('./updates/releases');
const { clientKeyPath, clientBundlePath } = require('../utils/pathHelpers');

// The installer's files a Client needs: its --apply runs from these alone
const PATHS = ['installers/install.sh', 'installers/lib', 'installers/client', 'installers/root'];

let keys = null;   // { privateKey, publicPem }, read or made once

async function signingKeys() {
  if (keys) return keys;
  let pem = await fs.readFile(clientKeyPath(), 'utf8').catch(() => null);
  if (!pem) {
    const pair = crypto.generateKeyPairSync('ed25519');
    pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const tmp = `${clientKeyPath()}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(clientKeyPath()), { recursive: true });
    await fs.writeFile(tmp, pem, { mode: 0o600 });
    await fs.rename(tmp, clientKeyPath());
  }
  const privateKey = crypto.createPrivateKey(pem);
  keys = { privateKey, publicPem: crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) };
  return keys;
}

async function version() {
  const commit = await git(['rev-parse', 'HEAD']);
  const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '');
  const release = branch === 'main' ? await releaseAt(commit) : null;
  const listing = await git(['ls-tree', '-r', commit, '--', ...PATHS]);
  return {
    version: release || `${branch || 'detached'}@${commit.slice(0, 7)}`,
    commit,
    clientHash: crypto.createHash('sha256').update(listing).digest('hex'),
  };
}

async function bundle() {
  const commit = await git(['rev-parse', 'HEAD']);
  const file = clientBundlePath(commit);
  const sigFile = `${file}.sig`;
  const made = await fs.readFile(sigFile).catch(() => null);
  if (made) return { file, signature: made };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await git(['archive', '--format=tar.gz', '-o', tmp, commit, '--', ...PATHS], 120000);
  const { privateKey } = await signingKeys();
  const signature = crypto.sign(null, await fs.readFile(tmp), privateKey);
  await fs.rename(tmp, file);
  await fs.writeFile(sigFile, signature);
  return { file, signature };
}

async function publicKey() {
  return (await signingKeys()).publicPem;
}

module.exports = { version, bundle, publicKey };

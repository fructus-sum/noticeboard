const { execFile, exec } = require('child_process');

// Checks this machine against a branch's system-requirements.json: whether each program it
// lists is installed, in a version the branch accepts. The list comes from a branch, so only
// plain program names and version flags from a fixed set are ever run (e.g. "ffmpeg -version").

const SAFE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;
const SAFE_ARGS = new Set(['--version', '-version', '-v', '-V', 'version']);

function parseVersion(text) {
  const m = String(text).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// e.g. "*", ">=4.0.0", ">=20.19.0 <21.0.0 || >=22.12.0": space-separated conditions must all
// hold; || separates alternatives
function satisfies(version, range) {
  if (!range || range.trim() === '*') return true;
  if (!version) return false;
  return range.split('||').some((alternative) => alternative.trim().split(/\s+/).every((condition) => {
    const m = condition.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/);
    if (!m) return false;
    const c = compare(version, parseVersion(m[2]));
    switch (m[1] || '=') {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  }));
}

// For people: ">=20.19.0 <21.0.0 || >=22.12.0" → "20.19.0 or newer (below 21.0.0), or 22.12.0 or newer"
function describe(range) {
  if (!range || range.trim() === '*') return 'any version';
  return range.split('||').map((alternative) => {
    const parts = alternative.trim().split(/\s+/);
    const min = parts.find((p) => p.startsWith('>='))?.slice(2);
    const below = parts.find((p) => p.startsWith('<') && !p.startsWith('<='))?.slice(1);
    if (min && below) return `${min} or newer (below ${below})`;
    if (min) return `${min} or newer`;
    return parts.join(' ');
  }).join(', or ');
}

// The program's version output, or null if it isn't installed or doesn't answer
function versionOutput(command, args) {
  const done = (resolve) => (err, stdout, stderr) => resolve(err ? null : `${stdout}${stderr}`);
  const direct = new Promise((resolve) => {
    execFile(command, args, { timeout: 10000, windowsHide: true }, done(resolve));
  });
  // On a Windows development PC, some programs (e.g. npm) are .cmd scripts. The command and
  // its arguments were checked against SAFE_COMMAND and SAFE_ARGS above.
  if (process.platform !== 'win32') return direct;
  return direct.then((out) => out ?? new Promise((resolve) => {
    exec(`${command}.cmd ${args.join(' ')}`, { timeout: 10000, windowsHide: true }, done(resolve));
  }));
}

async function checkOne(item) {
  const result = {
    name: String(item.name || '?'),
    neededFor: String(item.neededFor || ''),
    install: String(item.install || ''),
    required: describe(item.versions),
    found: null,
    installed: false,
    ok: false,
  };
  const commands = (Array.isArray(item.commands) ? item.commands : []).filter((c) => SAFE_COMMAND.test(c));
  const args = (Array.isArray(item.versionArgs) ? item.versionArgs : ['--version']).filter((a) => SAFE_ARGS.has(a));
  for (const command of commands) {
    // Node.js: the one running this server is the one that matters
    const out = command === 'node' ? process.version : await versionOutput(command, args);
    if (out === null) continue;
    const version = parseVersion(out);
    result.installed = true;
    result.found = version ? version.join('.') : 'installed';
    result.ok = satisfies(version, item.versions);
    break;
  }
  return result;
}

// { results: [...], missing: <how many aren't installed or are too old> }
async function checkRequirements(manifest) {
  const software = Array.isArray(manifest?.software) ? manifest.software.slice(0, 30) : [];
  const results = await Promise.all(software.map(checkOne));
  return { results, missing: results.filter((r) => !r.ok).length };
}

module.exports = { checkRequirements, satisfies, describe, parseVersion };

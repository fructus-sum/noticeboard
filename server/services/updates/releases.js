// server/services/updates/releases.js — main's version: the latest published GitHub Release
//
// Responsibilities
//   The admin panel's side of main following Releases (SYSTEM_DESIGN §18.6): asking GitHub for
//   main's latest Release (the branch check before a switch to main) and naming the Release a
//   commit is (the version shown). installers/lib/release.sh asks GitHub the same question for
//   update.sh and the installer, with the same three answers (§14 D48).
//
// Provides
//   latestRelease()            → Promise<{ tag, commit } | null>  the latest published Release,
//                                its tag fetched into this installation; null: none published yet
//                                (GitHub's 404, or an answer marked draft or prerelease). Rejects
//                                when GitHub can't be asked or the tag can't be fetched
//   releaseAt(commit = 'HEAD') → Promise<string | null>  the Release that commit is: the highest
//                                vX.Y.Z tag on it in this installation (update.sh and the installer
//                                fetch the tag they install), or null
//   versionName(tag)           → '0.8.0' for 'v0.8.0'
//
// Used by
//   services/updates/index.js (checkBranch, getInfo, versionInfo), services/updates/installerVersion.js
//
// Uses
//   ./git, ./branchName (the tag must be a name git accepts); fetch; NOTICEBOARD_GITHUB_API, the
//   API's address (https://api.github.com unless a test sets a stand-in)
//
// Change impact
//   Must answer as installers/lib/release.sh does, or the branch check would promise a Release
//   that update.sh then doesn't install. The tag format vX.Y.Z is the §19 checklist's.
const { git } = require('./git');
const { validBranchName } = require('./branchName');

const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function apiUrl() {
  return `${process.env.NOTICEBOARD_GITHUB_API || 'https://api.github.com'}/repos/fructus-sum/noticeboard/releases/latest`;
}

async function latestRelease() {
  const res = await fetch(apiUrl(), {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'noticeboard' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = await res.json();
  if (body?.draft === true || body?.prerelease === true) return null;
  const tag = body?.tag_name;
  if (!validBranchName(tag)) throw new Error("GitHub's answer has no usable tag");
  await git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`], 180000);
  const commit = await git(['rev-parse', '--verify', '-q', `refs/tags/${tag}^{commit}`]);
  return { tag, commit };
}

async function releaseAt(commit = 'HEAD') {
  const out = await git(['tag', '--points-at', commit]).catch(() => '');
  const parts = (tag) => VERSION_TAG.exec(tag).slice(1).map(Number);
  const tags = out.split('\n').filter((t) => VERSION_TAG.test(t))
    .sort((a, b) => {
      const [x, y] = [parts(a), parts(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
  return tags[0] || null;
}

function versionName(tag) {
  return String(tag).replace(/^v/, '');
}

module.exports = { latestRelease, releaseAt, versionName };

// tests/helpers/github.js — a stand-in for GitHub's Releases API, for the server under test
//
// Provides
//   startFakeGitHub(mockDir) → Promise<{ url, close() }>  an HTTP server answering
//     GET /repos/fructus-sum/noticeboard/releases/latest as GitHub does, from the same files as the
//     bash stand-in (tests/helpers/github.sh), so the server and update.sh see the same Releases:
//     <mockDir>/release (the latest Release's tag; missing: 404), release-kind ("draft" or
//     "prerelease"), github-down (the connection is dropped). Pass its url to the server as
//     NOTICEBOARD_GITHUB_API.
//
// Used by
//   tests/api/branch-switching.js, tests/browser/branch-switching.js, tests/browser/admin-pages-look.js
const fs = require('fs');
const http = require('http');
const path = require('path');

function startFakeGitHub(mockDir) {
  const read = (name) => { try { return fs.readFileSync(path.join(mockDir, name), 'utf8').trim(); } catch { return ''; } };
  const server = http.createServer((req, res) => {
    if (fs.existsSync(path.join(mockDir, 'github-down'))) { req.socket.destroy(); return; }
    const tag = read('release');
    if (req.url !== '/repos/fructus-sum/noticeboard/releases/latest' || !tag) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"message":"Not Found"}');
      return;
    }
    const kind = read('release-kind');
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ tag_name: tag, name: tag, draft: kind === 'draft', prerelease: kind === 'prerelease' }, null, 2));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

module.exports = { startFakeGitHub };

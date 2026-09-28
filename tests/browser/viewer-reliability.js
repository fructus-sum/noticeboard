// Real-browser reliability tests for the display. The test runs its own server so it can crash,
// stop and update it. Each scenario gets a brand-new browser tab. Slide changes are recorded
// from outside the page (so they survive reloads and freezes): every 250 ms the test asks the
// page which slide is on top.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { connect } = require('../helpers/cdp.js');

const { MODULES: modules, makeApp } = require('../helpers/app.js');
const ENV = makeApp({ port: 3924, keepSample: true });
const appDir = ENV.APP;
// NB_RELIABILITY_ONLY=AD runs only scenarios A and D (the baseline always runs)
const only = process.env.NB_RELIABILITY_ONLY;
const sharp = require(path.join(modules, 'sharp'));
const BASE = ENV.base;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const run = (letter) => !only || only.includes(letter);
let ok = true;
const check = (name, pass, d = '') => { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${d ? '  (' + d + ')' : ''}`); };

// ── server ──
let server = null;
async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/auth/status')).ok) return; } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error('server did not start');
}
async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: appDir, env: { ...process.env, NODE_PATH: modules }, stdio: 'ignore' });
  await waitUp();
  await login();
}
async function killServer() {   // like a crash or a power cut: no clean shutdown
  if (!server) return;
  const s = server; server = null;
  s.kill();
  await new Promise((r) => s.on('exit', r));
  await sleep(300);
}
let cookie = '';
const api = async (method, p, body) => {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + '/api' + p, { method, headers: { Cookie: cookie, ...(isForm || !body ? {} : { 'Content-Type': 'application/json' }) }, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}`);
  return { data: await res.json().catch(() => null), res };
};
async function login() {
  cookie = (await api('POST', '/auth/login', { password: 'Admin@12345' })).res.headers.get('set-cookie').split(';')[0];
}
let scratch = null;
async function resendPlaylist() {   // an upload finishing anywhere re-sends the playlist to every display
  const form = new FormData();
  form.append('files', new Blob([await sharp({ create: { width: 32, height: 32, channels: 3, background: '#777' } }).png().toBuffer()], { type: 'image/png' }), 'r.png');
  await api('POST', `/slideshows/${scratch}/slides`, form);
}

// ── a display in a fresh tab, watched from outside ──
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => undefined)]);
async function openDisplay() {
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Network.enable');
  await c.send('Page.navigate', { url: BASE + '/' });
  const changes = [];   // { file, t }
  let polling = true;
  (async () => {
    let last = null;
    while (polling) {
      const src = await withTimeout(c.evaluate(`[...document.querySelectorAll('.slide-img, .slide-video')].pop()?.getAttribute('src') ?? null`).catch(() => undefined), 1_000);
      if (src && src !== last) { changes.push({ file: src.split('/').pop(), t: Date.now() }); last = src; }
      await sleep(250);
    }
  })();
  await sleep(6_000);
  const since = (t) => changes.filter((x) => x.t > t);
  const waitForChange = async (t, maxMs) => {
    const end = Date.now() + maxMs;
    while (Date.now() < end) { const x = since(t)[0]; if (x) return x; await sleep(100); }
    return null;
  };
  const timeline = (from) => changes.filter((x) => x.t >= from).map((x) => `${x.file.slice(0, 6)}@${secs(x.t - from)}`).join('  ');
  return { c, changes, since, waitForChange, timeline, close: () => { polling = false; c.close(); } };
}

(async () => {
  await startServer();
  const sample = (await api('GET', '/slideshows')).data.find((s) => s.name === 'Sample slideshow');
  await api('PUT', `/slideshows/${sample.folder}`, { enabled: true });
  const files = (await api('GET', `/slideshows/${sample.folder}/slides`)).data.map((s) => s.filename);
  scratch = (await api('POST', '/slideshows', { name: 'zz trigger' })).data.folder;

  {
    const d = await openDisplay();
    const t = Date.now();
    await sleep(12_000);
    check('baseline: the sample cycles (images 3 s, the video plays in full)', d.since(t).length >= 3, `${d.since(t).length} changes in 12 s`);
    d.close();
  }

  if (run('A')) {
    // A: a slide whose image download hangs forever
    const d = await openDisplay();
    const stuckFile = files[1];
    await d.c.send('Network.setCacheDisabled', { cacheDisabled: true });
    let paused = 0;
    d.c.on((msg) => { if (msg.method === 'Fetch.requestPaused') paused += 1; });   // never answered
    await d.c.send('Fetch.enable', { patterns: [{ urlPattern: `*${stuckFile}`, requestStage: 'Request' }] });
    const t0 = Date.now();
    let reached = null;
    while (!reached && Date.now() - t0 < 60_000) { reached = d.since(t0).find((x) => x.file === stuckFile); await sleep(200); }
    const moved = reached && await d.waitForChange(reached.t, 45_000);
    const stayed = moved ? moved.t - reached.t : Infinity;
    // Since 0.7.0 (every screen in step, SYSTEM_DESIGN §18.8) it keeps its place for its 3 s, as the
    // other screens show it, rather than holding the slideshow up to a 30 s deadline
    check('A: an image whose download never finishes keeps its place for its time, then the slideshow moves on', paused > 0 && stayed >= 2_000 && stayed <= 4_500, `download held back ${paused}x; moved on after ${secs(stayed)}`);
    d.close();
  }

  if (run('B')) {
    // B: the page is frozen (as a sleeping or hidden screen can be), then resumes
    const d = await openDisplay();
    await d.c.send('Page.setWebLifecycleState', { state: 'frozen' });
    await sleep(20_000);
    const resumed = Date.now();
    await d.c.send('Page.setWebLifecycleState', { state: 'active' });
    const next = await d.waitForChange(resumed, 15_000);
    await sleep(45_000 - (Date.now() - resumed));
    // Headless Chrome keeps a resumed page 'hidden' (timers once a second, videos paused), the
    // harshest case: a paused video is skipped at its 30 s stall limit, then images carry on
    check('B: after 20 s frozen the slideshow continues, even in a page still marked hidden',
      !!next && next.t - resumed <= 8_000 && d.since(resumed).length >= 3,
      `${next ? 'next slide ' + secs(next.t - resumed) + ' after resuming' : 'no change'}; ${d.since(resumed).length} changes in 45 s; ${d.timeline(resumed)}`);
    d.close();
  }

  if (run('C')) {
    // C: the server disappears for 40 s, then comes back
    const d = await openDisplay();
    const down = Date.now();
    await killServer();
    await sleep(40_000);
    await startServer();
    const up = Date.now();
    const next = await d.waitForChange(up, 30_000);
    await sleep(20_000);
    const after = d.since(up).length;
    check('C: after a 40 s server outage the display reconnects and carries on', !!next && after >= 4,
      `${next ? 'first change ' + secs(next.t - up) + ' after the server was back' : 'no change'}, ${after} changes in 20 s`);
    console.log(`      timeline from the outage (server back at ${secs(up - down)}): ${d.timeline(down)}`);
    d.close();
  }

  if (run('D')) {
    // D: a software update: new display build, server restarted
    const d = await openDisplay();
    await d.c.evaluate('window.__beforeUpdate = true');
    const index = path.join(appDir, 'client/display/dist/index.html');
    fs.appendFileSync(index, `\n<!-- update ${Date.now()} -->\n`);
    await killServer();
    await startServer();
    const up = Date.now();
    let reloaded = false;
    for (let i = 0; i < 60 && !reloaded; i++) { await sleep(500); reloaded = (await withTimeout(d.c.evaluate('window.__beforeUpdate === undefined').catch(() => false), 1_000)) === true; }
    const next = await d.waitForChange(up + 1_000, 20_000);
    check('D: after an update the display reloads itself onto the new build and carries on', reloaded && !!next, `reloaded: ${reloaded}; slides changing again: ${!!next}`);
    d.close();
  }

  if (run('E')) {
    // E: four minutes of random disruptions
    const d = await openDisplay();
    const windows = [];
    const kinds = ['resend', 'resend-first', 'slow-cpu', 'offline', 'crash'];   // freezing is covered by B
    const endAt = Date.now() + 4 * 60_000;
    let n = 0;
    while (Date.now() < endAt) {
      await sleep(8_000 + Math.random() * 10_000);
      const kind = kinds[n++ % kinds.length];
      const start = Date.now();
      if (kind === 'resend') await resendPlaylist();
      if (kind === 'resend-first') {   // the original bug: re-send while the first slide shows
        const t = Date.now();
        while (Date.now() - t < 30_000 && d.changes[d.changes.length - 1]?.file !== files[0]) await sleep(100);
        await resendPlaylist();
      }
      if (kind === 'slow-cpu') { await d.c.send('Emulation.setCPUThrottlingRate', { rate: 20 }); await sleep(8_000); await d.c.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
      if (kind === 'offline') {
        await d.c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await sleep(5_000 + Math.random() * 10_000);
        await d.c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      }
      if (kind === 'crash') { await killServer(); await sleep(3_000 + Math.random() * 7_000); await startServer(); }
      windows.push({ kind, start, end: Date.now() });
    }
    await sleep(20_000);
    const recover = 45_000;
    const inWindow = (t) => windows.some((w) => t >= w.start && t <= w.end + recover);
    let worst = 0;
    const tail = d.changes.filter((x) => x.t >= windows[0].start - 20_000);
    for (let i = 1; i < tail.length; i++) if (!inWindow(tail[i].t) && !inWindow(tail[i - 1].t)) worst = Math.max(worst, tail[i].t - tail[i - 1].t);
    const recoveries = windows.map((w) => { const x = d.since(w.end)[0]; return x ? x.t - w.end : Infinity; });
    console.log(`      disruptions: ${windows.map((w) => w.kind).join(', ')}`);
    console.log(`      time to next slide after each: ${recoveries.map(secs).join(', ')}`);
    check('E: after every disruption the slideshow moved on within 45 s', recoveries.every((r) => r <= recover), `slowest ${secs(Math.max(...recoveries))}`);
    check('E: between disruptions, no gap longer than 10 s', worst <= 10_000, `longest ${secs(worst)}`);
    const t = Date.now();
    await sleep(15_000);
    const end = await d.c.evaluate('({ visibility: document.visibilityState, clock: window.noticeboard && window.noticeboard.slideshow() })');
    check('E: still cycling at the end', d.since(t).length >= 3, `${d.since(t).length} changes in the last 15 s; page ${end.visibility}; clock ${JSON.stringify({ ...end.clock, deadline: end.clock && end.clock.deadline - Date.now() })}`);
    d.close();
  }

  await api('DELETE', `/slideshows/${scratch}`).catch(() => {});
  await api('PUT', `/slideshows/${sample.folder}`, { enabled: false }).catch(() => {});
  await killServer();
  fs.rmSync(ENV.T, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch(async (e) => { console.error('ERROR', e); await killServer(); process.exit(1); });

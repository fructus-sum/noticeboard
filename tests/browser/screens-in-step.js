// Every screen in step (SYSTEM_DESIGN §18.8). Two viewers in one browser, each told its own clock is
// minutes out (?debugClockOffset, in opposite directions), must still agree on the Server's time
// (phase 1).
const { makeApp, server, page, check, done, sleep } = require('../helpers/app.js');
const { connect } = require('../helpers/cdp.js');

(async () => {
  const env = makeApp({ port: 3968 });
  const s = server(env);
  await s.start();

  const viewer = async (offsetMs) => {
    const v = await page(connect, { width: 480, height: 270 });
    await v.go(`${env.base}/?kiosk=off&debugClockOffset=${offsetMs}`);
    return v;
  };
  const a = await viewer(-5 * 60_000);
  const b = await viewer(3 * 60_000 + 417);
  const synced = (v) => v.until('window.noticeboardClock && window.noticeboardClock().synced', 10000);
  check('both screens measure their clock against the Server\'s', await synced(a) && await synced(b));

  // The Server's time here is this machine's own clock (the test and the Server share it)
  const read = async (v) => { const before = Date.now(); const c = await v.evaluate('window.noticeboardClock()'); const after = Date.now(); return { ...c, truth: (before + after) / 2 }; };
  const ca = await read(a);
  const cb = await read(b);
  check('a clock 5 minutes slow: its Server time is right (within 100 ms)', Math.abs(ca.serverNow - ca.truth) < 100 && Math.abs(ca.offset - 5 * 60_000) < 100, JSON.stringify({ off: ca.serverNow - ca.truth, offset: ca.offset, roundTrip: ca.roundTrip }));
  check('a clock 3 minutes fast: its Server time is right (within 100 ms)', Math.abs(cb.serverNow - cb.truth) < 100, JSON.stringify({ off: cb.serverNow - cb.truth, offset: cb.offset, roundTrip: cb.roundTrip }));

  a.close();
  b.close();
  await s.stop();
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

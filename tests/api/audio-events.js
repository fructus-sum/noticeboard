// Event audio (SYSTEM_DESIGN §18.3, phase 6): PUT /api/audioshows/:folder/event checked (modes,
// times, the end after the start and not passed), overlaps with another show's scheduled event
// refused (409, naming it), removing it; each show's eventState; and audio:update's event: a
// start-now event, a once event already running taking over, back to the start-now one when it's
// removed, and none for an unpublished show.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MODULES, makeApp, server, check, done, sleep, ffmpegEnv, hasFfmpeg } = require('../helpers/app.js');
const { io } = require(path.join(MODULES, 'socket.io-client'));

if (!hasFfmpeg()) {
  console.log('SKIPPED: needs ffmpeg (FFMPEG_PATH and FFPROBE_PATH, or ffmpeg on the PATH)');
  process.exit(0);
}
const FFMPEG = ffmpegEnv().FFMPEG_PATH || 'ffmpeg';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-audio-events-'));
execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', path.join(dir, 'tone.mp3')]);

// Local 'YYYY-MM-DDTHH:MM', minutes from now
const local = (minutes) => {
  const d = new Date(Date.now() + minutes * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

(async () => {
  const env = makeApp({ port: 3958 });
  const s = server(env);
  await s.start();
  await s.login();

  // Two published shows with a track each
  const make = async (name) => {
    const folder = (await s.api('POST', '/api/audioshows', { name })).data.folder;
    const form = new FormData();
    form.append('files', new Blob([fs.readFileSync(path.join(dir, 'tone.mp3'))], { type: 'audio/mpeg' }), 'tone.mp3');
    await s.api('POST', `/api/audioshows/${folder}/tracks`, form);
    for (let i = 0; i < 300; i++) {
      if ((await s.api('GET', `/api/audioshows/${folder}/tracks`)).data.every((t) => t.status === 'ready')) break;
      await sleep(100);
    }
    await s.api('PUT', `/api/audioshows/${folder}`, { enabled: true });
    return folder;
  };
  const drill = await make('Fire drill');
  const fair = await make('Summer fair');
  const put = (folder, body) => s.api('PUT', `/api/audioshows/${folder}/event`, body);

  for (const [body, what] of [
    [{ mode: 'sometimes' }, 'an unknown mode'],
    [{ mode: 'once', from: 'tomorrow', to: local(60) }, 'a start that isn\'t a date and time'],
    [{ mode: 'once', from: local(60), to: local(30) }, 'an end before the start'],
    [{ mode: 'once', from: local(-120), to: local(-60) }, 'a time that has passed'],
    [{ mode: 'repeat', days: [], startTime: '10:00', endTime: '11:00' }, 'no days'],
    [{ mode: 'repeat', days: [1], startTime: '11:00', endTime: '10:00' }, 'an end before the start'],
    [{ mode: 'repeat', days: [7], startTime: '10:00', endTime: '11:00' }, 'a day that doesn\'t exist'],
  ]) {
    const r = await put(fair, body);
    check(`${what} is refused (400)`, r.status === 400, JSON.stringify(r.data));
  }

  const weekly = await put(fair, { mode: 'repeat', days: [6, 0], startTime: '10:00', endTime: '16:00' });
  check('a repeating event is saved (days sorted), with when it next plays', weekly.status === 200 && JSON.stringify(weekly.data.event) === JSON.stringify({ mode: 'repeat', days: [0, 6], startTime: '10:00', endTime: '16:00' })
    && ['next', 'playing'].includes(weekly.data.eventState?.state), JSON.stringify(weekly.data));
  const clash = await put(drill, { mode: 'repeat', days: [6], startTime: '15:00', endTime: '17:00' });
  check('an overlapping event is refused (409), naming the other show', clash.status === 409 && clash.data.error === 'Clashes with “Summer fair” (Sun, Sat 10:00–16:00)', JSON.stringify(clash.data));
  check('  … and nothing was saved', !(await s.api('GET', `/api/audioshows/${drill}`)).data.event);

  // What the screens are told
  const got = [];
  const sock = io(env.base, { transports: ['websocket'] });
  sock.on('audio:update', (a) => got.push(a));
  sock.on('connect', () => sock.emit('display:ready'));
  const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (got.length && fn(got[got.length - 1])) return true; await sleep(50); } return false; };
  // Not playing now unless it's a weekend daytime; clear it so the test is the same any day
  await put(fair, { event: null });
  check('no event: none on the screens', await until((a) => a.event === null));

  const now = await put(drill, { mode: 'now' });
  check('Start now: saved, playing', now.status === 200 && now.data.event.mode === 'now' && now.data.eventState?.state === 'playing', JSON.stringify(now.data));
  check('  … and every screen is told to play it', await until((a) => a.event === drill && !!a.shows[drill]), JSON.stringify(got[got.length - 1]));

  const once = await put(fair, { mode: 'once', from: local(-30), to: local(60) });
  check('a once event already running takes over', once.status === 200 && await until((a) => a.event === fair), JSON.stringify(got[got.length - 1]));
  const list = (await s.api('GET', '/api/audioshows')).data;
  check('  … the list says which is playing', list.find((x) => x.folder === fair).eventState?.state === 'playing' && list.find((x) => x.folder === drill).eventState?.state !== 'playing', JSON.stringify(list.map((x) => [x.folder, x.eventState])));

  await put(fair, { event: null });
  check('removing it: back to the one started by hand (it started before that one was started)', await until((a) => a.event === drill));
  await s.api('PUT', `/api/audioshows/${drill}`, { enabled: false });
  check('an unpublished show\'s event doesn\'t play', await until((a) => a.event === null));
  await s.api('PUT', `/api/audioshows/${drill}`, { enabled: true });
  check('published again: it plays', await until((a) => a.event === drill));
  const stopped = await put(drill, { event: null });
  check('Stop: the event is removed', stopped.status === 200 && !stopped.data.event && stopped.data.eventState === null && await until((a) => a.event === null));

  sock.close();
  await s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  done(env);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });

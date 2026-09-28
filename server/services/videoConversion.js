// server/services/videoConversion.js — converting the videos already uploaded to the chosen format
//
// Responsibilities
//   "Convert existing videos" (Settings → Display): every ready video in every slideshow that isn't
//   in the video format chosen now (settingsService.videoFormat) is converted, one at a time so the
//   Server stays usable (SYSTEM_DESIGN §14 D43). A video shows "processing" in the admin panel only while
//   it's its turn, and the screens keep playing its current file meanwhile (the slide is marked
//   reprocessing, which the playlist still shows); once the new file is ready it replaces the old
//   one, the slide is ready again and the displays get the new playlist. A video whose format isn't
//   recorded (uploaded before formats were) is checked with ffprobe first. A conversion writes into
//   tmp/noticeboard-uploads, so update.sh waits for it as for an upload.
//
// Provides
//   start()           → the status: starts a run (409 when one is running)
//   status()          → { running, total, done, converted, skipped, failed, current, format, finishedAt }
//   recover()         at start-up: a slide left marked by a run the server didn't finish is ready
//                     again with its old file (still there), and the unfinished outputs are deleted
//
// Used by
//   routes/api/settings/videos.js, server/index.js (recover)
//
// Uses
//   services/slideshowStore, services/mediaService (processVideo, getMediaDuration, videoFormatOf),
//   services/settingsService (videoFormat), services/displayEvents, utils/pathHelpers, utils/logger
//
// Change impact
//   The slide fields it sets (format, and reprocessing while it runs) are read by the playlist and
//   the admin panel (SYSTEM_DESIGN §6).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./slideshowStore');
const { processVideo, getMediaDuration, videoFormatOf } = require('./mediaService');
const { videoFormat } = require('./settingsService');
const displayEvents = require('./displayEvents');
const { slidesDir, tmpDir } = require('../utils/pathHelpers');
const logger = require('../utils/logger');

const WORK_PREFIX = 'convert-';   // tmp/noticeboard-uploads/convert-<random>/: update.sh waits for it
let state = { running: false, total: 0, done: 0, converted: 0, skipped: 0, failed: 0, current: null, format: null, finishedAt: null };

const status = () => ({ ...state });

// Every video that can be converted, across the slideshows
function readyVideos() {
  const videos = [];
  for (const { folder } of store.list()) {
    for (const slide of store.readSlides(folder).slides) {
      if (slide.type === 'video' && slide.status === 'ready' && slide.filename) videos.push({ folder, id: slide.id });
    }
  }
  return videos;
}

function patchSlide(folder, id, fn) {
  return store.modifySlides(folder, (data) => {
    const slide = data.slides.find((s) => s.id === id);
    return slide ? fn(slide) ?? slide : null;
  });
}

async function convertOne({ folder, id }, format) {
  // Its current state: it may have been deleted or changed since the run started
  const slide = store.readSlides(folder).slides.find((s) => s.id === id);
  if (!slide || slide.status !== 'ready' || !slide.filename) return 'skipped';
  const source = path.join(slidesDir(folder), slide.filename);
  const current = slide.format ?? await videoFormatOf(source);
  if (current === format) {
    if (!slide.format) await patchSlide(folder, id, (s) => { s.format = format; });
    return 'skipped';
  }

  state.current = slide.name || slide.originalName || slide.filename;
  await patchSlide(folder, id, (s) => { s.status = 'processing'; s.reprocessing = true; });
  const work = path.join(tmpDir(), `${WORK_PREFIX}${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const made = await processVideo(source, work, `${id}-${crypto.randomBytes(3).toString('hex')}`, format);
    const duration = await getMediaDuration(path.join(work, made));
    // Deleted meanwhile: the new file isn't needed
    const kept = await patchSlide(folder, id, () => {});
    if (!kept) return 'skipped';
    fs.renameSync(path.join(work, made), path.join(slidesDir(folder), made));
    const old = await patchSlide(folder, id, (s) => {
      const before = s.filename;
      Object.assign(s, { filename: made, format, status: 'ready', ...(duration ? { duration } : {}) });
      delete s.reprocessing;
      delete s.error;
      return before;
    });
    if (typeof old === 'string' && old !== made) fs.rmSync(path.join(slidesDir(folder), old), { force: true });
    displayEvents.playlistChanged();
    logger.info('Video converted', { folder, id, format });
    return 'converted';
  } catch (err) {
    // The old file is untouched: the slide is simply ready again
    await patchSlide(folder, id, (s) => { s.status = 'ready'; delete s.reprocessing; });
    logger.error('Video conversion failed', { folder, id, format, err: err.message });
    return 'failed';
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function run(videos, format) {
  for (const video of videos) {
    const result = await convertOne(video, format).catch((err) => {
      logger.error('Video conversion failed', { ...video, err: err.message });
      return 'failed';
    });
    state[result] += 1;
    state.done += 1;
    state.current = null;
  }
  state.running = false;
  state.finishedAt = new Date().toISOString();
  logger.info('Converting existing videos finished', { converted: state.converted, skipped: state.skipped, failed: state.failed });
}

function start() {
  if (state.running) throw Object.assign(new Error('Videos are already being converted.'), { status: 409, expose: true });
  const format = videoFormat();
  const videos = readyVideos();
  state = { running: videos.length > 0, total: videos.length, done: 0, converted: 0, skipped: 0, failed: 0, current: null, format, finishedAt: videos.length ? null : new Date().toISOString() };
  logger.info('Converting existing videos', { format, videos: videos.length });
  if (videos.length) run(videos, format);
  return status();
}

async function recover() {
  const dir = tmpDir();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(WORK_PREFIX)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }
  for (const { folder } of store.list()) {
    const fixed = await store.modifySlides(folder, (data) => {
      let n = 0;
      for (const s of data.slides) {
        if (s.reprocessing) {
          s.status = 'ready';
          delete s.reprocessing;
          n += 1;
        }
      }
      return n;
    });
    if (fixed) logger.warn('Video conversion interrupted by a restart: the videos keep their old files', { folder, videos: fixed });
  }
}

module.exports = { start, status, recover };

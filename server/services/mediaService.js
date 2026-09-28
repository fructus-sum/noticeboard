// server/services/mediaService.js — converting uploads into slides
//
// Provides
//   processImage(input, outDir, id) → a PNG
//   processVideo(input, outDir, id, format) → an MP4 with AAC sound at 48 kHz, its video 'h265' (HEVC, the
//                                     default: smaller) or 'h264' (plays everywhere), as chosen in
//                                     Settings → Display. Videos already processed keep their format
//                                     (SYSTEM_DESIGN §14 D43)
//   getMediaDuration(file) → a video's or audio file's length in whole seconds, or null (ffprobe)
//   createThumbnail(video, outDir, id) → a still for the admin panel
//   processAudio(input, outDir, id) → an AAC .m4a (192 kbit/s, 48 kHz), its loudness evened out (EBU R128,
//                                     -16 LUFS) so one track isn't much louder than the next
//   videoFormatOf(file) → 'h265' | 'h264' | another codec's name | null (ffprobe)
//
// Used by
//   services/uploadQueue, services/videoConversion
//
// Uses
//   sharp, fluent-ffmpeg (ffmpeg and ffprobe: FFMPEG_PATH / FFPROBE_PATH, else the PATH), utils/logger
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger');

// Which files are images or videos: services/mediaTypes.js

async function processImage(inputPath, outDir, slideId) {
  const outFilename = `${slideId}.png`;
  await sharp(inputPath).png().toFile(path.join(outDir, outFilename));
  logger.info('Image processed', { slideId, outFilename });
  return outFilename;
}

// The encoder settings for each video format: about the same quality, H.265 in a smaller file
const VIDEO_ENCODING = {
  h265: { codec: 'libx265', options: ['-crf 28', '-preset fast', '-tag:v hvc1', '-x265-params log-level=error'] },   // hvc1: the tag browsers expect in an MP4
  h264: { codec: 'libx264', options: ['-crf 23', '-preset fast'] },
};

// Every sound we produce has one sample rate: a device (e.g. a Pi's HDMI output) may not mix two
// streams at different rates, so a video's sound would silence the background music (SYSTEM_DESIGN
// §18.3 phase 8)
const AUDIO_RATE = 48000;

function processVideo(inputPath, outDir, slideId, format = 'h265') {
  const encoding = VIDEO_ENCODING[format] ?? VIDEO_ENCODING.h265;
  const outFilename = `${slideId}.mp4`;
  const outPath = path.join(outDir, outFilename);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec(encoding.codec)
      .audioCodec('aac')
      .audioFrequency(AUDIO_RATE)
      .outputOptions([
        ...encoding.options,
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-map 0:v:0',
        '-map 0:a:0?',   // audio optional — handles silent videos
      ])
      .on('end', () => {
        logger.info('Video processed', { slideId, outFilename, format });
        resolve(outFilename);
      })
      .on('error', (err) => {
        logger.error('Video processing failed', { slideId, err: err.message });
        reject(err);
      })
      .save(outPath);
  });
}

function processAudio(inputPath, outDir, trackId) {
  const outFilename = `${trackId}.m4a`;
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('aac')
      .audioBitrate('192k')
      .audioFilters('loudnorm=I=-16:TP=-1.5:LRA=11')
      .audioFrequency(AUDIO_RATE)   // loudnorm would otherwise raise it (to 96 kHz in AAC)
      .outputOptions(['-movflags +faststart', '-map 0:a:0'])
      .on('end', () => {
        logger.info('Audio processed', { trackId, outFilename });
        resolve(outFilename);
      })
      .on('error', (err) => {
        logger.error('Audio processing failed', { trackId, err: err.message });
        reject(err);
      })
      .save(path.join(outDir, outFilename));
  });
}

// The format a video is in, as Settings → Display names them
function videoFormatOf(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      const codec = metadata?.streams?.find((s) => s.codec_type === 'video')?.codec_name;
      if (err || !codec) return resolve(null);
      resolve({ hevc: 'h265', h264: 'h264' }[codec] ?? codec);
    });
  });
}

function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !metadata?.format?.duration) return resolve(null);
      resolve(Math.round(metadata.format.duration));
    });
  });
}

// A still picture of a video, for the admin panel's slide list and preview: the most typical
// frame of the second or so starting 10% of the way in (between 1 and 5 s, so not a black
// opening frame), at most 640 × 640 px. The video itself is only read.
async function createThumbnail(videoPath, outDir, slideId) {
  const seconds = await getMediaDuration(videoPath);
  const at = seconds ? Math.min(5, Math.max(1, seconds * 0.1), Math.max(0, seconds - 0.5)) : 0;
  const outFilename = `${slideId}-thumb.jpg`;
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(at)
      .frames(1)
      .outputOptions([
        '-vf', "thumbnail=25,scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease",
        '-q:v', '3',
      ])
      .on('end', resolve)
      .on('error', reject)
      .save(path.join(outDir, outFilename));
  });
  logger.info('Video thumbnail created', { slideId, outFilename, at });
  return outFilename;
}

module.exports = { processImage, processVideo, processAudio, getMediaDuration, createThumbnail, videoFormatOf };

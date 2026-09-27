// server/services/mediaService.js — converting uploads into slides
//
// Provides
//   processImage(input, outDir, id) → a PNG
//   processVideo(input, outDir, id) → an H.264 MP4 the Pi's browser plays
//   getVideoDuration(file), createThumbnail(video, outDir, id) → a still for the admin panel
//
// Used by
//   services/uploadQueue
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

function processVideo(inputPath, outDir, slideId) {
  const outFilename = `${slideId}.mp4`;
  const outPath = path.join(outDir, outFilename);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-map 0:v:0',
        '-map 0:a:0?',   // audio optional — handles silent videos
      ])
      .on('end', () => {
        logger.info('Video processed', { slideId, outFilename });
        resolve(outFilename);
      })
      .on('error', (err) => {
        logger.error('Video processing failed', { slideId, err: err.message });
        reject(err);
      })
      .save(outPath);
  });
}

function getVideoDuration(filePath) {
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
  const seconds = await getVideoDuration(videoPath);
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

module.exports = { processImage, processVideo, getVideoDuration, createThumbnail };

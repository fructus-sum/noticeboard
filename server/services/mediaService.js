const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger');

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg']);

function typeFromMime(mime) {
  if (IMAGE_MIME.has(mime)) return 'image';
  if (VIDEO_MIME.has(mime)) return 'video';
  return null;
}

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

module.exports = { typeFromMime, processImage, processVideo, getVideoDuration, IMAGE_MIME, VIDEO_MIME };

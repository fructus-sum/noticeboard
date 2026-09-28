// server/services/mediaService.js — converting uploads into slides
//
// Provides
//   processImage(input, outDir, id) → a PNG
//   processVideo(input, outDir, id, format) → an MP4 with AAC sound, its video 'h265' (HEVC, the
//                                     default: smaller) or 'h264' (plays everywhere), as chosen in
//                                     Settings → Display. Videos already processed keep their format
//                                     (SYSTEM_DESIGN §16 #12)
//   getVideoDuration(file), createThumbnail(video, outDir, id) → a still for the admin panel
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

function processVideo(inputPath, outDir, slideId, format = 'h265') {
  const encoding = VIDEO_ENCODING[format] ?? VIDEO_ENCODING.h265;
  const outFilename = `${slideId}.mp4`;
  const outPath = path.join(outDir, outFilename);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec(encoding.codec)
      .audioCodec('aac')
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

module.exports = { processImage, processVideo, getVideoDuration, createThumbnail, videoFormatOf };

// server/services/mediaTypes.js — which files count as images and videos, in one place
//
// Responsibilities
//   The lists of accepted uploads, served media and sample files. Each list stays exactly as it
//   was when it lived with its caller; this module only gives them one owner.
//
// Provides
//   IMAGE_MIME, VIDEO_MIME  Sets of the upload MIME types accepted as slides
//   typeFromMime(mime)      → 'image' | 'video' | null
//   LOGO_MIME               the MIME types accepted as a logo (the four image types)
//   SERVED_EXTENSIONS       file extensions /media serves (anything else is 404). It includes
//                           audio types nothing produces today; kept so nothing changes
//   SAMPLE_IMAGE_EXT, SAMPLE_VIDEO_EXT  which files in sample-data/sample-slideshow/ are slides
//
// Used by
//   routes/api/slides.js and routes/api/mediaItems.js (uploads), routes/api/settings/logo.js (logo
//   upload), routes/index.js (/media),
//   services/uploadQueue.js, services/sampleSlideshow.js
//
// Change impact
//   Adding a type here only helps if mediaService can process it and the viewer can show it.
//   Removing one refuses uploads, or stops serving files that are already on disk.
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg']);
// Audio tracks: what browsers send for MP3, WAV, Ogg, AAC/M4A, FLAC, Opus and WebM audio
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg',
  'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/flac', 'audio/x-flac', 'audio/opus', 'audio/webm']);

function typeFromMime(mime) {
  if (IMAGE_MIME.has(mime)) return 'image';
  if (VIDEO_MIME.has(mime)) return 'video';
  if (AUDIO_MIME.has(mime)) return 'audio';
  return null;
}

const LOGO_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const SERVED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.wav', '.ogg'];
// What /audio serves: the tracks as processed (AAC in .m4a)
const AUDIO_SERVED_EXTENSIONS = ['.m4a'];

const SAMPLE_IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const SAMPLE_VIDEO_EXT = /\.(mp4|webm)$/i;

module.exports = {
  IMAGE_MIME,
  VIDEO_MIME,
  AUDIO_MIME,
  typeFromMime,
  LOGO_MIME,
  SERVED_EXTENSIONS,
  AUDIO_SERVED_EXTENSIONS,
  SAMPLE_IMAGE_EXT,
  SAMPLE_VIDEO_EXT,
};

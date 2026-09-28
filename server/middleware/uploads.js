// server/middleware/uploads.js — receiving uploaded files
//
// Responsibilities
//   The one multer set-up: uploads wait in tmp/noticeboard-uploads/ until they're processed and
//   deleted. installers/update.sh waits while that folder has a file younger than an hour, so an
//   update never restarts the server in the middle of an upload: the folder must not change.
//
// Provides
//   createUpload({ prefix, maxFileBytes, allowed, rejectMessage }) → a multer instance (then
//     .array(field, n) or .single(field)). Files are saved as <prefix>-<time>-<random><ext>;
//     a type not in `allowed` is refused with an Error carrying status 400 and rejectMessage.
//     Each file's own name (originalname) is read as UTF-8, as browsers send it, so names with
//     accents or other scripts arrive intact (multer's default reads them as Latin-1)
//
// Used by
//   routes/api/mediaItems.js (every show's uploads: slides), routes/api/settings/logo.js (the logo)
//
// Uses
//   multer, utils/pathHelpers (tmpDir)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { tmpDir } = require('../utils/pathHelpers');

function createUpload({ prefix, maxFileBytes, allowed, rejectMessage }) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = tmpDir();
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '';
        cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: maxFileBytes },
    defParamCharset: 'utf8',
    fileFilter: (req, file, cb) => {
      if (allowed.has ? allowed.has(file.mimetype) : allowed.includes(file.mimetype)) return cb(null, true);
      cb(Object.assign(new Error(rejectMessage), { status: 400 }));
    },
  });
}

module.exports = { createUpload };

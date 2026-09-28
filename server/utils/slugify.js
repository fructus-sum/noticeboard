// server/utils/slugify.js — folder names for new shows (slideshows, audio shows)
//
// Provides
//   slugify(name, fallback) → lower-case letters, digits and hyphens; accented letters lose only
//                             their accent (é → e); fallback when nothing is left ('slideshow'
//                             unless given). Only new folders are named by it: existing ones stay
//   uniqueSlug(name, { dir, fallback }) → a slug no existing folder in dir uses (adds -2, -3…);
//                             dir is data/slideshows unless given
//
// Used by
//   services/showStore (create), services/sampleSlideshow
//
// Uses
//   utils/pathHelpers (slideshowsDir, the default folder for uniqueSlug)
const fs = require('fs');
const path = require('path');
const { slideshowsDir } = require('./pathHelpers');

function slugify(name, fallback = 'slideshow') {
  return (
    name
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é → e: accented letters keep their letter
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || fallback
  );
}

function uniqueSlug(name, { dir = slideshowsDir(), fallback } = {}) {
  const base = slugify(name, fallback);

  if (!fs.existsSync(path.join(dir, base))) return base;

  let counter = 2;
  while (fs.existsSync(path.join(dir, `${base}-${counter}`))) {
    counter++;
  }
  return `${base}-${counter}`;
}

module.exports = { slugify, uniqueSlug };

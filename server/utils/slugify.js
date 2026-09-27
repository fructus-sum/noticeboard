// server/utils/slugify.js — folder names for new slideshows
//
// Provides
//   slugify(name) → lower-case letters, digits and hyphens
//   uniqueSlug(name) → a slug no existing folder in data/slideshows uses (adds -2, -3…)
//
// Used by
//   services/slideshowStore (create), services/sampleSlideshow
const fs = require('fs');
const path = require('path');
const { slideshowsDir } = require('./pathHelpers');

function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'slideshow'
  );
}

function uniqueSlug(name) {
  const base = slugify(name);
  const dir = slideshowsDir();

  if (!fs.existsSync(path.join(dir, base))) return base;

  let counter = 2;
  while (fs.existsSync(path.join(dir, `${base}-${counter}`))) {
    counter++;
  }
  return `${base}-${counter}`;
}

module.exports = { slugify, uniqueSlug };

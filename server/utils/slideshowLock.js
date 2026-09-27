// server/utils/slideshowLock.js — one read-modify-write of a slideshow.json at a time
//
// Without it, two updates that overlap (e.g. two uploads finishing together) each read the file,
// change their own slide and save it, and the later save wipes out the earlier. Wrap the whole
// read → change → write step, and never nest it for the same folder.
//
// Provides
//   withSlideshowLock(folder, fn) → fn's result, run after any earlier one for that folder
//
// Used by
//   services/slideshowStore (modifySlides)
const tails = new Map();   // folder -> promise that settles when its queued updates finish

function withSlideshowLock(folder, fn) {
  const previous = tails.get(folder) || Promise.resolve();
  const result = previous.then(() => fn());
  const tail = result.catch(() => {});   // a failed update must not block the next one
  tails.set(folder, tail);
  tail.then(() => {
    if (tails.get(folder) === tail) tails.delete(folder);
  });
  return result;
}

module.exports = { withSlideshowLock };

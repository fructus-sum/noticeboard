// server/utils/folderLock.js — one read-modify-write of a show's JSON file at a time
//
// Without it, two updates that overlap (e.g. two uploads finishing together) each read the file,
// change their own item and save it, and the later save wipes out the earlier. Wrap the whole
// read → change → write step, and never nest it for the same key.
//
// Provides
//   withFolderLock(key, fn) → fn's result, run after any earlier one for that key (a store uses
//                             "<kind>:<folder>", so a slideshow and an audio show never share a lock)
//
// Used by
//   services/showStore (modifyItems)
const tails = new Map();   // key -> promise that settles when its queued updates finish

function withFolderLock(key, fn) {
  const previous = tails.get(key) || Promise.resolve();
  const result = previous.then(() => fn());
  const tail = result.catch(() => {});   // a failed update must not block the next one
  tails.set(key, tail);
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}

module.exports = { withFolderLock };

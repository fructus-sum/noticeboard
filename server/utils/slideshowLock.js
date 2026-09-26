// Runs read-modify-write updates of a slideshow's slideshow.json one at a time.
// Without it, two updates that overlap (e.g. two uploads finishing together) each read
// the file, change their own slide and save it, and the later save wipes out the earlier.
// Wrap the whole read → change → writeConfig step, and never nest it for the same folder.
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

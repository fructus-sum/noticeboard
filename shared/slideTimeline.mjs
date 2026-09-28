// shared/slideTimeline.mjs — which slide is on at a given moment, the same on every screen
//
// Responsibilities
//   The rule behind "every screen in step" (SYSTEM_DESIGN §18.8): a playlist and the Server's time it
//   started at make a timeline that repeats; each slide takes its own time (an image its duration,
//   a video its length). Given the Server's time, every screen (and the Server itself) finds the
//   same slide and the same point in it. Plain JavaScript with no state, used by the Server (where
//   playlist changes take effect: services/playlistTimeline) and the viewer (the slide clock).
//
// Provides
//   slotMs(slide)                        → the slide's time on the timeline (ms): an image's duration
//                                          (DEFAULT_IMAGE_SECONDS without one), a video's length
//                                          (UNKNOWN_VIDEO_SECONDS without one)
//   positionAt(slides, startedAt, t)     → { index, start, end, round } at time t (ms), or null with
//                                          no slides; before startedAt: the first slide, from startedAt
//   boundaryAfter(slides, startedAt, t)  → when the slide on at t ends (t itself with no slides)
//
// Used by
//   client/display/src/slideshowClock.js, server/services/playlistTimeline.js; tests
//
// Change impact
//   The Server and every screen must agree on this rule: change it only with its tests.
export const DEFAULT_IMAGE_SECONDS = 10;
export const UNKNOWN_VIDEO_SECONDS = 10;

export function slotMs(slide) {
  if (slide?.type === 'video') return (slide.length > 0 ? slide.length : UNKNOWN_VIDEO_SECONDS) * 1000;
  return (slide?.duration > 0 ? slide.duration : DEFAULT_IMAGE_SECONDS) * 1000;
}

export function positionAt(slides, startedAt, t) {
  if (!slides?.length) return null;
  const lengths = slides.map(slotMs);
  const cycle = lengths.reduce((a, b) => a + b, 0);
  const since = Math.max(0, t - startedAt);
  const round = Math.floor(since / cycle);
  let start = startedAt + round * cycle;
  for (let index = 0; index < slides.length; index++) {
    const end = start + lengths[index];
    if (t < end || index === slides.length - 1) return { index, start, end, round };
    start = end;
  }
  return null;   // not reached
}

export function boundaryAfter(slides, startedAt, t) {
  const pos = positionAt(slides, startedAt, t);
  return pos ? pos.end : t;
}

# Handover — Session 2 — 2026-04-27

## Completed This Session
- server/routes/api/auth.js — POST /api/auth/login, POST /api/auth/logout, GET /api/auth/status; rate-limited login (5/15 min); JWT HttpOnly cookie `nb_admin_token`
- server/routes/api/settings.js — GET /api/settings (sanitised), PUT /api/settings (port/macFiltering/display), PUT /api/settings/password
- server/routes/api/slideshows.js — GET/POST/PUT/:folder/DELETE/:folder slideshow metadata CRUD; creates/removes data/slideshows/<folder>/ on disk
- server/routes/api/index.js — mounts above routers; 120 req/min rate limit; /auth uses macFilter only, /settings + /slideshows use adminAuth (MAC+JWT)
- server/middleware/adminAuth.js — updated to add JWT cookie verification (MAC check + jwt.verify); returns 401 JSON for missing/expired tokens
- server/services/schedulerService.js — computeActive() selects max 5 active slideshows by schedule + priority; 60s interval + runs on configService 'change'; emits 'update'
- server/socket.js — Socket.io init; display:ready → playlist:update response; schedulerService 'update' → broadcast to all displays; exports buildPlaylist()
- server/index.js — updated to init Socket.io and schedulerService; stop() called on shutdown
- server/routes/index.js — /admin SPA now uses macFilter (not adminAuth); /api mounted

## Next Session (Session 3) Scope
Media Upload + Processing:
- Upgrade multer to 2.x (security advisory on 1.x) in server/package.json
- POST /api/slideshows/:folder/slides — multer upload to tmp/, validate MIME type (image or video)
- processImage() in server/services/mediaService.js — Sharp → PNG, moves to data/slideshows/<folder>/slides/
- processVideo() — FFmpeg → H.264 MP4 (libx264, aac), moves to slides/
- server/services/uploadQueue.js — p-queue (concurrency 2), enqueues processing jobs; updates slideshow.json (status: processing → ready)
- GET /api/slideshows/:folder/slides — list slides from slideshow.json
- DELETE /api/slideshows/:folder/slides/:id — delete slide file + remove from slideshow.json
- PUT /api/slideshows/:folder/slides/reorder — reorder array in slideshow.json
- Slide schema in slideshow.json: { id, type, filename, status, duration, addedAt }
- After each slide processed, emit configService 'change' so schedulerService recomputes and socket broadcasts updated playlist

## Design Decisions Made This Session
- Admin SPA (/admin) uses macFilter only (not adminAuth) so the login page is reachable without a JWT cookie. All API endpoints that need protection use adminAuth (MAC + JWT).
- Auth endpoints (/api/auth/*) use macFilter only — no JWT needed to log in.
- adminAuth returns 404 for unapproved MACs (security obscurity) and 401 JSON for missing/expired JWT (SPA can detect and redirect to login).
- schedulerService._matchesSchedule() returns true for unknown schedule types (safe default: show it).
- socket.js exports buildPlaylist() for reuse in Session 3 (force-push updated playlist after upload completes).

## Known Issues / TODOs
- multer 1.x security advisory still present — must upgrade to 2.x at the start of Session 3.
- No validation on slideshow `schedule` object shape when POSTing/PUTting — add in Session 3.
- buildPlaylist() in socket.js reads slideshow.json synchronously; fine for now, reconsider if files get large.
- The plan file at .claude/plans/we-need-to-create-lucky-meerkat.md is missing. Session scope was reconstructed from HANDOVER.md and memory. Session 3+ scope should be cross-checked against original plan if it can be recovered.

## How to Resume
Open the project directory and say: "continue noticeboard from handover"

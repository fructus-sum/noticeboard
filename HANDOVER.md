# Handover — Session 1 — 2026-04-27

## Completed This Session
- package.json (root npm workspaces, concurrently dev script)
- .gitignore
- .env.example
- server/package.json (all dependencies; uses p-queue v7 for CJS compatibility)
- server/utils/pathHelpers.js — all canonical paths; ROOT auto-detected from __dirname
- server/utils/logger.js — Winston; console+file; creates logs/ dir on load
- server/utils/configIO.js — JSON5 read (supports // comments), atomic JSON write
- server/utils/slugify.js — name → folder slug, deduplicates
- server/utils/macLookup.js — ARP lookup via node-arp, localhost always → 'localhost'
- server/config/defaults.js — first-run template (no secrets)
- server/services/configService.js — singleton; init() generates bcrypt hash + JWT secret on first run; emits 'change' events
- server/services/macService.js — resolves IP→MAC, checks approval list
- server/middleware/macFilter.js — unapproved → 404
- server/middleware/adminAuth.js — MAC check only (JWT added in Session 2)
- server/middleware/errorHandler.js — centralised error formatter
- server/routes/display.js — SPA catch-all → client/display/dist/index.html
- server/routes/admin.js — SPA catch-all → client/admin/dist/index.html
- server/routes/index.js — mounts all route groups in correct order
- server/app.js — Express factory with helmet, cors (dev), cookieParser
- server/index.js — HTTP server entry; graceful SIGTERM/SIGINT shutdown
- DEVELOPMENT.md — session management instructions
- client/display/dist/index.html — placeholder (replaced in Session 4)
- client/admin/dist/index.html — placeholder (replaced in Session 5)

## Next Session (Session 2) Scope
Auth + Core API + Socket.io + Scheduler:
- Login/logout with JWT HttpOnly cookies
- Settings API (GET/PUT /api/settings, PUT /api/settings/password)
- Slideshow CRUD metadata (GET/POST/PUT/DELETE /api/slideshows)
- Update adminAuth.js to add JWT check for API routes
- schedulerService.js — computeActive(), 60s interval, fires on configService 'change'
- socket.js — Socket.io init, display:ready → playlist:update response
- Update server/index.js to init Socket.io

## Design Decisions Made This Session
- Used p-queue v7.4.1 (not v8) for CommonJS compatibility. v8 is ESM-only.
- fluent-ffmpeg is deprecated on npm but still functional; kept per plan. No viable alternative.
- multer 1.x has a security advisory; upgrading to 2.x deferred to Session 3 when upload is implemented.
- MAC filtering defaults to DISABLED (enabled: false) so the system works out of the box.
- passwordHash and jwtSecret are generated async at first run; not hardcoded anywhere.
- /admin (no trailing slash) returns 301 → /admin/ (200). This is correct express.static behaviour; browsers follow the redirect transparently.
- dist/ placeholder files are gitignored; server serves inline fallback HTML when dist is missing.

## Known Issues / TODOs
- multer 2.x upgrade needed in Session 3 before upload route is written.
- The `data/` directory is gitignored. The installer will need to create it on first run (handled by configService.init()).
- No rate limiting on display route yet (only needed for API — added Session 2).
- Socket.io not yet wired; server/index.js has a placeholder comment.

## How to Resume
Open the project directory and say: "continue noticeboard from handover"

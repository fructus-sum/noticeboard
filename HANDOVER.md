# Handover — Session 7 — 2026-04-27

## Completed This Session
- server/routes/api/slideshows.js — added `GET /:folder` endpoint returning a single slideshow + slideCount; SlideshowDetailView now calls this directly instead of fetching the full list
- client/display/src/components/ImageSlide.vue — added `@error="emit('error')"` so broken images emit an error event instead of silently hanging
- client/display/src/components/SlideShow.vue — added `@error="advance"` on ImageSlide; a broken image now skips immediately to the next slide instead of stalling the display
- client/admin/src/views/SlideshowDetailView.vue — updated `loadMeta()` to call `GET /api/slideshows/:folder`; handles 404 with router redirect to `/slideshows`
- installers/installer-server-local.sh — added `npm prune --omit=dev` after build to remove devDependencies from the Pi, saving ~150 MB disk space
- Rebuilt both SPAs (display: 51 modules, admin: 36 modules — both clean)

## Project Status — COMPLETE
All 7 sessions done. The project is ready for deployment to a Raspberry Pi once the GitHub repository is created.

## One remaining manual step
Replace `PLACEHOLDER` in `installers/installer-server-local.sh` line 4 with the real GitHub repository URL once the repo is published:
```
REPO_URL="https://github.com/YOUR_USERNAME/noticeboard.git"
```

## What was built (full summary)
| Session | Scope |
|---|---|
| 1 | Server foundation — config, MAC filter, routing, logger |
| 2 | Auth (JWT cookies), settings API, slideshow CRUD API, scheduler, Socket.io |
| 3 | Media upload + processing (Sharp → PNG, FFmpeg → MP4, p-queue) |
| 4 | Display SPA — Vue 3, Socket.io client, image/video slideshow player |
| 5 | Admin SPA — login, slideshow management, slide upload, settings |
| 6 | Installers (server + remote client), .env wiring, README |
| 7 | Bug fixes: broken-image stall, single-slideshow endpoint, installer prune |

## How to Resume
Open the project directory and say: "continue noticeboard from handover"

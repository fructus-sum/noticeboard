# Noticeboard — System Design

**What this document is:** how the Noticeboard code works: its parts and how they talk to each other, the files and formats it keeps, the operating-system set-up, what installed Servers and Clients and open screens rely on, and what is shared or still written twice. It describes only what exists in the code, and (§18) the changes planned or in progress. The README gives an overview and says how to install it; the user guide (`noticeboard-guide.html`) is for the people running a noticeboard.

**Keeping it up to date:** every planned change starts in §18, before any code. Then change this document in the same commit as the code it describes, so it is always a live view of the software and of the work in progress. Code comments refer to it as `SYSTEM_DESIGN §<n>`, and to the entries of §14 by their D-number: when a number changes, update those comments too (search the code for `SYSTEM_DESIGN`).

**Version:** main is **0.5.0**; `feature/audio-support` carries **0.6.0** ("Audio") to **0.6.14** (the words Server and Client, the Known Issues, and fixes from the Pi test), which merge into main together. 1.0.0 is the version with Display Groups. The rules and the history are in §19.

**Module headers:** every module starts with a header in this form (`//` comments in JavaScript and inside a Vue file's `<script setup>`, `#` in bash). Comments inside a module explain intent, compatibility constraints and anything non-obvious, not what each line does.

```
// <module path> — <one-line purpose>
//
// Responsibilities
//   What belongs here (and, where it helps, what deliberately doesn't).
//
// Provides
//   name(inputs) → output   What it does. Side effects: files written, events emitted.
//
// Used by
//   <modules that depend on it>
//
// Uses
//   <modules it depends on>, and what it needs from each one.
//
// Change impact
//   What breaks if a shared interface here changes, and the compatibility constraints of §15
//   that apply here.
```


---

## Contents

1. [System overview](#1-system-overview)
2. [Repository layout](#2-repository-layout)
3. [Runtime architecture](#3-runtime-architecture)
4. [How the parts communicate](#4-how-the-parts-communicate)
5. [Configuration](#5-configuration)
6. [Persistent data](#6-persistent-data)
7. [User-facing behaviour and where it lives](#7-user-facing-behaviour-and-where-it-lives)
8. [Installation](#8-installation)
9. [Updates and branch following](#9-updates-and-branch-following)
10. [Operating-system integration](#10-operating-system-integration)
11. [External programs and packages](#11-external-programs-and-packages)
12. [File and module map](#12-file-and-module-map)
13. [Important functions: relationships and change impact](#13-important-functions-relationships-and-change-impact)
14. [Shared and duplicated behaviour](#14-shared-and-duplicated-behaviour)
15. [External contracts an installed system relies on](#15-external-contracts-an-installed-system-relies-on)
16. [Known issues](#16-known-issues)
17. [Tests](#17-tests)
18. [Planned and in-progress changes](#18-planned-and-in-progress-changes)
19. [Versions](#19-versions)

---

## 1. System overview

Noticeboard is a self-hosted slideshow system for Raspberry Pis on a local network. There are no databases and no cloud services: it stores JSON files and media on disk, and GitHub is used only for installing and updating.

```
                         GitHub: fructus-sum/noticeboard
                         (branch main, or another branch)
                               ▲            ▲
         curl install.sh       │            │ git fetch every 15 min
         (installer)           │            │ (installers/update.sh)
                               │            │
┌──────────────────────────────┴────────────┴───────────────────────────┐
│ Server      /opt/noticeboard  (git clone, owned by the desktop user)  │
│                                                                       │
│  systemd: noticeboard.service ── node server/index.js  (port 3000)   │
│             Express: /  /admin  /admin/help  /api/*  /media  /branding│
│             socket.io: /socket.io  (playlist + settings push)         │
│  systemd: noticeboard-update.timer/.path ── bash installers/update.sh │
│  desktop autostart ── /opt/noticeboard/start-kiosk.sh ── chromium     │
│                        --kiosk http://localhost:3000/                 │
└──────────────▲───────────────────────────────────▲────────────────────┘
               │ HTTP + socket.io                  │ HTTP (admin panel)
┌──────────────┴──────────────┐           ┌────────┴───────────────┐
│ Client (0..n)               │           │ Any browser on the LAN │
│ /usr/local/bin/             │           │ /admin (password)      │
│   noticeboard-kiosk.sh      │           │ / (viewer)             │
│   ── chromium --kiosk URL   │           └────────────────────────┘
│ (no repo, no Node.js)       │
└─────────────────────────────┘
```

Two roles, set up by the same installer (the owner's words, §18.4: hardware is named only where it matters):

- **Server:** the device running the Noticeboard server. It runs Node.js, stores all content, hosts the admin panel, updates itself from GitHub, and shows the slideshow full screen on its own monitor.
- **Client:** a device showing the Noticeboard viewer. It only runs Chromium full screen, pointed at the Server's URL. It has no copy of the repository and does not update itself: the viewer it shows is served by the Server, so it gets new viewer code when the Server updates.

**Supported devices:**

| Device | Server | Client | Video | Status |
|---|---|---|---|---|
| Raspberry Pi 3 | yes | yes | H.264 only, 1080p only | Supported (H.264 chosen in Settings) |
| Raspberry Pi 4 | yes | yes | H.264 and H.265 | Supported |
| Raspberry Pi 5 | yes | yes | H.264 and H.265 | Supported |
| Orange Pi Zero 2W | no | yes, headless | H.264 and H.265 | Planned: needs a headless Client installer (today's Client installer needs a desktop) |

New videos are H.265 (HEVC) by default; H.264 is the fallback for older hardware (`display.videoFormat`, D43). The viewer plays one format, the one selected; a video in the other format is left to fail on a screen that can't play it.

---

## 2. Repository layout

```
noticeboard/
├── package.json               npm workspaces root (server, client/display, client/admin); build, start and test scripts
├── package-lock.json          lockfile for all three workspaces (contains linux-arm64 optional deps: never regenerate on Windows)
├── system-requirements.json   system software each branch needs, and the installer version (read by the server and tests)
├── noticeboard-guide.html     user guide (self-contained HTML; served at /admin/help, opened as file:// on the Server or Client)
├── README.md, LICENSE, .env.example
├── docs/design/SYSTEM_DESIGN.md   this document
├── sample-data/
│   ├── sample-logo.png        placeholder logo
│   └── sample-slideshow/      01-welcome.png … 05-help.png, 03-video.mp4, sample.json (settings)
├── installers/
│   ├── install.sh             the one installer: configuration, latest-installer switch, loading its parts, main()
│   ├── lib/                   its steps: ui, branch, json, system, sudo, server, display, kiosk, desktop, firewall
│   │                          (branch.sh and json.sh are also loaded by update.sh; schedule.sh only by update.sh)
│   ├── kiosk/                 server.sh, display.sh: the kiosk scripts it installs, as they are installed
│   └── update.sh              the self-updater run by systemd on the Server
├── server/                    CommonJS, Express 4, socket.io 4
│   ├── index.js, app.js       the entry point (systemd runs server/index.js) and the Express app
│   ├── config/                defaults.js (a new config.json), passwordDefaults.js (the default password)
│   ├── middleware/            access.js (MAC filter, admin check), macFilter.js and adminAuth.js (their names),
│   │                          asyncRoute.js, uploads.js, passwordLimiter.js, errorHandler.js
│   ├── realtime/              displaySocket.js (socket.io: the live connection to the displays)
│   ├── routes/                index.js (mounting), spa.js (the apps' catch-all and "not built" page)
│   │   └── api/               index.js, auth.js, device.js, slideshows.js, slides.js, audioshows.js, tracks.js, mediaItems.js (the items' routes)
│   │       └── settings/      index.js, general.js, security.js, logo.js, updates.js, maintenance.js (the Settings page)
│   ├── services/              configService, showStore, slideshowStore, audioShowStore, slideshowRules, audioShowRules,
│   │                          playlistService, audioPlaylist, audioEvents, audioEventClock, displayEvents,
│   │                          schedulerService, settingsService, adminPassword, adminSession, macService,
│   │                          mediaService, mediaTypes, mediaNames, uploadQueue, brandingService, sampleSlideshow,
│   │                          contentReset, actionTokens
│   │   └── updates/           index.js, git.js, branchName.js, updateFiles.js, installerVersion.js, schedule.js
│   ├── utils/                 pathHelpers, configIO, logger, macLookup, network, slugify, folderLock,
│   │                          displayBuildId, systemCheck, weeklyTimes
│   └── test/                  unit tests (node:test): foundations, installer version, Node.js version rule
├── shared/                    public values shared by the server and both web apps (alias @shared)
│   ├── contract.json          socket event names and limits (the server requires it; the apps import it)
│   ├── index.js               SOCKET_EVENTS, LIMITS, PROJECT_URL, installerCommand(), mediaUrl() for the apps
│   ├── audioPlayer.mjs        the audio engine (the admin panel's show preview and the screens)
│   ├── slideTimeline.mjs      the slide timeline every screen keeps to (the viewer and the server, §18.8)
│   └── musicTimeline.mjs      the music timeline every screen plays to (the audio engine and the server, §18.8)
├── client/                    ES modules, Vue 3, Vite 5
│   ├── display/               the viewer: src/ (App, components, composables, slideshowClock, recovery),
│   │                          test/slideshowClock.test.mjs, test/slideTimeline.test.mjs, test/audioPlayer.test.mjs,
│   │                          test/musicTimeline.test.mjs
│   └── admin/                 the admin panel: src/ (views, components/{ui,slideshow,settings,updates},
│                              composables, router, styles/base.css)
└── tests/                     run.js (the runner: unit, api, browser, installers, upgrade, all), helpers/,
                               fixtures/, api/, browser/, installers/, upgrade/ (§17)
```

Files that exist only on the developer's PC and are not tracked: `*.md` files other than the README and this document (excluded via `.git/info/exclude`), `.gitattributes` (forces LF line endings for `*.sh`) and `.gitignore`.

Git ignores the runtime folders `data/`, `tmp/` and `logs/`, the built apps in `client/*/dist/`, `node_modules/` and `.env`.

---

## 3. Runtime architecture

### 3.1 Processes on a Server

| Process | Started by | Runs as | What it is |
|---|---|---|---|
| `node server/index.js` | `noticeboard.service` (`Restart=always`, `RestartSec=5`) | desktop user | The whole server: HTTP, socket.io, scheduler, upload queue |
| `bash installers/update.sh` | `noticeboard-update.timer` (boot+5 min, then every 15 min) or `noticeboard-update.path` (when `tmp/update-request` exists) | desktop user (`User=` in the unit; it re-execs itself as the owner if started as root) | Self-updater (oneshot): checks every run, installs when the update schedule says so or the admin asks (§9.1) |
| `/opt/noticeboard/start-kiosk.sh` | XDG autostart `/etc/xdg/autostart/noticeboard-kiosk.desktop` at desktop login | desktop user | Bash loop that keeps Chromium in kiosk mode on `http://localhost:3000/` |
| Chromium | the kiosk script | desktop user | Shows the viewer (`/`) |

On a Client, `/usr/local/bin/noticeboard-kiosk.sh` is started by the same autostart entry. It shows a local waiting page until the server answers, then runs Chromium in kiosk mode on the server's URL.

### 3.2 Server start-up (`server/index.js`)

0. `contentReset.applyPendingRestore()`: when Restore Defaults left its marker (`data/restore-defaults`), it deletes the marker, everything in `data/` but `update-branch.env` and `installer.json`, the files in `tmp/` but `update.lock`, and the logs (`app.log` emptied in place), so the server starts as a new install (D42).
1. `configService.init()` creates `data/` and `data/slideshows/`, and reads `data/config.json` with JSON5.
1a. `videoConversion.recover()`: a video left marked by a conversion the server didn't finish is ready again with its old file, and the unfinished outputs are deleted (D43).
   - If the file is missing, it writes defaults with a bcrypt hash of `Admin@12345` and a random `jwtSecret`.
   - If the file can't be parsed, it **regenerates the defaults**, which replaces the password and the MAC list.
2. `syncSampleSlideshow()` keeps the "Sample slideshow" in step with `sample-data/sample-slideshow/`. Any error is logged and start-up continues.
3. `port = config.port || 3000`.
4. `createApp()` builds the Express app.
5. `http.createServer(app)`.
6. `initDisplaySocket(server)` (realtime/displaySocket.js) sets up the socket.io server and registers its listeners: `schedulerService 'update'`, `configService 'change'`, and the two displayEvents.
7. `schedulerService.init()` listens to `configService 'change'`, starts a 60-second interval and computes the active set, which emits `'update'`.
8. `server.listen(port)`.
9. On `SIGTERM` or `SIGINT`: `scheduler.stop()`, then `io.close(() => exit(0))`, with a forced exit after 5 s.

The order matters. The sample sync runs before `initDisplaySocket`, so any announcement then reaches no listener (no display is connected yet anyway). The scheduler emits its first `'update'` after the socket listener is registered.

### 3.3 HTTP request pipeline (`server/app.js`, `server/routes/index.js`)

Global middleware, in order: `helmet({ contentSecurityPolicy: false })`, `express.json({ limit: '10mb' })`, `cookieParser()`, then the routes, then `errorHandler`.

Routes are mounted in this order; the order is significant:

| # | Path | Guards | Handler |
|---|---|---|---|
| 1 | `/media/*` | `macFilter`, then an extension allowlist (`.png .jpg .jpeg .gif .webp .mp4 .webm .mp3 .wav .ogg`, else 404) and an `Accept-Ranges` header | `express.static(data/slideshows)` |
| 1a | `/audio/*` | `macFilter`, then only `.m4a` (else 404) and an `Accept-Ranges` header | `express.static(data/audioshows)`: the audio shows' tracks, `/audio/<folder>/tracks/<file>` |
| 2 | `GET /admin/help` | `macFilter` | `sendFile(noticeboard-guide.html)`, 404 text if missing |
| 3 | `GET /branding/logo` | `macFilter` | uploaded `data/branding/logo.png`, or the placeholder resized in memory. `?v=` makes it cacheable for a year |
| 4 | `/admin` | `macFilter` | `express.static(client/admin/dist)`, then `routes/spa.js` (`index.html` for every path, or an inline "not built" page) |
| 5 | `/api/*` | see the API table in §4.1 | `routes/api/index.js` |
| 6 | `/` | `macFilter` | `express.static(client/display/dist)`, then `routes/spa.js` (`index.html` for every path, or the "not built" page) |

socket.io attaches directly to the `http.Server`, so `/socket.io` never passes through Express or `macFilter`: displaySocket applies the same MAC check itself (`io.use`, through `macService.resolveAddress`), refusing an unapproved device at connect (a connect error, "Not Found", and nothing sent), and closes the connections a change to MAC filtering no longer allows (since 0.6.2).

### 3.4 Real-time channel (socket.io, `server/realtime/displaySocket.js`)

| Event | Direction | When | Payload |
|---|---|---|---|
| `display:build` | server → one socket | on connect | 12-character SHA-1 of `client/display/dist/index.html`, or `null` |
| `display:settings` | server → one socket, and broadcast | on connect; broadcast on `configService 'change'`, on `displayEvents.displaySettingsChanged` (the logo), and when the installer or update state changes (checked at start-up, when a display connects and every 5 minutes), when the settings differ from the last broadcast | `{ showDeviceInfo, logo: { url } \| null, background, installerNeeded, updateAvailable, restartNeeded }` (built by `services/displaySettings.js`; `restartNeeded` since 0.6.5: a saved port the Server isn't running on yet) |
| `display:ready` | display → server | on every (re)connect | none |
| `time:ping` / `time:pong` | display → server / server → that socket | a burst of 5 on every connect, then one every 5 minutes (since 0.7.0) | `{ sent }` / `{ sent, server }`: the Server's clock, which screens keep their slides and music to (`serverClock.js`, §18.8) |
| `audio:update` | server → that socket (after its playlist, on `display:ready`), and broadcast | on `display:ready`; broadcast on `configService 'change'`, on `displayEvents.audioChanged` (a track ready, deleted or reordered), on `audioEventClock 'update'` (an event starts or ends) and when a show's timeline changes (`services/audioTimeline.js`, since 0.7.0), when it differs from the last broadcast | `{ shows: { <audio folder>: { id, order, transition, fadeSeconds, volume, tracks: [{ url, length }], startedAt, after } }, slideshows: { <slideshow folder>: <audio folder> }, event: <audio folder> | null }` (built by `services/audioPlaylist.js`: published audio shows with a ready track, the slideshows that chose one of them, and the show whose event is playing, from `audioEventClock`; `startedAt` and `after` since 0.7.0: each show's timeline, which every screen plays to, from `audioTimeline`, §18.8) |
| `playlist:update` | server → that socket (reply to `display:ready`), and broadcast | on `display:ready` (what every screen is playing); broadcast when the running playlist switches (`services/playlistTimeline.js`, since 0.7.0): `schedulerService 'update'` and `displayEvents.playlistChanged` (a slideshow change, a slide deleted or reordered, an upload processed, a video converted) offer it the playlist, and a changed one takes effect, and is sent, at the end of the slide on at that moment on the timeline (at once with nothing on); the same playlist isn't sent again | `{ slides: [{ type, url, duration, slideshow, length?, sound?, withSound?, lowerTo? }], startedAt }` (`length`: videos only; `sound: true`, `withSound`, `lowerTo`: only a video playing its own sound, §18.3; `startedAt` since 0.7.0: the Server's time the playlist started, which every screen keeps to, §18.8) |

The event names are defined once, in `shared/contract.json`. `realtime/displaySocket.js` requires it, and the viewer imports it through `shared/index.js` (`SOCKET_EVENTS`).

`buildPlaylist(active)` (services/playlistService.js), for each active slideshow in priority order:
1. Take the current entry from the store (`store.find`), because the scheduler's cached copy may be stale.
2. Read the slides with `store.readSlides`: a missing or broken file, or one without a slides list, gives no slides.
3. Keep the `status === 'ready'` slides, and videos being converted (`reprocessing`, with their current file), and map them to `{ type, url: /media/<folder>/slides/<filename>, duration, slideshow }`, and for a video `length`.
   - Images: `duration = slide.duration ?? slideshow.slideDurationSeconds ?? display.defaultSlideDurationSeconds ?? 10`.
   - Videos: `duration = null` (they play to the end); `length = slide.duration` (the video's length in seconds, from ffprobe; null if unknown), which a screen that can't play it keeps to.

### 3.5 The viewer (`client/display`)

`App.vue` wires everything together:
- `useSocket()` provides the playlist, connection state, whether a playlist has been received, the display settings and the background audio (`audio:update`).
- `useActivity()` tracks mouse, keyboard and touch activity.
- It shows `SlideShow` when there are slides, otherwise `WaitingScreen`.
- `DeviceInfo` (the location pin) appears if `showDeviceInfo` is on.
- `ExitKiosk` appears unless `?kiosk=off`.
- `AdminWarning` (a small red triangle, bottom right) appears on every screen while `installerNeeded` or `updateAvailable` (manual updates, a new version waiting) is true; tapping it shows only "Please check the Admin panel for details."
- The cursor is hidden while idle (`.app--idle`).
- `startDailyReload` runs unless `?kiosk=off`.
- `BackgroundAudio` (no markup) plays the audio show of the slideshow on screen: `SlideShow` emits `on-air` with each slide it shows, App keeps it (none while the waiting screen shows), and BackgroundAudio gives the engine (`shared/audioPlayer.mjs`, §12.8) `audio.shows[audio.slideshows[onAir]]` or nothing. The engine ignores the same show sent again, so two slideshows on one audio show carry on without a break. Since 0.7.0 every show plays all the time on its timeline (`startedAt`, `after`) on the Server's time (`serverNow`), "like a radio": every screen plays the same track at the same point, and a screen that switches to a show, or comes back to it, joins it where it is now (§18.8). Sound the browser refuses is tried again every minute, or at once on a click, tap or key press; `window.noticeboardAudio()` shows its state. While a video plays its own sound (`sound` in the playlist), App passes its `withSound` and `lowerTo`: the background is lowered to that volume (`duck`, over 500 ms) or paused, and brought back, or after a pause joined where the music is by then, when the slide goes. `VideoSlide` plays such a video aloud, or muted if the browser refuses, so it still plays. While an event is on (`audio.event`), every screen plays that show instead, even with no slideshow on; afterwards the slideshow's show carries on with its next track.

`SlideShow.vue` holds no timing logic of its own; `slideshowClock.js` makes every timing decision. Since 0.7.0 every screen keeps to one timeline (§18.8): the playlist's `startedAt` and each slide's time (an image's duration, a video's `length`, or 10 s for a video without one; `shared/slideTimeline.mjs`), read on the Server's clock (`serverNow` from `useSocket`). So every screen shows the same slide at the same moment, and one that loads, reconnects or wakes goes straight to it; a video starts at the right point (`offset`), and `VideoSlide` puts it back if it drifts more than 0.5 s from where the timeline says. A timer moves on at each slide's end, and a watchdog checks the timeline every 2 s, so a lost timer or a hidden, frozen or sleeping page can't hold it up. **A slide that can't be shown** (an image that won't load, a video that won't play, a format the screen can't decode, or one that stops) keeps its place until its time is up, so the screen stays in step; a video still buffering at its slot's end gives way to the next slide as the other screens do. It is plain JavaScript with injectable timers and clock, tested over 30 simulated days with two screens whose clocks are minutes apart. A playlist without `startedAt` (an older Server) starts when it arrives.

`SlideShow.vue` renders one or two `SlideFrame` layers for the cross-fade. It calls `clock.resume()` on page lifecycle events and on reconnect.

Every image and video is drawn whole, as large as fits the screen, in its own shape (`object-fit: contain`); the browser recalculates on every resize or rotation. The space around it, and the waiting screen, are the background colour from `display:settings`, which `App.vue` sets as the CSS variable `--nb-background` (black until the first settings arrive).

`recovery.js` provides safe reloads that first check that `GET /` answers:
- after a build change (`display:build` differs from the first value seen)
- when every slide keeps failing (at most once per 30 minutes, tracked in `sessionStorage`)
- once a day between 02:00 and 05:00 after 24 hours of running

### 3.6 The admin panel (`client/admin`)

A Vue Router SPA under `/admin/`:
- **Mounting:** `main.js` mounts only after `router.isReady()`. Before that the router reports `/` as the page, so the sidebar would show on the login page, and its requests (which need a login) would send the browser to the login page again and again.
- **Login check:** a global `beforeEach` asks `GET /api/auth/status` (through useApi, which never redirects for this call) and sends the user to `/login` when they aren't logged in.
- **API calls:** go through `composables/useApi.js`, which sends the cookie with each request. A 401 response loads `/admin/login`, unless the browser is already on it.
- **The frame on every page but the login page:** the sidebar, the default-password warning and the updater's notices (`UpdateNotice`, `InstallerNotice`, `UpdateAvailableNotice`), in `App.vue`. It stays while moving between pages, so a notice is the same on every page, and closing one closes it everywhere.
- **Section cards:** every section card of the Settings and slideshow pages is a `CollapsibleCard`: it folds away to its title and is remembered in the browser (`useCollapsed`). A card holding a warning stays open (D39).
- **Shared state:** module-level singletons shared between components: `useBranding` (logo), `useSecurity` (default-password flag), `useCollapsed` (the folded cards) and `useNav` (sidebar collapsed, stored in `localStorage`).
- **Views:**
  - `LoginView`
  - `SlideshowsView` (home): device banner, list, create, publish, hide, delete
  - `SlideshowDetailView`: loads the slideshow; `components/slideshow/` has its settings card (with the schedule editor) and its slide list (uploads, reorder, thumbnails, preview)
  - `SettingsView`: loads the settings; one component per card: display, MAC filtering, logo, password (`components/settings/`), software updates (`components/updates/`)

### 3.7 Background work in the server

| What | Where | Trigger |
|---|---|---|
| Recompute the active slideshows | `schedulerService.computeActive` | every 60 s, and on every `configService 'change'`. It emits `'update'` only when the ordered list of folders changes. |
| Media processing | `uploadQueue` (p-queue, concurrency 2) | after an upload. Images: sharp → PNG. Videos: ffmpeg → the chosen format (H.265 by default, or H.264: `settingsService.videoFormat`)/AAC MP4, recorded as the slide's `format` (D43), then ffprobe for the length, then a JPEG thumbnail. |
| Video thumbnails (and the length of a video without one) | `uploadQueue.enqueueThumbnail` | the sample slideshow's videos, and "Create thumbnails" in the admin panel |
| Converting the existing videos | `videoConversion` (one video at a time, beside the upload queue) | "Convert existing videos" in Settings → Display (D43) |
| Sample slideshow sync | `sampleSlideshow.syncSampleSlideshow` | once at start-up |
| Password-check token expiry (branch switch, Delete All) | `actionTokens.take` | lazily, when tokens are used |
| Kiosk exit requests | `device.js` (in-memory `Map`) | expire after 60 s, cleaned up when claimed |

### 3.8 Running it

`npm run build` builds both web apps into `client/*/dist`; `npm start` (on a Server, systemd's `node server/index.js`) runs the server, which serves them. A PC runs it exactly as a Server does. Changes are tried out on a GitHub branch, which a Server can follow (§9). The log level can be raised for troubleshooting (§5.2).

---

## 4. How the parts communicate

### 4.1 HTTP API (`/api`, all behind a rate limit of 120 requests per minute per IP)

| Method and path | Guard | Handler | Called by |
|---|---|---|---|
| `POST /api/auth/login` | macFilter, login limiter (5 per 15 min) | bcrypt compare → JWT cookie `nb_admin_token` (7 days) | `LoginView` (useApi, `redirectOn401: false`) |
| `POST /api/auth/logout` | macFilter | clears the cookie | `NavBar` |
| `GET /api/auth/status` | macFilter | `{ authenticated }` by verifying the JWT | the router's login check (useApi); **update.sh's health check**; test harnesses |
| `GET /api/device` | macFilter | server IPs (the one used first) and port | `DeviceInfo.vue` |
| `POST /api/device/kiosk-exit` | macFilter | stores an exit request for the caller's IP | `ExitKiosk.vue` |
| `POST /api/device/kiosk-exit/claim` | macFilter | `{"exit":true\|false}`, consuming the request | **kiosk scripts** (curl, exact string compare) |
| `GET/PUT /api/settings` | adminAuth | sanitised config / partial update of `port`, `macFiltering`, `display` | SettingsView (for DisplaySettingsCard and MacFilterCard), BrandingSettings, SlideshowDetailView (the default duration) |
| `GET /api/settings/device` | adminAuth | LAN interfaces with MACs | SlideshowsView banner |
| `GET /api/settings/my-device` | adminAuth | `{ local, mac }` of the caller | MacFilterWarning |
| `GET /api/settings/security` | adminAuth | `{ defaultPassword }` | useSecurity |
| `GET/POST/DELETE /api/settings/logo` | adminAuth | logo info / upload / reset | useBranding, BrandingSettings |
| `PUT /api/settings/password` | adminAuth | change the password (403 when the current one is wrong) | PasswordCard |
| `GET /api/settings/updates` | adminAuth | update info (git, the status and check files, systemd unit presence, the schedule, the waiting version) | useUpdateInfo, UpdateAvailableNotice |
| `PUT /api/settings/updates/schedule` | adminAuth | `{ every, time, day }` → saves the schedule, asks update.sh to check (400 not valid, 409 without the updater) | UpdateSchedule |
| `PUT /api/settings/updates/install-at` | adminAuth | `{ at }` → a set time for the waiting version, then a check | UpdateSchedule |
| `POST /api/settings/updates/install-now` | adminAuth | status `requested`, request `install-now` (409 while an update runs) | UpdateSchedule |
| `GET/DELETE /api/settings/updates/notice` | adminAuth | read or dismiss `update-notice.json` | UpdateNotice |
| `GET /api/settings/updates/installer` | adminAuth | whether the installer needs running again | InstallerNotice |
| `GET /api/settings/version` | adminAuth | `{ commit, date, installedAt, branch }` | NavBar |
| `GET /api/settings/updates/branches` | adminAuth | `git ls-remote --heads` | useUpdateInfo |
| `POST /api/settings/updates/check` | adminAuth | fetch the branch, validate it, requirements and installer needs | BranchSwitcher |
| `POST /api/settings/updates/verify-password` | adminAuth, 5 wrong per 15 min (shared, D40) | one-time token for the switch (5 min) | SwitchDialogs |
| `POST /api/settings/updates/switch` | adminAuth + token | writes the branch file, status and request | SwitchDialogs |
| `POST /api/settings/maintenance/verify-password` | adminAuth, 5 wrong per 15 min (shared, D40) | `{ password, action: 'delete-all' | 'restore-defaults' }` → one-time token for that action (5 min) | DeleteContentCard |
| `POST /api/settings/maintenance/delete-all` | adminAuth + token | every slideshow but the sample deleted → `{ deleted: [names] }`; the playlist sent | DeleteContentCard |
| `GET /api/settings/config-recovery`, `DELETE …` | adminAuth | `{ recovery }`: the note about an unreadable config.json (null when all is well); DELETE removes it | ConfigRecoveryNotice |
| `GET /api/settings/maintenance/restart` | adminAuth | `{ restartNeeded, port: { running, saved } }` (services/restartState) | RestartNotice, ServerPortCard |
| `POST /api/settings/maintenance/restart` | adminAuth + token (action `restart`) | `{ restarting, running, saved }`, then the process ends (SIGTERM's graceful shutdown) and systemd starts it again (`Restart=always`) | RestartNotice |
| `POST /api/settings/maintenance/restore-defaults` | adminAuth + token (action `restore-defaults`) | the marker, status `requested`, request `restore-defaults` (409 without the updater or while an update runs) | DeleteContentCard |
| `GET/POST /api/slideshows` | adminAuth | list (with `sample`, `slideCount`) / create | SlideshowsView |
| `GET/POST /api/audioshows` | adminAuth | list (with `trackCount`) / create (unpublished, default settings) | AudioShowsView |
| `GET/PUT/DELETE /api/audioshows/:folder` | adminAuth | read / change (name, enabled, order, transition, fadeSeconds, volume: 400 outside the limits) / delete | AudioShowsView, AudioShowDetailView |
| `PUT /api/audioshows/:folder/event` | adminAuth | an audio show's event: `{ mode: 'now' }`, `{ mode: 'once', from, to }`, `{ mode: 'repeat', days, startTime, endTime }` or `{ event: null }` (`audioShowRules.parseEvent`; 409 when it overlaps another show's scheduled event) | AudioEventCard |
| `GET/POST /api/audioshows/:folder/tracks`, `PATCH/DELETE …/tracks/:id`, `PUT …/tracks/reorder` | adminAuth | the tracks: list / upload (audio types, converted to AAC) / rename / delete / reorder (routes/api/mediaItems.js) | TrackList |
| `GET/PUT/DELETE /api/slideshows/:folder` | adminAuth | read / update / delete (the sample gives 403) | both slideshow views |
| `GET/POST /api/slideshows/:folder/slides` | adminAuth (once per request) | list / upload (multer, max 50 files, 500 MB each) | SlideshowDetailView (list), SlideList |
| `PATCH /api/slideshows/:folder/slides/:id` | adminAuth | `{ name }`: rename the slide (an empty name removes it; the file keeps its name; no playlist sent) | SlideList |
| `DELETE /api/slideshows/:folder/slides/:id` | adminAuth | remove the slide and its files | SlideList |
| `GET/POST /api/settings/videos/convert` | adminAuth | the conversion's progress / start converting every video that isn't in the saved format (409 while one runs) | DisplaySettingsCard |
| `GET /api/settings/videos/formats` | adminAuth | `{ format, total, other }`: how many videos uploaded aren't in the saved format (`videoConversion.formats`; since 0.6.13) | DisplaySettingsCard |
| `PUT /api/slideshows/:folder/slides/reorder` | adminAuth | `{ order: [ids] }` | SlideList |
| `POST /api/slideshows/:folder/slides/thumbnails` | adminAuth | queue the missing thumbnails | SlideList |
| `PUT /api/slideshows/:folder/slides/:id/sound` | adminAuth | a video's own sound: `{ sound, withSound?, lowerTo? }` (`slideshowRules.parseVideoSound`; off removes the keys); sends the playlist | VideoSoundControl |

Error conventions:
- `/api` errors are JSON `{ error }`.
- MAC denial is a **404 plain-text `Not Found`** everywhere, on purpose, so that denied devices learn nothing.
- The display kiosk script relies on it: a 404 on `/` means "waiting for approval".
- A wrong password inside the admin panel gives **403**, not 401, because a 401 makes the panel jump to the login page.

### 4.2 Files used as a channel between the server and `update.sh`

| File | Server side | update.sh side |
|---|---|---|
| `data/update-branch.env` | `updateFiles.saveSwitch` writes `NOTICEBOARD_BRANCH=<b>`; `updateFiles.readBranchSetting` reads it | reads `NOTICEBOARD_BRANCH` and `NOTICEBOARD_MAIN_AT_SWITCH`; `write_branch_setting` (lib/branch.sh) writes both |
| `tmp/update-request` | `requestSwitch` (`<time> <branch>`), `installNow` (`install-now`), `setSchedule` and `setInstallAt` (`check`) write it | the systemd `.path` unit starts `update.sh`, which deletes the file at once; `check` only checks, anything else may install |
| `data/update-schedule.env` | `updateFiles.saveSchedule` (`EVERY`, `TIME`, `DAY`, `SINCE`), `saveInstallAt` (`AT`); `readSchedule` | `lib/schedule.sh` reads it; `set_install_at` removes `AT` once its time has come (or sets it, when Update now finds the lock busy) |
| `data/restore-defaults` | `contentReset.requestRestore` writes it; `applyPendingRestore` deletes it at start-up | update.sh: while it exists, a run is a restore (reinstall into a clean folder, restart even after a failure) |
| `data/update-status.json` | `requestSwitch` writes `state: requested`; `getInfo` and `versionInfo` read it | `write_status` for every other state |
| `data/update-check.json` | `getInfo` reads it (the waiting version: `waitingUpdate`) | `write_check`, with `installCheckedAt`, `fetchedAt`, `nextInstall`, `available`, `availableSubject`, `availableDate` |
| `data/update-notice.json` | `getNotice` reads it; `dismissNotice` deletes it | `returned_to_main` writes it |
| `tmp/noticeboard-uploads/*` | multer puts uploads here; the queue deletes them | a file younger than 60 min means "upload in progress, wait" |
| `tmp/update.lock` | none | `flock`, also held by `install.sh` |
| `data/installer.json` | `installerVersion.installedVersion` reads it | written by `install.sh` |

### 4.3 Kiosk scripts ↔ server

- **Readiness.** `curl -sf http://localhost:3000/` (server kiosk) or `curl … $SERVER_URL` (display kiosk; 200 = show the viewer, 404 = MAC not approved, anything else = server unreachable).
- **Exit.** `curl -s -X POST --max-time 3 <url>api/device/kiosk-exit/claim` every 3 s, compared with the exact string `{"exit":true}`.
- **Leaving kiosk mode.** Kill the kiosk browser, then run `<browser> --no-first-run <url>?kiosk=off`.

### 4.4 Server-internal events

- `configService` (EventEmitter) emits `'change'` only from its own `set()` and `update()`, i.e. when config.json really changed. Listeners: `schedulerService` (recompute), and displaySocket's display-settings and audio broadcasts (each deduplicated).
- `audioEventClock` emits `'update'` when the event playing changes (worked out on a config change and when the next event starts or ends); displaySocket sends the audio again.
- `schedulerService` emits `'update'` when the active slideshows change. Its only listener is displaySocket's playlist broadcast.
- **`services/displayEvents.js`** is the explicit channel to the displays. `playlistChanged()` is called by the slideshow PUT, the slide DELETE and reorder routes, and `uploadQueue` after processing. `displaySettingsChanged()` is called by the logo upload and reset. `audioChanged()` is called by the tracks' delete and reorder routes and by `uploadQueue` after a track is processed. displaySocket is its only listener, so no route or service depends on socket.io.
- Changing the default image duration (`PUT /settings` display) sends no playlist: displays keep the old duration for slideshows that use the default until the playlist is next sent (§16).

---

## 5. Configuration

### 5.1 `data/config.json`

Read with JSON5, so comments and `_comment` keys are allowed. Written as plain JSON, pretty-printed, via a temporary file and a rename. `configService` keeps it in memory and writes the whole object on every change.

| Key | Type | Default | Read by | Written by |
|---|---|---|---|---|
| `_comment` | string | yes | nobody | defaults |
| `port` | number | 3000 | index.js; update.sh, install.sh and the Server's kiosk via `configIO.readConfig` | `PUT /settings` (a whole number from 1024 to 65535, the contract's `limits.port`; takes effect after a restart: services/restartState) |
| `passwordHash` | bcrypt | hash of `Admin@12345` | adminPassword (login, password change, branch-switch check, usesDefault) | configService defaults, `PUT /settings/password` |
| `jwtSecret` | hex (96 characters) | random | adminSession | defaults only |
| `macFiltering.enabled` | bool | false | macService | `PUT /settings` |
| `macFiltering.approved[]` | `{ mac, label, addedAt }` | `[{ mac:'localhost', label:'Server itself' }]` | macService, my-device (client side) | `PUT /settings` (the whole list, checked: well-formed MACs stored lower case with colons, no duplicates, the Server's own entry always kept; since 0.6.10) |
| `display.defaultSlideDurationSeconds` | int 1–3600 | 10 | playlistService.buildPlaylist; the admin panel | `PUT /settings` (validated in settingsService `mergeDisplay`) |
| `display.showDeviceInfo` | bool | true | services/displaySettings | `PUT /settings` |
| `display.logo.enabled` | bool | true | brandingService | `PUT /settings` |
| `display.videoFormat` | `h265` \| `h264` | absent (H.265, `shared/contract.json` `display.defaultVideoFormat`) | settingsService.videoFormat (uploadQueue: what new videos are converted to) | `PUT /settings` (checked in settingsService `mergeDisplay` against `display.videoFormats`) |
| `display.backgroundColor` | `#rrggbb`, lower case | absent (black, `shared/contract.json` `display.defaultBackground`) | brandingService.backgroundColour | `PUT /settings` (checked in settingsService `mergeDisplay`) |
| `slideshows[]` | see below | `[]` | slideshowStore only (for the scheduler, the playlist, the routes and the sample sync) | slideshowStore (the routes, the sample sync) |
| `sampleSlideshow` | `{ folder, signature }` | absent | sampleSlideshow, slideshowRules.isSample | sample sync |
| `sampleSlideshowAdded` | bool, only in configs from before `sampleSlideshow` existed | absent | the sample sync, which replaces it with `sampleSlideshow` | the sample sync removes it (set to `undefined`, dropped when saved) |
| `audioShows[]` | see below | absent (no audio shows) | audioShowStore (the audio routes) | audioShowStore |

An audio show entry looks like `{ folder, name, enabled, order: 'in-order' | 'shuffle', transition: 'none' | 'crossfade', fadeSeconds, volume, event?, addedAt }` (limits in `shared/contract.json` `audio`, D44). `event`, stored only when set: `{ mode: 'now', since }`, `{ mode: 'once', from, to }` (local `YYYY-MM-DDTHH:MM`) or `{ mode: 'repeat', days, startTime, endTime }` (services/audioEvents).

A slideshow entry looks like `{ folder, name, priority, schedule: { type: 'always' | 'timed', days?: [0-6], startTime?: 'HH:MM', endTime?: 'HH:MM' }, enabled, hidden?, slideDurationSeconds?, audioShow?, addedAt }`.
- `audioShow` (its background audio: an audio show's folder) is stored only when one is chosen, and removed for none or when that audio show is deleted.
- A missing `enabled` counts as enabled.
- `hidden` is stored only when true.
- `slideDurationSeconds: null` means "use the default".

### 5.2 Environment

| Variable | Source | Used by |
|---|---|---|
| `SECURE_COOKIES` | `.env`, loaded by systemd `EnvironmentFile=` (nothing reads `.env` in Node; there is no dotenv) | adminSession cookie `secure` flag |
| `NOTICEBOARD_LOG_LEVEL` | `.env` or the shell, for troubleshooting only | logger: `debug` adds the debug lines |
| `NOTICEBOARD_SYSTEMD_DIR` | tests only | pathHelpers.systemdDir |
| `NOTICEBOARD_BRANCH` | the user (a one-off) | update.sh |
| `NOTICEBOARD_INSTALLER_SHA`, `NOTICEBOARD_INSTALLER_BRANCH`, `NOTICEBOARD_MODE`, `NOTICEBOARD_INSTALL_BRANCH` | install.sh, set when it re-runs itself | install.sh |

### 5.3 Hard-coded settings (not configurable)

- **Admin:** default password `Admin@12345` (`config/passwordDefaults.js`); JWT lifetime 7 days and cookie `nb_admin_token` (`services/adminSession.js`); new passwords at least 8 characters (`shared/contract.json` `limits.passwordMinLength`).
- **Rate limits:** API 120/min; login 5/15 min; the password checks inside the admin panel (branch switch, Delete All) 5 wrong/15 min, counted together.
- **Uploads:** 500 MB per file, 50 files; logo upload 20 MB; logo fits within 500×500.
- **Scheduler and viewer:** at most 5 active slideshows; scheduler interval 60 s; display clock constants in `slideshowClock.js`.
- **Updates:** a stale update counts after 60 min; a password-check token lasts 5 min; timer every 15 min (the schedule decides when a run installs; manual mode checks once a day); kiosk exit request expires after 60 s.
- **Kiosk:** the server kiosk URL is `http://localhost:3000/` regardless of `config.port` (see §16).

### 5.4 Browser storage

- `localStorage['noticeboard:navCollapsed']`, set by the admin panel: `'1'` or `'0'`.
- `localStorage['noticeboard:collapsedCards']`, set by the admin panel: a JSON list of the folded cards' names (`settings-display`, `settings-mac`, `settings-branding`, `settings-password`, `settings-updates`, `settings-delete`, `slideshow-settings`, `slideshow-slides`, `audio-settings`, `audio-tracks`).
- `sessionStorage['noticeboard:lastRecoveryReload']`, set by the viewer: a timestamp.

---

## 6. Persistent data

Under `/opt/noticeboard` on a Server.

| Item | Format | Created by | Read by | Changed by | Depended on by |
|---|---|---|---|---|---|
| `data/config.last-good.json` | JSON, the same as config.json | configService (after every load, creation and save) | configService (restoring an unreadable config.json) | configService (every save) | an unreadable config.json's recovery (since 0.6.9); left out of the upgrade rehearsal's comparison |
| `data/config.json.broken-<time>`, `data/config-recovery.json` | an unreadable config.json, kept; the note about it (`{ time, brokenFile, restored, error }`) | configService (start-up) | the admin panel's warning (GET/DELETE /api/settings/config-recovery) | the note: deleted when dismissed | the admin (since 0.6.9) |
| `data/config.json` | JSON (JSON5 allowed) | configService.init / installer (via configService) | configService, update.sh and install.sh (port) | configService | everything |
| `data/slideshows/<folder>/slideshow.json` | JSON `{ slides: [...] }`; a slide is `{ id, type, originalName?, name?, filename, status, duration, addedAt, format?, reprocessing?, thumbnail?, thumbnailPending?, thumbnailError?, error?, sound?, withSound?, lowerTo? }` (`sound: true` with `withSound: 'lower' | 'pause'` and `lowerTo` %: a video playing its own sound, stored only while on) (a video's `duration` is its length; `format`: `h265`/`h264`, recorded from 2026-09-28; `reprocessing`: while it's converted to another format, with `status: processing`) (`originalName`: the uploaded file's name, `null` if it had none, absent on slides from before names; `name`: only when renamed) | `slideshowStore.create` (atomic), sample sync | only `slideshowStore` (for the routes, uploadQueue, the playlist and the sample sync) | only `slideshowStore.modifySlides` (locked; written only when changed) | the viewer (through the playlist), the admin panel |
| `data/slideshows/<folder>/slides/<uuid>.png\|.mp4` | media | uploadQueue (processing), sample sync (copy, keeping the extension: `.png`, `.mp4`, and `.jpg/.gif/.webp/.webm` possible) | `/media` static | slide delete, slideshow delete, sample replace | viewer, admin |
| `data/slideshows/<folder>/slides/<uuid>-thumb.jpg` | JPEG | mediaService.createThumbnail | `/media` | slide delete, sample replace | admin list and preview |
| `data/audioshows/<folder>/audioshow.json` | JSON `{ tracks: [{ id, type: 'audio', originalName, name?, filename, status, duration, addedAt, error? }] }` | audioShowStore.create | audioShowStore | audioShowStore.modifyItems (locked) | the admin panel (the screens from a later phase) |
| `data/audioshows/<folder>/tracks/<uuid>.m4a` | AAC audio, loudness evened out | uploadQueue (mediaService.processAudio) | `/audio` | track delete, show delete | the admin panel's ▶ |
| `data/branding/logo.png` | PNG within 500×500 | brandingService.saveLogo | `/branding/logo`, logoVersion (mtime) | removeLogo | viewer waiting screen, admin sidebar |
| `data/update-branch.env` | `KEY=value` lines | requestSwitch (via updates/updateFiles), update.sh, install.sh | update.sh, install.sh, updates/updateFiles | same | branch following |
| `data/update-status.json` | flat JSON, all values strings | install.sh and update.sh (`write_json`), requestSwitch (JSON.stringify) | services/updates (getInfo, versionInfo) | same | Software updates card, sidebar "Last updated" |
| `data/update-check.json` | flat JSON | update.sh | updates/updateFiles | update.sh | Software updates card, the schedule's next run (`installCheckedAt`, `fetchedAt`), the waiting version |
| `data/update-schedule.env` | `KEY=value` lines (`NOTICEBOARD_UPDATE_EVERY`, `_TIME`, `_DAY`, `_SINCE`, `_AT`) | the admin panel (updates/updateFiles) | update.sh (lib/schedule.sh), updates/updateFiles | the admin panel; update.sh (`_AT`) | the update schedule (missing: every 15 minutes) |
| `data/restore-defaults` | text (the time asked, and by whom) | contentReset.requestRestore | update.sh, contentReset | deleted by the server at start-up | Restore Defaults |
| `data/update-notice.json` | flat JSON | update.sh (branch merged) | updates/updateFiles | dismissNotice (deletes) | home page notice |
| `data/installer.json` | `{ version (number), branch, commit, time }` | install.sh (last step of a server install) | updates/installerVersion (`installedVersion`) | install.sh | home page installer box, switch check |
| `data/backups/<time>-from-<branch>/…` | copies of the `.json`/`.env` files in `data/` | update.sh before a branch switch | the admin (manually) | none | recovery |
| `tmp/noticeboard-uploads/upload-*`, `logo-*` | uploaded files | multer (slides, logo) | uploadQueue, brandingService | deleted after processing | **update.sh** (upload-in-progress check) |
| `tmp/update-request` | text | requestSwitch | the systemd path unit, update.sh | update.sh deletes it; install.sh deletes it | instant switches |
| `tmp/update.lock` | empty | update.sh / install.sh | flock | none | mutual exclusion |
| `tmp/update-failed-commit` | a SHA | update.sh | update.sh | update.sh | skipping a bad commit |
| `logs/app.log` (+ rotated `app1.log`, …) | winston JSON lines, 5 MB × 3 | logger | people | logger | troubleshooting |
| `/opt/noticeboard/.env` | env file (must exist: the unit's `EnvironmentFile=`) | install.sh (only if missing) | systemd | nobody | `SECURE_COOKIES` |
| `/opt/noticeboard/start-kiosk.sh` (untracked in git) | bash | install.sh | autostart; **updates/installerVersion** (installer version heuristic) | install.sh | server kiosk |
| `client/admin/dist/`, `client/display/dist/` | built SPAs | `npm run build` (install.sh, update.sh) | Express static; displayBuildId | every build | viewer and admin |

Outside the install folder:

| Item | Created by | Purpose |
|---|---|---|
| `/etc/systemd/system/noticeboard.service`, `noticeboard-update.{service,timer,path}` | install.sh | server and updater |
| `/etc/xdg/autostart/noticeboard-kiosk.desktop` | install.sh | starts the kiosk script at login |
| `/usr/local/bin/noticeboard-kiosk.sh` | install.sh (Client) | Client kiosk |
| `~/Desktop/noticeboard-help.desktop` (or the XDG desktop directory) | install.sh | Help shortcut (`file:///opt/noticeboard/noticeboard-guide.html` on a server, `<SERVER_URL>/admin/help` on a display) |
| `~/.config/noticeboard-kiosk/` | Chromium | kiosk browser profile |
| `/tmp/noticeboard-waiting.html`, `/tmp/noticeboard-waiting-profile/` | display kiosk | waiting page |
| `/root/noticeboard-sudoers-backup/` | install.sh (sudo step) | backup of the sudoers rule |
| `/etc/sudoers.d/010_pi-nopasswd` (modified) | install.sh (sudo step, if chosen) | makes sudo ask for a password |
| ufw rules, `noticeboard-firewall-undo` transient unit | install.sh (firewall step, if chosen) | firewall |

---

## 7. User-facing behaviour and where it lives

| Behaviour | Implemented in |
|---|---|
| Slides shown whole, as large as fits, never cut off or stretched, on the chosen background colour | `ImageSlide.vue`, `VideoSlide.vue` (`contain`), `App.vue` (`--nb-background`), `brandingService.backgroundColour` |
| Slides cycle with a fade; each image for its duration, each video for its length; the same slide on every screen at the same moment; unattended for months | `shared/slideTimeline.mjs`, `slideshowClock.js`, `SlideShow.vue`, `SlideFrame.vue`, `ImageSlide.vue`, `VideoSlide.vue` |
| A playlist change waits for the current slide to finish, then every screen switches together | `services/playlistTimeline.js` (the Server) |
| "No slideshow published" with the logo; a pulsing dot while disconnected | `WaitingScreen.vue`, `services/displaySettings` |
| Location pin with the server's address | `DeviceInfo.vue` → `GET /api/device` (`network.lanInterfaces`) |
| The updater's notices on every admin page; the warning mark on every screen while the installer needs running again, or (manual updates) a new version waits | `App.vue` (admin), `UpdateNotice`, `InstallerNotice`, `UpdateAvailableNotice`; `AdminWarning.vue`, `services/displaySettings` (`installerNeeded`, `updateAvailable`), `updates/installerVersion`, `services/updates` |
| Update schedule: every 15 minutes, every 2 hours, daily or weekly at a time, or manual; a waiting version with Update now, Set a time, or the automatic install | `UpdateSchedule`, `UpdateStatus`, `settings/updates.js`, `services/updates` (`schedule.js`, `updateFiles`), `installers/lib/schedule.sh`, update.sh |
| Exit button (kiosk only), cursor hides when idle | `ExitKiosk.vue`, `useActivity.js`, device.js exit requests, kiosk scripts |
| Screens reload after an update; nightly reload; recovery reload | `useSocket.js` (`display:build`), `recovery.js`, `displayBuildId.js` |
| Login, 7-day session, logout | `LoginView`, `auth.js`, `adminAuth.js`, router guard |
| Default-password warning on every page | `DefaultPasswordWarning`, `useSecurity`, `adminPassword.usesDefault` |
| Slideshow list: publish/disable, hide/unhide, delete (not the sample), create | `SlideshowsView`, `routes/api/slideshows.js` |
| Slideshow detail: name, priority, duration, schedule; publish, hide | `SlideshowDetailView`, `SlideshowSettingsCard`, `ScheduleEditor`, `slideshows.js` PUT |
| Upload images and videos; processing status; polling | `SlideList`, `slides.js`, `uploadQueue`, `mediaService` |
| Reorder and delete slides; preview; thumbnails; "Create thumbnails" | `SlideList`, `SlidePreview`, `slides.js` |
| Audio shows: create, settings (order, transition, fade length, volume), publish; tracks: upload (evened out), ▶ to listen, rename, reorder, delete; "Preview the show" as the screens will play it | `AudioShowsView`, `AudioShowDetailView`, `AudioShowSettingsCard`, `ShowPreview`, `shared/audioPlayer.mjs`, `TrackList`, `audioshows.js`, `tracks.js`, `audioShowStore`, `audioShowRules`, `mediaService.processAudio` |
| Slide names: the uploaded file's name by default, renamed with ✎ (the stored file keeps its name); older slides show their type and date added | `SlideList`, `SlidePreview`, `mediaDisplayName` (`shared/index.js`), `slides.js` PATCH, `mediaNames` |
| Scheduling (always, or timed days/times), priority, maximum 5 active | `schedulerService` |
| Sample slideshow (updated by software updates, hideable, not deletable) | `sampleSlideshow.js`, `sample-data/` |
| Display settings (default duration, pin, the video format for new uploads with its H.265 warning); Branding (logo upload/toggle/reset, background colour) | `DisplaySettingsCard`, `BrandingSettings`, `settings/general.js` and `settings/logo.js`, `settingsService`, `brandingService` |
| Convert existing videos to the saved format: warned first, one at a time, each "processing" in its turn while the screens keep its current file | `DisplaySettingsCard`, `settings/videos.js`, `videoConversion`, `mediaService` |
| MAC filtering with the warning pop-up and "add this device" | `MacFilterCard`, `MacFilterWarning`, `macFilter`/`macService`/`macLookup`, `settings/general.js` my-device |
| Password change | `PasswordCard`, `settings/security.js`, `adminPassword` |
| Delete All: every slideshow but the sample, and every audio show, after a warning listing them, the password and a last chance | `DeleteContentCard`, `ConfirmDangerDialogs`, `settings/maintenance.js`, `contentReset`, `actionTokens` |
| Restore Defaults: as if newly installed on the followed branch (warning, password, last chance; the installer recommended afterwards) | `DeleteContentCard`, `ConfirmDangerDialogs`, `settings/maintenance.js`, `contentReset` (`requestRestore`, `applyPendingRestore`), update.sh (restore mode) |
| The port (Settings → Port) and "Restart the Server" (a box on every admin page and the screens' mark while a saved port isn't in use yet; password and last chance; the page moves to the new port) | `ServerPortCard`, `RestartNotice`, `useRestartState`, `settingsService.parsePort`, `restartState`, `settings/maintenance.js`, `AdminWarning` |
| Software updates: status, branch switch with two confirmations, software check, merged-branch notice, installer-needed box | `components/updates/` (SoftwareUpdates, UpdateStatus, BranchSwitcher, SwitchDialogs, UpdateNotice, InstallerNotice), `useUpdateInfo`, `services/updates`, `systemCheck`, update.sh |
| Sidebar: logo, By Fructus Sum, links, Last updated, collapse | `NavBar`, `NavIcon`, `useNav`, `useBranding` |
| Section cards fold away to their title (remembered; a card with a warning stays open) | `CollapsibleCard`, `useCollapsed`, and the eight cards that use it |
| User guide | `noticeboard-guide.html`, served at `/admin/help` |

---

## 8. Installation

Entry point: `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash`, or `sudo bash installers/install.sh`.

`install.sh` holds the configuration, the switch to the latest installer, the loading of its parts and `main()`, which is called on the last line, so a half-downloaded script runs nothing. `set -euo pipefail`. The steps are in `installers/lib/*.sh` and the kiosk scripts in `installers/kiosk/` (§12.9).

1. **Root check** (`EUID`).
2. **`use_latest_installer`**. Unless `NOTICEBOARD_INSTALLER_SHA` is set:
   - Find the branch this Server follows from `data/update-branch.env` (`followed_branch`), else `main`.
   - `run_installer_from <branch>`:
     - `GET api.github.com/repos/…/commits/<branch>` with the `vnd.github.sha` header, to get the SHA.
     - Download `raw.githubusercontent.com/…/<sha>/installers/install.sh` to `/tmp`.
     - Check it with `bash -n`. A non-main branch's installer must also contain a line beginning `INSTALLER_VERSION=`.
     - `exec` it with `NOTICEBOARD_INSTALLER_SHA` and `NOTICEBOARD_INSTALLER_BRANCH` exported.
   - If that fails, fall back to main's installer. If that fails too, carry on with this copy.
   - Only `install.sh` is downloaded here (older installers do the same when they hand over).
3. **`load_modules`**: the parts from the same commit as the script. `NOTICEBOARD_INSTALLER_SHA=local`: next to the script. A commit: each file downloaded from `raw.githubusercontent.com/…/<sha>/installers/{lib,kiosk}/…` into `mktemp -d`. Not set (the latest installer couldn't be fetched): next to the script if it's in a checkout, else downloaded at the followed branch. Each module is checked with `bash -n` and loaded, the kiosk templates are read into `KIOSK_TEMPLATE_server` / `KIOSK_TEMPLATE_display`, the functions `main()` calls are checked, and the download is deleted. Anything missing or broken: an error and exit 1, before any change.
4. `DESKTOP_USER=${SUDO_USER:-pi}`, banner, `/dev/tty` check (questions are read from `/dev/tty`, because stdin is the script under `curl | bash`).
5. `choose_mode` (1 server / 2 display; the default is guessed from `/opt/noticeboard/.git` or the display kiosk script). `NOTICEBOARD_MODE` skips the question.
6. Server: `choose_branch`. If `update-branch.env` names a non-main branch, ask whether to keep it or go back to main.
7. `use_branch_installer`. If the chosen branch differs from the branch the installer came from, hand over to that branch's installer, passing `NOTICEBOARD_MODE` and `NOTICEBOARD_INSTALL_BRANCH`.
8. Display: `ask_server_url` (the default is taken from the existing kiosk script's `SERVER_URL=` line).
9. **`check_sudo_password`** (optional hardening):
   - Find the `NOPASSWD: ALL` rule for the user in `/etc/sudoers.d/*` and back it up to `/root/noticeboard-sudoers-backup`.
   - Comment the rule out in a copy and install the copy only if it passes `visudo -cf`.
   - Prove the user's password works through `sudo -S`, and restore the backup on any failure.
10. **Server install (`install_server`):**
   1. `update_system`: `apt-get update`, then `dist-upgrade` with `force-confold` and a 300 s lock wait.
   2. `apt-get install git ffmpeg chromium|chromium-browser curl`.
   3. `node_new_enough` (20.19+, 22.12+, or 23+), else NodeSource `setup_20.x` and `apt-get install nodejs`. Abort if still too old.
   4. Get the code: an existing `.git` gets `lock_install_dir` (flock on `tmp/update.lock`), removal of `tmp/update-request`, `fetch_branch` as the owner (falling back to main), then `checkout --force -B`. Otherwise `git clone` as root, then the lock.
   5. `npm install`, `npm run build`, `npm prune --omit=dev`.
   6. If `data/config.json` is missing: `node -e "require('./server/services/configService').init()"`.
   7. `.env` if missing (`SECURE_COOKIES=false`).
   8. `save_branch_setting`: writes `update-branch.env` only if the branch changed, and always writes `update-status.json` (`state: updated`).
   9. `write_service`, `daemon-reload`, `enable`, `restart noticeboard`.
   10. `write_server_kiosk` (`installers/kiosk/server.sh` as it is → `/opt/noticeboard/start-kiosk.sh`), `write_autostart`, `write_help_shortcut file://…/noticeboard-guide.html`.
   11. `chown -R <user> /opt/noticeboard`.
   12. `write_update_units` (service, path, timer), enable the timer and path units.
   13. `write_installer_record` → `data/installer.json` (`INSTALLER_VERSION=4`).
11. **Display install (`install_display`):** `update_system`, `apt-get install chromium curl`, `collect_macs_html` (the MAC addresses from `/sys/class/net/*/address` as table rows), `write_display_kiosk` (`installers/kiosk/display.sh` with its `SERVER_URL=""` and `MACS_HTML=""` lines filled in → `/usr/local/bin/noticeboard-kiosk.sh`), `write_autostart`, `write_help_shortcut <SERVER_URL>/admin/help`.
12. The summary (server: URLs using `hostname -I` and `slideshow_port`, the default password, sudo status, logs, branch).
13. **`check_firewall`** (optional; its errors never stop the installer):
    - Ask first.
    - If ufw is active, only allow the slideshow port.
    - If firewalld is running, only add the port.
    - If there are other nft or iptables rules, leave them alone.
    - Otherwise offer `setup_ufw`:
      - Ask about SSH (port detected from `ssh.socket` or `sshd -T`).
      - Confirm the slideshow port, and ask about VNC.
      - Install ufw, allow the ports plus `5353/udp`, set the default policies.
      - Over SSH, arm a 3-minute `systemd-run` undo before `ufw --force enable`, then ask the user to confirm a new SSH login within 170 s.
14. `offer_reboot` (Enter = `systemctl reboot`).

Where each step lives: §12.9. The prompts (`ask_yes_no`, `ask_choice`, `ask_port`, `ask_yes_in_time`) and the boxed `banner` are in `lib/ui.sh`, used by every step that asks or prints a heading.

---

## 9. Updates and branch following

### 9.1 `installers/update.sh`

Everything runs from `main()` on the last line, because `git checkout` replaces this file while it runs. `set -euo pipefail`. `INSTALL_DIR` is taken from the script's own location. Before `main()` it loads `installers/lib/branch.sh` and `lib/json.sh` from its own commit, so a checkout can't swap them mid-run; if it can't, it stops before touching anything.

1. Work out `BRANCH`: `NOTICEBOARD_BRANCH` (a one-off) → `update-branch.env` → `main`. Also read `MAIN_AT_SWITCH`.
2. If running as root while the folder is owned by someone else, re-exec as the owner. Refuse to run as any other user.
3. Read the schedule (`read_schedule`), the time (`now_epoch`), and `installCheckedAt`/`fetchedAt` from the check file. If `tmp/update-request` exists, delete it at once; unless it says `check`, set `requested` and `force`. `--force` also sets `force`.
4. `flock -n tmp/update.lock`. If it's busy, write `status: requested` (for a switch, or for Update now, which also sets the schedule's `AT` to now so the next run installs) and exit 0.
5. `PREVIOUS_BRANCH` = the current symbolic ref, `CURRENT` = `HEAD`. `valid_branch`, else cancel and restore the setting.
6. The service must be `active` or `activating`, else `check: waiting`.
7. Uploads in progress (a file younger than 60 min in `tmp/noticeboard-uploads`) → `check: waiting`.
7a. **May this run install?** `due` when requested, when switching, or when `install_due` (lib/schedule.sh) says so. Otherwise it only checks; in manual mode, not at all if the last check was less than a day ago.
8. **Merged-branch return**, only when `due`, following a non-main branch and not switching: `branch_merged`.
   - Fetch main.
   - If the branch was deleted (`ls-remote` exit code 2), compare `CURRENT`.
   - Otherwise require main to have moved on from `MAIN_AT_SWITCH`.
   - Then `merge-base --is-ancestor`, or `merge-tree --write-tree` to detect a squash or rebase.
   - If merged: `write_branch_setting main`, `switching=1`, `RETURNED_FROM`.
9. `git fetch origin +refs/heads/B:refs/remotes/origin/B`. On failure: a switch is cancelled; a deleted branch gives `check: error`; otherwise `check: offline`.
10. `TARGET = origin/B`; record `fetchedAt`, and when `due` `installCheckedAt` (and remove a set time that has come). If it equals `CURRENT`: when switching, check out the branch and write the notice or status. Always `check: up-to-date`.
11. A previously failed target (`tmp/update-failed-commit`) is skipped unless forced.
11a. **Not due:** `check: available` with the waiting commit, its subject and date, and when it will be installed; exit 0.
12. `refuse_reason`: the target has files in `data tmp logs .env`, or (when switching) its `update.sh` lacks the text `update-branch.env`.
13. On a switch, `backup_settings` → `data/backups/<time>-from-<prev>/`.
14. `status: updating`. `PORT = server_port` (node + configIO).
14a. **Restore Defaults** (`data/restore-defaults` exists): the run is due and forced, skips the merged-branch return, installs even when `TARGET` equals `CURRENT`, first cleans the folder (`clean_folder`: `git clean -ffdxq` keeping `RESTORE_KEEP`: `data/`, `tmp/`, `logs/`, `.env`, `start-kiosk.sh`, `node_modules/`, `client/*/dist/`), restarts the server even if the install failed and was rolled back (the server resets its data at start-up), and writes its status after the restart.
15. `install_commit`: `checkout --force -B`, `npm install --include=dev`, `npm run build`, `npm prune --omit=dev`. On failure: re-install `CURRENT` → `rolled-back`, or `failed`.
16. `wait_for_uploads` (at most 30 min), then `restart_server`:
    - `kill -TERM` the `MainPID`; systemd restarts the service.
    - Wait up to 90 s for a new PID that answers `GET http://localhost:$PORT/api/auth/status`.
    - On failure, roll back and restart again.
17. Success: remove the failed-commit file, write the status (`updated`, the switched message, or the merged notice), `remember_main` (records `NOTICEBOARD_MAIN_AT_SWITCH` after a switch to a non-main branch), `check: up-to-date`.

Every `write_check` also records `installCheckedAt`, `fetchedAt` and `nextInstall` (`next_install`), so the admin panel shows when the next automatic install is without working it out itself. **The schedule's rules** (`lib/schedule.sh`, D41): 15 minutes, every run; 2 hours, 2 hours since the last run that could install (or since the schedule was chosen, `SINCE`); daily and weekly, the first run at or after the chosen time since then, so a Server that was off catches up at its next run; manual, never by itself. A set time (`AT`) takes the place of the automatic install until it has come. Times are the Server's local clock; `NOTICEBOARD_NOW` sets the time for tests.

`write_json` (`lib/json.sh`, shared with the installer) builds flat JSON objects from strings in bash, stripping control characters and escaping `\` and `"`, and replaces the file atomically.

### 9.2 Server side (`services/updates/`)

- **`getInfo`:** git HEAD and branch, the configured branch, the status file, the check file, whether the timer and path units are enabled (from the `*.wants` symlinks), whether a request is pending, and `busy` (requested or updating less than 60 min ago).
- **`checkBranch`:** `ls-remote`, fetch, the same refusals as `update.sh`, the latest commit's subject and date, and `requirementsOf(commit)`. The latter reads `system-requirements.json` at that commit, runs `systemCheck.checkRequirements`, and calls `installerNeeds`.
- **The switch has three steps:** `checkBranch`, then `verify-password` issues a one-time token, then `switch` consumes it and calls `requestSwitch`.
  - `requestSwitch` rechecks the branch and refuses missing software unless `acceptMissing`.
  - `updateFiles.saveSwitch` writes the branch file, then `status: requested`, then the request file, and restores all three on failure.
- **The schedule:** `setSchedule` and `setInstallAt` check the values (`updates/schedule.js`), save them (`updateFiles`) and write a `check` request, so update.sh records the new next install time within seconds; `installNow` writes status `requested` and an `install-now` request. `getInfo` adds the schedule and the waiting version (`waitingUpdate`: the check file's `available`, unless it is the running commit); `manualUpdateWaiting` gives the screens' `updateAvailable`.
- **Installer-needed:** `installerVersion.installedVersion` reads `data/installer.json`, else estimates from `start-kiosk.sh` (contains `kiosk-exit` → 1, else 0; no file → null). It is compared with `installer.version` in `system-requirements.json`.

---

## 10. Operating-system integration

**systemd unit `noticeboard.service`:**

```
User=<desktop user>, WorkingDirectory=/opt/noticeboard, EnvironmentFile=/opt/noticeboard/.env
ExecStart=/usr/bin/node server/index.js, Restart=always, RestartSec=5
```

**The update units:**

```
noticeboard-update.service   Type=oneshot, User=<user>, ExecStart=/bin/bash /opt/noticeboard/installers/update.sh, TimeoutStartSec=60min
noticeboard-update.timer     OnBootSec=5min, OnUnitActiveSec=15min, RandomizedDelaySec=60
noticeboard-update.path      PathExists=/opt/noticeboard/tmp/update-request
```

**Desktop:**
- XDG autostart runs `Exec=<kiosk script>`.
- Chromium runs with flags that suppress error dialogs, the infobar, update checks and the first-run pages, with its own `--user-data-dir`, and (installer version 3) `--autoplay-policy=no-user-gesture-required`, so background audio plays without a click. The Server's kiosk opens `http://localhost:<port>/`, the port read from `data/config.json` each time it waits for the Server (installer version 4; 3000 if it can't be read).
- `xset` turns screen blanking off (X11 only; it's a no-op on Wayland/labwc).

**Privileges:**
- The installer runs as root.
- The server and the updater run as the desktop user.
- The updater restarts the server by killing it (systemd restarts it), so it never needs sudo.

**Other integration:**
- **Logging:** the kiosk scripts use `logger -t noticeboard-kiosk` (the journal).
- **ARP:** the server's MAC filter reads the ARP table through `node-arp` (which runs `arp`).

---

## 11. External programs and packages

### 11.1 npm packages (runtime)

| Package | Used in | For |
|---|---|---|
| express | app.js, every route | HTTP |
| helmet | app.js | security headers (CSP off) |
| cookie-parser | app.js | the admin cookie |
| express-rate-limit | api/index.js, auth.js, settings/updates.js | rate limits |
| jsonwebtoken | services/adminSession.js | sessions |
| bcrypt (native) | configService (the default hash), services/adminPassword.js | passwords |
| json5 | configIO | parsing config.json |
| multer | middleware/uploads.js (and the error class in slides.js) | uploads (file names read as UTF-8: `defParamCharset`) |
| sharp (native) | mediaService, brandingService | images and the logo |
| fluent-ffmpeg | mediaService | video transcoding, duration, thumbnails (needs the `ffmpeg` and `ffprobe` binaries) |
| p-queue 7 (ESM only) | uploadQueue (`require('p-queue').default`) | processing queue. Needs Node's `require(esm)`, available from **Node 20.19** or **22.12** |
| node-arp | macLookup | MAC lookup |
| socket.io / socket.io-client | realtime/displaySocket.js / useSocket.js | real-time channel |
| winston | logger | logging |
| vue, vue-router | client apps | UI |
| **cors** | **nothing** | unused (left in on purpose: the owner, 2026-09-28) |

Build only (npm's devDependencies, removed by `npm prune --omit=dev` after the build): `vite`, `@vitejs/plugin-vue` (the client builds). **Unused:** `nodemon` (server) and `concurrently` (root), left in on purpose (the owner, 2026-09-28: removing them means regenerating the lockfile on Linux, for no change to what runs).

### 11.2 System programs

| Program | Used by | For |
|---|---|---|
| `node` 20.19+ or 22.12+, `npm` | server, installers | runtime and build |
| `git` 2.38+ (for `merge-tree --write-tree`) | installers, updates/git.js | install, update, branch info |
| `ffmpeg`, `ffprobe` | mediaService | video |
| `curl` | installers, kiosk scripts | downloads, health and exit checks |
| `chromium` / `chromium-browser` | kiosk scripts | display |
| `arp` (net-tools) | node-arp | MAC filter |
| `date` (GNU: `-d`, used by lib/schedule.sh), `systemctl`, `systemd-run`, `flock`, `runuser`, `logger`, `xset`, `xdg-user-dir`, `getent`, `visudo`, `passwd`, `ss`, `ps`, `sshd`, `ufw`, `firewall-cmd`, `nft`, `iptables`, `apt-get`, `apt-cache`, `hostname`, `stat` | installers | OS set-up |

`system-requirements.json` lists Node.js, npm, Git, FFmpeg, FFprobe, curl and Chromium, with version ranges and install hints. It also holds `installer.version` and `installer.changes`.

---

## 12. File and module map

Layout of each entry: **purpose** · responsibilities · key functions · imported by → imports · configuration · data · external · relied on by.

### 12.1 Server entry and wiring

**`server/index.js`**
- **Purpose:** process entry point, and the systemd `ExecStart` target.
- **Responsibilities:** start-up order, listen, graceful shutdown.
- **Functions:** `main()`, `shutdown()`.
- **Imports:** configService, schedulerService, audioEventClock, sampleSlideshow, app, realtime/displaySocket, logger.
- **Configuration and environment:** `port`.
- **Relied on by:** systemd (the path `server/index.js` is baked into the unit file), `npm start`, update.sh (restart), and the test harnesses.

**`server/app.js`**
- **Purpose:** the Express app factory, `createApp()`: helmet, json, cookies, `mountRoutes`, `errorHandler`.
- **Imported by:** index.js.

**`server/realtime/displaySocket.js`**
- **Purpose:** the only socket.io module. `initDisplaySocket(httpServer)`: lets only approved devices connect (MAC filtering, `io.use`), and closes those no longer approved when MAC filtering changes; on connect sends `display:build` and `display:settings`; answers `time:ping` with the Server's time (`time:pong`); answers `display:ready` with the running playlist and then `audio:update`; broadcasts `audio:update` (only when changed) on a config `'change'` and `displayEvents.audioChanged`; offers the playlist to the timeline (`playlistTimeline`) on the scheduler's `'update'` and `displayEvents.playlistChanged`, and broadcasts `playlist:update` when the timeline switches; broadcasts `display:settings` (only when changed) on a config `'change'` and `displayEvents.displaySettingsChanged`.
- **State:** inside the function: the io server, the last settings sent and the running playlist's timeline.
- **Imports:** socket.io, macService, schedulerService, configService, displayEvents, playlistService, playlistTimeline, audioPlaylist, displaySettings (the payload, and its installer state checked every 5 minutes), displayBuildId, logger, `shared/contract.json`.
- **Imported by:** index.js only.
- **Change impact:** `/socket.io`, the event names and the payloads are the contract with screens already open.

**`server/config/defaults.js`**
- **Purpose:** the default `config.json` contents, without the secrets.
- **Used by:** configService.

**`server/config/passwordDefaults.js`**
- **Purpose:** `DEFAULT_PASSWORD` and `HASH_ROUNDS`. A leaf module, so configService and adminPassword can both use it without importing each other. It is not in defaults.js, because that object is copied into config.json.

### 12.2 Middleware

**`middleware/access.js`**
- **Purpose:** the MAC-filter and admin checks, written once.
- **API:** `requireApprovedDevice(area)`: resolve the device; deny with a plain-text 404 `Not Found`; log `<area>: MAC denied` (or "MAC filter error" / "Admin auth error" when resolving fails); set `req.clientMac`. `requireAdmin`: `requireApprovedDevice('Admin')`, then the session cookie: 401 `{error:'Not authenticated'}` without one, or 401 `{error:'Session expired'}` with the cookie cleared and "Admin: JWT invalid" logged; sets `req.admin`.
- **Imports:** macService, adminSession, logger.

**`middleware/macFilter.js`**, **`middleware/adminAuth.js`**
- **Purpose:** one-line names for `requireApprovedDevice('Display')` and `requireAdmin`, so the mounting in the routes reads clearly.
- **Used by:** routes/index.js (media, help, logo, admin, display) and api/index.js (auth, device: macFilter; settings, slideshows and slides: adminAuth).

**`middleware/asyncRoute.js`**
- **Purpose:** `route(handler)`: an async handler whose rejection goes to `next(err)`.
- **API:** `route(handler)` (a rejection → `next(err)`) and `jsonRoute(handler)` (sends the returned value; an error marked `expose` → its status and `{ error }`).
- **Used by:** auth.js, slideshows.js, slides.js, and every settings route. No route has its own try/catch (D36).

**`middleware/uploads.js`**
- **Purpose:** `createUpload({ prefix, maxFileBytes, allowed, rejectMessage })`, the one multer set-up. Each file's own name is read as UTF-8, as browsers send it. Files wait in `tmp/noticeboard-uploads/` as `<prefix>-<time>-<random><ext>` (update.sh waits for that folder); a refused type is an Error with status 400.
- **Used by:** slides.js, settings/logo.js.

**`middleware/passwordLimiter.js`**
- **Purpose:** `wrongPasswordLimiter`, the one limit on wrong passwords inside the admin panel: 5 per 15 minutes, only 403s counted, shared by every password check (D40).
- **Used by:** settings/updates.js, settings/maintenance.js.

**`middleware/errorHandler.js`**
- **Purpose:** the last Express error handler: logs the error with its details, then answers "Internal server error" (JSON for `/api/`, plain text otherwise).

### 12.3 Routes

**`routes/index.js`**
- **Purpose:** mounts everything in order (§3.3).
- **Uses:** `pathHelpers.displayDistDir` and `adminDistDir` for the built apps, and `mediaTypes.SERVED_EXTENSIONS` for the `/media` allowlist.
- **Imports:** macFilter, asyncRoute, spa, pathHelpers, brandingService, mediaTypes, `./api`.

**`routes/spa.js`**
- **Purpose:** `spaFallback(distDir, { title, background, name })`: every GET gets the app's built `index.html`, or, when it isn't built, the "<name> app not yet built" page.
- **Used by:** routes/index.js, for `/` and `/admin`.

**`routes/api/index.js`**
- **Purpose:** API rate limit and sub-router mounting (§4.1). The slides router is mounted inside a small slideshows API router (`/:folder/slides` first, then the slideshows router), behind one adminAuth.

**`routes/api/auth.js`**
- **Purpose:** login, logout, status. `GET /status` answers with `Cross-Origin-Resource-Policy: same-site` (everything else keeps helmet's `same-origin`), so the admin panel on the old port can see the Server answer on a new one after a restart (an opaque answer: it learns nothing else).
- **Owns:** the login rate limit (5 per 15 minutes).
- **Uses:** adminPassword (`verify`), adminSession (`issue`, `clear`, `isLoggedIn`), asyncRoute, logger.

**`routes/api/device.js`**
- **Purpose:** the server's addresses for the pin, and kiosk exit requests.
- **Functions:** `deviceOf` (loopback → `this-server`, else the plain address).
- **State:** the `exitRequests` Map.
- **Uses:** `network` (`lanInterfaces`, `plainAddress`, `isLoopback`).
- **Relied on by:** the kiosk scripts (exact JSON).

**`routes/api/settings/`**
- **`index.js`:** mounts the five parts under `/api/settings` (their paths don't overlap).
- **`general.js`:** `GET/PUT /` (settingsService), `/device` (network), `/my-device` (`req.clientMac`).
- **`security.js`:** `/security` and `/password` (adminPassword).
- **`logo.js`:** `/logo` GET/POST/DELETE (`logoInfo`, uploads with prefix `logo`, 20 MB, `LOGO_MIME`; brandingService; `displayEvents.displaySettingsChanged`).
- **`updates.js`:** the software-update routes and `/version` (services/updates, `jsonRoute`, `wrongPasswordLimiter`).
- **`maintenance.js`:** `/maintenance/verify-password` (the password for an action → its token; `wrongPasswordLimiter`) , `/maintenance/delete-all` (with the token: `contentReset.deleteAllContent`) and `/maintenance/restore-defaults` (with the token: `contentReset.requestRestore`).
- **`videos.js`:** `GET/POST /videos/convert` (videoConversion `status`, `start`).

**`routes/api/slideshows.js`**
- **Purpose:** slideshow CRUD, thin.
- **Functions:** `describe` (adds `sample` and `slideCount`).
- **Uses:** slideshowStore (list, find, create, replace, remove, slideCount), slideshowRules (duration, hide rule, `isSample`, the sample message), asyncRoute, displayEvents (`playlistChanged` after a change), logger.

**`routes/api/slides.js`**
- **Purpose:** the slides' routes: `createItemsRouter` (routes/api/mediaItems.js) with the slideshow store, the image and video types and the slides' words, plus `POST /thumbnails` and `PUT /:id/sound` (a video's own sound).
- **Uses:** mediaItems, slideshowStore (`store`), mediaTypes, uploadQueue (`enqueueProcessing`, `enqueueThumbnail`), slideshowRules (`parseVideoSound`), asyncRoute, displayEvents, logger.
- **Side effects:** `displayEvents.playlistChanged()` after delete, reorder and a sound change.

**`routes/api/mediaItems.js`**
- **Purpose:** `createItemsRouter({ store, allowed, words, enqueue, changed, extend })`: the routes every show's items share: a show-exists check, upload (recording each file's `originalName`; 50 files, 500 MB each), list, rename, delete, reorder, and the upload error handler. Each kind passes its store, its MIME types, its words (so its messages and log lines are its own) and what to do after a change; `extend` adds its own routes.
- **Uses:** mediaTypes (`typeFromMime`), mediaNames, uploadQueue (`queueSize`), uploads (`createUpload`), asyncRoute, logger. **Used by:** slides.js, tracks.js.

**`routes/api/audioshows.js`**
- **Purpose:** the audio shows: list (with `trackCount` and `eventState`), create, read, change (audioShowRules), the event (`PUT /:folder/event`, audioShowRules.parseEvent), delete (also clearing it from the slideshows that chose it, in the same config write: `remove(folder, { slideshows })`).
- **Uses:** audioShowStore, audioShowRules, audioEvents (`eventState`), slideshowStore, asyncRoute, logger.

**`routes/api/tracks.js`**
- **Purpose:** the tracks' routes: `createItemsRouter` with the audio show store, `AUDIO_MIME` and the tracks' words; uploads go to `uploadQueue.enqueueProcessing` with that store; a track processed, deleted or reordered calls `displayEvents.audioChanged`.
- **Uses:** mediaItems, audioShowStore, mediaTypes, uploadQueue, displayEvents.

### 12.4 Services

**`services/configService.js`**
- **Purpose:** a singleton EventEmitter owning `data/config.json` in memory.
- **API:** `init()`, `get(key?)`, `set(key, value)` (emits `'change', key, value`), `update(partial)` (a shallow assign; emits `'change'`).
- **Defaults:** `_generateDefaults()` hashes `DEFAULT_PASSWORD` from `config/passwordDefaults.js`.
- **Output:** through the logger. The installer's first-install `node -e … init()` therefore prints the "Created default config.json" line in the logger's format, and creates `logs/` before the installer's `chown -R`.
- **Imported by:** nearly every server module, and the installer (`lib/server.sh`, `init()` on a first install).

**`services/adminPassword.js`**
- **Purpose:** the admin password.
- **API:** `verify(password)` (bcrypt with `config.passwordHash`; throws for a non-string), `change(current, next)` → `{ ok }` or `{ status, error }` (400 missing, 400 too short, 403 wrong current; then `configService.set('passwordHash')`), `usesDefault()` (cached per hash), `MIN_LENGTH`.
- **Used by:** auth.js, settings/security.js, settings/updates.js.

**`services/adminSession.js`**
- **Purpose:** the login session. `COOKIE_NAME` (`nb_admin_token`), `issue(res)` (JWT `{role:'admin'}`, 7 days, httpOnly, sameSite strict, `secure` from `SECURE_COOKIES`), `verifyToken`, `tokenOf(req)`, `isLoggedIn(req)`, `clear(res)`.
- **Used by:** auth.js, access.js.

**`services/schedulerService.js`**
- **Purpose:** a singleton EventEmitter giving the active slideshows (enabled, not hidden, schedule matches; sorted by `priority ?? 999`; top 5).
- **API:** `init()`, `stop()`, `getActive()`, `computeActive()`, `_matchesSchedule` (a timed schedule: `utils/weeklyTimes.inWeeklyWindow`, shared with event audio).
- **Emits:** `'update'`.
- **Uses:** configService (its `'change'` event), slideshowStore (the list), weeklyTimes, logger.

**`services/macService.js`**
- **Purpose:** request → `{ mac, ip, approved }`; the same for an address (a socket.io connection's); `isMacApproved(mac)` checks config.
- **API:** `resolveRequest`, `resolveAddress`, `isMacApproved` (`getClientIp` is internal).
- **Uses:** macLookup, configService, logger.

**`services/mediaService.js`**
- **Purpose:** converting uploads into slides.
- **API:** `processImage` (sharp → PNG), `processVideo(input, outDir, id, format)` (ffmpeg → H.265 MP4: libx265, CRF 28, `hvc1` tag; or H.264: libx264, CRF 23), `processAudio` (ffmpeg → AAC `.m4a`, 192 kbit/s, `loudnorm` to −16 LUFS), `videoFormatOf` (ffprobe: `h265`, `h264`, …), `getMediaDuration` (ffprobe), `createThumbnail`.
- **Used by:** uploadQueue.

**`services/mediaNames.js`**
- **Purpose:** the media name rule (D38): `cleanName` (trimmed, no control characters), `nameFromUpload` (the file's own name without any path, cut to the limit, or null), `MAX_LENGTH` (`limits.mediaNameMax`).
- **Used by:** slides.js, sampleSlideshow (its slides are named after the sample files). The audio tracks will use it too.

**`services/mediaTypes.js`**
- **Purpose:** every media type list, in one place, each the one its caller needs.
- **API:** `IMAGE_MIME`, `VIDEO_MIME`, `AUDIO_MIME`, `typeFromMime` (`image`, `video`, `audio`), `LOGO_MIME`, `SERVED_EXTENSIONS` (`/media`, including audio types nothing produces there), `AUDIO_SERVED_EXTENSIONS` (`/audio`: `.m4a`), `SAMPLE_IMAGE_EXT`, `SAMPLE_VIDEO_EXT`.
- **Used by:** slides.js, settings/logo.js, routes/index.js (`/media`), uploadQueue, sampleSlideshow.

**`services/uploadQueue.js`**
- **Purpose:** p-queue (concurrency 2) for processing and thumbnails.
- **API:** `enqueueProcessing({ store, folder, slideId, tmpPath, mime, changed })` (any show's store, the slideshows' by default; images, videos (records their `format`) and audio tracks (`processAudio`); `changed()` afterwards, the playlist by default), `enqueueThumbnail` (also records a missing length, and sends the playlist), `queueSize`, `updateItem` (internal: the store's `modifyItems`; an item deleted meanwhile stays deleted).
- **Side effects:** updates `slideshow.json` through the store, deletes the temporary upload, `displayEvents.playlistChanged()` once a slide is ready.
- **Used by:** slides.js, sampleSlideshow.

**`services/brandingService.js`**
- **Purpose:** the logo (fit 500×500, save, remove, placeholder cache, version = mtime, `logoEnabled`) and `backgroundColour()` (the saved colour, else the contract's default).
- **Used by:** services/displaySettings.js, routes/index.js, settings/logo.js.

**`services/displaySettings.js`**
- **Purpose:** the one place that builds the `display:settings` payload: `current()` → `{ showDeviceInfo, logo, background, installerNeeded, updateAvailable, restartNeeded }`; `refresh()` reads the installer state again (`installerVersion.status`), keeping the last one on an error.
- **Uses:** configService, brandingService, updates/installerVersion, updates (`manualUpdateWaiting`), restartState, logger.
- **Used by:** realtime/displaySocket.js.

**`services/restartState.js`**
- **Purpose:** the settings that only take effect at start-up (the port): `setRunning({ port })` (index.js), `status()` → `{ restartNeeded, port: { running, saved } }`, `requestRestart(by)` (logs, then ends the process with SIGTERM's graceful shutdown half a second later; systemd starts it again, `Restart=always`).
- **Uses:** configService, logger. **Used by:** server/index.js, settings/maintenance.js, displaySettings.

**`services/sampleSlideshow.js`**
- **Purpose:** `syncSampleSlideshow()`. It signs the sample files together with `sample.json`, and creates, restores (hidden) or replaces the sample's slides. It applies the `sample.json` settings, and replaces an older config's `sampleSlideshowAdded` flag with `sampleSlideshow`.
- **Replacing the slides:** `store.modifySlides` saves the new list first; the old files are deleted after, so `slideshow.json` never points at missing files. The config (entries + `sampleSlideshow`, without the older flag) is written in one `store.commitEntries`.
- **Uses:** slideshowStore, mediaTypes (which sample files are slides), configService (`sampleSlideshow`), pathHelpers, slugify, uploadQueue, logger.

**`services/showStore.js`**
- **Purpose:** `createShowStore({ kind, configKey, rootDir, fileName, itemsKey, mediaDirName, fallbackSlug, newEntry })`: one owner for a kind of show's entries (`config[configKey]`) and folders (the JSON file with its items, and the items' files): `list`, `find`, `create`, `replace`, `remove(folder, other?)` (other keys written in the same config write), `removeMany`, `commitEntries`, `readItems`, `modifyItems` (locked per `<kind>:<folder>`, written only when changed), `itemCount`, `itemFileExists`, `removeItemFiles`, `mediaDir`.
- **Uses:** configService, configIO, folderLock, slugify. **Used by:** slideshowStore, audioShowStore.

**`services/audioShowStore.js`**
- **Purpose:** the audio shows' store: `config.audioShows` and `data/audioshows/<folder>/` (`audioshow.json` with `tracks`, and `tracks/`); a new show is unpublished, in order, without a transition, with the contract's fade length and volume.
- **Uses:** showStore, pathHelpers (`audioShowsDir`), contract (`audio`). **Used by:** audioshows.js, tracks.js.

**`services/audioShowRules.js`**
- **Purpose:** `applyChange(before, body)` → `{ entry }` or `{ error }`: an audio show's settings checked against the contract's `audio` limits (D44). `parseEvent(body, folder, shows, now)` → `{ event }` or `{ error, status? }`: an event checked (the modes, the times, not already passed) and refused with 409 when it overlaps another show's (`audioEvents.clashes`).
- **Uses:** contract, audioEvents, weeklyTimes. **Used by:** audioshows.js.

**`services/audioEvents.js`**
- **Purpose:** event audio's rules, with no state: `activeEvent(shows, now)` (a scheduled event on now, else the latest started by hand that no scheduled event has started after), `nextChange(shows, now)`, `clashes(folder, event, shows)`, `eventState(folder, shows, now)` (`playing`, `next` with `at`, `ended`), `describe(event)`, `parseLocal(text)`.
- **Uses:** weeklyTimes. **Used by:** audioEventClock, audioShowRules, audioshows.js; `server/test/audioEvents.test.js`.

**`services/audioEventClock.js`**
- **Purpose:** a singleton EventEmitter, like the scheduler: `init()`, `stop()`, `getActive()` (the folder whose event is playing), `'update'` when it changes. Recomputes on a config change and at the next start or end (a timer, at most a minute away).
- **Uses:** audioEvents, audioShowStore, configService, logger. **Used by:** server/index.js, displaySocket.

**`services/slideshowStore.js`**
- **Purpose:** the one owner of the slideshow entries (`config.slideshows`) and each `data/slideshows/<folder>/` (its `slideshow.json` and `slides/`): a show store with the slideshows' settings, under the names below; `store` is the show store itself, for code shared by every kind.
- **API:** `list`, `find`, `create` (folder, `slides/`, an empty `slideshow.json`, an unpublished entry with the next priority), `replace`, `removeMany` (the entries in one config write, with other keys if given, then their folders), `remove` (entry, then folder), `commitEntries(entries, other)`, `readSlides` (missing/broken → no slides; other keys kept; no slides list → no slides), `modifySlides(folder, fn)` (locked; written only if fn changed the data), `slideCount`, `slideFileExists`, `removeSlideFiles`.
- **Uses:** showStore, pathHelpers (`slideshowsDir`).
- **Used by:** slideshows and slides routes, uploadQueue, sampleSlideshow, schedulerService, playlistService, audioPlaylist, audioshows.js (clearing a deleted audio show).

**`services/videoConversion.js`**
- **Purpose:** converting the existing videos (D43): `start()`, `status()` (`running`, `total`, `done`, `converted`, `skipped`, `failed`, `current`, `format`, `finishedAt`), `formats()` (`{ format, total, other }`: the videos not in the saved format, from each one's recorded format or ffprobe, nothing written), `recover()` (start-up). One video at a time; a video not in the saved format is marked `processing` + `reprocessing` in its turn, converted into `tmp/noticeboard-uploads/convert-*` (update.sh waits for it), moved into place under a new name, its old file deleted, the playlist sent.
- **Uses:** slideshowStore, mediaService, settingsService (`videoFormat`), displayEvents, pathHelpers, logger. **Used by:** settings/videos.js, server/index.js.

**`services/playlistService.js`**
- **Purpose:** `buildPlaylist(active)` → `{ slides: [{ type, url, duration, slideshow, length?, sound?, withSound?, lowerTo? }] }` (§3.4).
- **Uses:** slideshowStore, configService (the default duration), pathHelpers (`mediaUrl`).
- **Used by:** realtime/displaySocket.js (which adds `startedAt` through playlistTimeline).

**`services/playlistTimeline.js`** (since 0.7.0, §18.8)
- **Purpose:** `createPlaylistTimeline({ onSwitch, now, timers })` → `offer(slides)`, `current()` (`{ slides, startedAt }`), `stop()`. It holds the playlist every screen is playing and the Server's time it started. A changed playlist takes effect at the end of the slide on at that moment (`boundaryAfter`), with `startedAt` = that moment, and `onSwitch` is called then; with nothing on, at once. The same playlist offered again changes nothing; going back to the running one before the switch cancels it. Kept in memory: after a restart the playlist starts again from its first slide.
- **Uses:** `shared/slideTimeline.mjs` (loaded with `require`, which Node 20.19+ allows for ES modules).
- **Used by:** realtime/displaySocket.js; tested by `server/test/playlistTimeline.test.js`.

**`services/audioPlaylist.js`**
- **Purpose:** `buildAudio({ event })` → the `audio:update` payload (§3.4): the published audio shows with at least one ready track, each as the engine takes it, the slideshows whose audio show is among them, and `event` (the given event's show, if it is among them).
- **Uses:** audioShowStore, slideshowStore, pathHelpers (`audioUrl`).
- **Used by:** realtime/displaySocket.js (which adds each show's `startedAt` and `after` through audioTimeline).

**`services/audioTimeline.js`** (since 0.7.0, §18.8)
- **Purpose:** `createAudioTimeline({ onSwitch, now, timers })` → `offer(shows, event)`, `current()` (each show with `startedAt` and `after`), `stop()`. Every audio show plays all the time on its own timeline, like a radio. A show seen for the first time starts then, from its first track. A change to its tracks, order, transition or fade takes effect when the track on at that moment ends (the show is sent as it was until then), and the new timeline starts there, after that track; the volume changes at once. An event starting: its show starts a new track then. An event ending: every other show starts again then, with the track after the one it was playing when the event began (the owner's "afterwards, the next track", §18.3). Kept in memory: after a restart every show starts again from its first track.
- **Uses:** `shared/musicTimeline.mjs`.
- **Used by:** realtime/displaySocket.js; tested by `server/test/audioTimeline.test.js`.

**`services/displayEvents.js`**
- **Purpose:** the explicit channel to the displays: `playlistChanged()`, `displaySettingsChanged()`, `audioChanged()`, and `onPlaylistChanged(fn)` / `onDisplaySettingsChanged(fn)` / `onAudioChanged(fn)` for displaySocket.
- **Used by:** slideshows.js, slides.js, tracks.js, settings/logo.js, uploadQueue; displaySocket listens.

**`services/contentReset.js`**
- **Purpose:** `deleteAllContent()` → `{ deleted: [names], deletedAudio: [names] }`: every audio show (`audioShowStore.removeMany`, in one config write with every slideshow's `audioShow` removed; skipped when there are none, so the slideshows' entries stay as they are), then every slideshow but the sample (`store.removeMany`: one config write, then the folders), then `displayEvents.playlistChanged()` (the audio reaches the screens through the config change). `requestRestore(by)`: the marker, the status and the `restore-defaults` request (D42). `applyPendingRestore()` (start-up): the reset itself. `KEPT_DATA`: `update-branch.env`, `installer.json`.
- **Uses:** slideshowStore, audioShowStore, slideshowRules (`isSample`), displayEvents, services/updates (`updaterReady`, `updateFiles.saveRestoreRequest`), pathHelpers, logger. **Used by:** settings/maintenance.js, server/index.js.

**`services/actionTokens.js`**
- **Purpose:** the one-time proof that the admin password was checked (D40): `issue(action, subject)`, `take(token, action, subject)` (5 minutes, one use, that action and subject only). Actions: `switch` (the branch as subject), `delete-all`, `restore-defaults`.
- **Used by:** services/updates (`issueToken`, `takeToken`), settings/maintenance.js.

**`services/slideshowRules.js`**
- **Purpose:** `parseSlideSeconds` (1–3600, from the contract), `applyHiddenRule(before, updated)` (409 when hiding a published slideshow or publishing a hidden one; `hidden` stored only when true), `parseAudioShow(value)` (an existing audio show's folder, or null for none), `parseVideoSound(slide, body)` (videos only; the contract's choices and limits; off → `{ sound: false }`), `isSample(folder)`, `SAMPLE_DELETE_ERROR`.
- **Uses:** configService, audioShowStore. **Used by:** slideshows.js, slides.js (the sound route), settingsService (the default duration).

**`services/settingsService.js`**
- **Purpose:** `publicSettings()` (config without `passwordHash`, `jwtSecret` and `_comment`) and `applyPatch(body)`: only `port`, `macFiltering` and `display`; display merged and checked (`mergeDisplay`: the duration's range, and `backgroundColor` as `#` and six hex digits, saved in lower case); `port` checked (`parsePort`: a whole number from 1024 to 65535, the contract's `limits.port`; since 0.6.5), `macFiltering` checked and merged (`mergeMacFiltering`: `enabled` a boolean; `approved` the whole list, MACs normalised to lower case with colons and well formed, no duplicates, labels trimmed, the Server's own `localhost` entry always kept; only the fields sent change; since 0.6.10); one `configService.update`. It returns `{ settings, keys }` or `{ status: 400, error }`.
- **Used by:** settings/general.js.

**`services/updates/`**
- **`index.js`:** `getInfo`, `versionInfo`, `getNotice`/`dismissNotice`, `installerStatus`, `listBranches`, `checkBranch` (+ `requirementsOf`), `requestSwitch`, `setSchedule`, `setInstallAt`, `installNow`, `waitingUpdate`, `manualUpdateWaiting`; re-exports `validBranchName`, `issueToken` and `takeToken`. Errors for the admin carry `expose`. Used by settings/updates.js.
- **`git.js`:** `git(args, timeout)` in ROOT, never prompting.
- **`branchName.js`:** `validBranchName`, the JS twin of `installers/lib/branch.sh` `valid_branch` (kept in step by `tests/installers/branch-names.sh`).
- **`updateFiles.js`:** the one owner of the files shared with update.sh: `readBranchSetting`, `readStatus`/`readCheck`/`readNotice`, `deleteNotice`, `requestPending`, `unitsEnabled`, `readSchedule`/`saveSchedule`/`saveInstallAt` (`update-schedule.env`), `requestRun` (`check` or `install-now`), `saveInstallNow`, `saveSwitch` (the three writes in order, restored on failure).
- **`schedule.js`:** `EVERY`, `DEFAULT`, `parseSchedule`, `parseInstallAt` (a valid schedule and set time; the rules for when to install are only in lib/schedule.sh, D41).
- **`installerVersion.js`:** `installedVersion` (record, else the kiosk-script heuristic), `installerNeeds`, `status`. Also used by server/test/installer.test.js.

### 12.5 Utilities

**`utils/pathHelpers.js`**
- **Purpose:** every path under ROOT (the repository folder).
- **Built apps:** `displayDistDir()` and `adminDistDir()` are the only definitions of those paths.
- **Used by:** almost every server module.

**`utils/configIO.js`**
- **Purpose:** `readConfig` (JSON5), `writeConfig` (atomic pretty JSON, temporary file `.tmp`), `writeFileAtomic` (any text, temporary file `.<pid>.tmp` by default), `readJsonFile` (plain JSON or null).
- **Used by:** configService, slideshowStore, updates/updateFiles, updates/installerVersion, and **install.sh and update.sh** (the port, via `node -e`).

**`utils/logger.js`**
- **Purpose:** the winston logger. Creates `logs/` when first required. JSON lines to the console (the journal on an installed Server) and to `logs/app.log`; info and above, or debug too with `NOTICEBOARD_LOG_LEVEL=debug`.

**`utils/macLookup.js`**
- **Purpose:** `isLocalhost` ("the Server itself" for MAC filtering: the set `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`, **empty string**, kept on purpose: §14 D6) and `lookupMac` (node-arp, lower-cased).
- **Uses:** `network.plainAddress`.

**`utils/network.js`**
- **Purpose:** `plainAddress` (strips `::ffff:`), `isLoopback` (127.0.0.0/8, `::1`, `::ffff:127.x`: the kiosk-exit rule), `lanInterfaces()` (non-internal IPv4 interfaces with their MACs).
- **Used by:** device.js, settings/general.js, macLookup, macService.

**`utils/slugify.js`**
- **Purpose:** `slugify(name, fallback)`, and `uniqueSlug(name, { dir, fallback })`, which checks folder existence under `dir` (`data/slideshows` by default).

**`utils/folderLock.js`**
- **Purpose:** `withFolderLock(key, fn)`, a per-key promise chain. Only showStore uses it (keys `<kind>:<folder>`).

**`utils/displayBuildId.js`**
- **Purpose:** a hash of the built display `index.html`.

**`utils/systemCheck.js`**
- **Purpose:** `checkRequirements`, `satisfies`, `describe`, `parseVersion`. Runs only safe commands and arguments.

### 12.6 Viewer (`client/display`)

| File | Purpose | Uses | Notes |
|---|---|---|---|
| `index.html`, `main.js` | mount | App.vue | inline base styles (duplicated in App.vue's `<style>`) |
| `App.vue` | composition, `?kiosk=off`, idle cursor, the background colour (`--nb-background`), the slideshow on air for the background audio | useSocket, useActivity, recovery, the six components | |
| `composables/useSocket.js` | socket.io client; playlist, settings, background audio, build reload; the time exchanges and `serverNow` (`?debugClockOffset` for tests) | `@shared` SOCKET_EVENTS, recovery | `'connect'`/`'disconnect'` are socket.io built-ins |
| `serverClock.js` | the Server's time as this screen can best tell it: offsets from time:ping/pong exchanges, the shortest round trip winning; `window.noticeboardClock()` | none | tested by `client/display/test/serverClock.test.mjs` |
| `composables/useActivity.js` | activity with real mouse moves; idle after 3 s | none | |
| `recovery.js` | `reloadWhenServerUp`, `reloadSoon`, `recoverByReloading`, `startDailyReload` | sessionStorage | |
| `slideshowClock.js` | all slide timing, on the shared timeline and the Server's clock (pure, injectable timers and clock) | `shared/slideTimeline.mjs` | tested by `client/display/test/slideshowClock.test.mjs` |
| `composables/usePageWake.js` | `usePageWake(callback, { online })`: visibilitychange, resume, pageshow, focus (and online) | none | |
| `components/BackgroundAudio.vue` | the audio show of the slideshow on air, through the engine, on the Server's time (`serverNow`); lowered (`duck`) or paused while a video plays its own sound; tries refused sound again on a click or key press; `window.noticeboardAudio()` (the state and its audio elements) | `@shared/audioPlayer.mjs` | no markup |
| `components/AudioDebug.vue` | with `?debug=audio`: a read-only panel of the engine's state, each audio element (file, playing, volume, time) and the video on screen, twice a second, for checking sound on a real screen | `window.noticeboardAudio` | since 0.6.14 |
| `components/SlideShow.vue` | layers, fade, page lifecycle → `clock.resume`; emits `on-air` (the slide shown); gives each layer where to start and its slot's start (`offset`, `slotStart`) | SlideFrame, clock, recovery, usePageWake (with online) | props `startedAt`, `serverNow` |
| `components/SlideFrame.vue` | image or video (with its `sound`) with the generation tag | ImageSlide, VideoSlide | |
| `components/ImageSlide.vue` | `<img>`, `object-fit: contain` (`src` only; the clock decides how long it shows) | none | |
| `components/VideoSlide.vue` | `<video>` autoplay, muted unless it has `sound` (then aloud, or muted if the browser refuses, so it still plays), `object-fit: contain`; plays again when the page wakes; starts at `offset`, and is put back if more than `DRIFT_S` (0.5 s) from the timeline (checked every 2 s) | usePageWake (without online) | |
| `components/WaitingScreen.vue` | dot or logo + "No slideshow published" | none | |
| `components/CornerButton.vue` | the faint round button in a top corner (`corner`, `opacity`, `hoverOpacity`; icon in the slot) | none | |
| `components/ScreenDialog.vue` | the dark centred card for pop-ups | none | |
| `components/DeviceInfo.vue` | pin (top left, 0.3 → 0.8) and pop-up: the server's addresses and port, and the viewer's URL (never the admin panel's); `GET /api/device` | CornerButton, ScreenDialog | its own 90 s auto-close timer |
| `components/AdminWarning.vue` | the warning mark (bottom right, 20 px, red) and its one-line message, while the installer needs running again, a manual update waits, or the Server needs a restart | ScreenDialog | its own 60 s auto-close timer |
| `components/ExitKiosk.vue` | exit button (top right, 0.5 → 0.9), confirm; `POST /api/device/kiosk-exit` | CornerButton, ScreenDialog | its own 60 s auto-close timer |

### 12.7 Admin (`client/admin`)

| File | Purpose | Uses | Notes |
|---|---|---|---|
| `main.js`, `router/index.js` | imports `styles/base.css`; mount after the router is ready; routes; login check (`api.get('/auth/status', { redirectOn401: false })`, never redirects by itself) | Vue Router, useApi | |
| `styles/base.css` | the global styles: CSS variables, layout, buttons, cards, fields, messages, badges, the page warnings' box (`.page-warning`), and the confirmation dialogs' texts (`.danger-dialog`: paragraphs, `.warnings`, `.choices`, `.tone-warn`, `.actions`) | none | |
| `App.vue` | the layout: the sidebar, the warnings and the updater's notices (every page but the login page), then the page | NavBar, DefaultPasswordWarning, UpdateNotice, InstallerNotice, UpdateAvailableNotice, useNav | |
| `composables/useApi.js` | one `request` core behind `api.get/post/put/patch/del/upload`; a 401 → the login page, unless `redirectOn401: false` (then thrown like any error); errors carry `status` and `serverMessage` | none | |
| `composables/useShowActions.js` | `useShowActions(base)` (`/slideshows` or `/audioshows`): `setEnabled`, `setHidden` (errors shown in an alert) with `toggling` / `hiding` busy state | useApi | |
| `composables/useItemList.js` | `useItemList({ items, path, busy })`: a show's item list: `load`, `upload` (with `fileInput`, `uploading`, `uploadErr`, `uploadCount`), reloading every 2 s while processing, `remove` (asks, naming it), `move` (a failure: `moveErr`, and the list loaded again), `stop` | useApi, `@shared` mediaDisplayName | used by SlideList, TrackList |
| `composables/useRename.js` | `useRename({ items, path })` → `{ renaming, renameInput, startRename, cancelRename, saveRename }`: renaming an item of a list in place (D38) | useApi | used by SlideList |
| `composables/useFlash.js` | a reactive `{ text, tone, ok(text, clearAfterMs), error(text), clear() }` for "Saved." and error messages; each new message cancels the previous one's timer, an error stays until dismissed or replaced (since 0.6.12) | none | FlashMessage shows it, with a ✕ on an error |
| `composables/useUpdateInfo.js` | the Software updates data: `GET /settings/updates` and `/branches`, polling every 3 s while an update runs or the server restarts, reloading the page when another version runs; helpers `short`, `when`, `runningName`, `canSwitch`, `missingSoftware` | useApi | |
| `composables/useBranding.js`, `useSecurity.js`, `useNav.js` | shared singleton state | useApi / localStorage | |
| `composables/useCollapsed.js` | `useCollapsed(name)` → `{ collapsed }`: which cards are folded, one list shared by every card, in `localStorage` (unreadable → every card open) | localStorage | |
| `components/ui/CollapsibleCard.vue` | a section card that folds to its title: props `title`, `name`, `attention` (open and not foldable while true); slots: the body (kept mounted while folded) and `actions` (hidden while folded); attributes go to the card | useCollapsed | used by the six Settings cards, SlideshowSettingsCard and SlideList |
| `views/LoginView.vue` | login form: a wrong password or "too many tries" shown on the page, "Could not reach server" without an answer | useApi | |
| `views/SlideshowsView.vue` | home: device banner, list, create, publish, hide, delete | useApi, useShowActions, StatusBadge, PublishToggle, TagPill | |
| `views/AudioShowsView.vue` | the audio shows: list with each one's summary (and its event: playing now, or when next), create (opens it), publish, delete | useApi, useShowActions, StatusBadge, PublishToggle | |
| `views/AudioShowDetailView.vue` | one audio show (404 → the list): its settings card, the show preview, the event audio card and the track list | useApi, AudioShowSettingsCard, ShowPreview, AudioEventCard, TrackList, StatusBadge | |
| `components/audio/AudioEventCard.vue` | the event and its state (playing now, next, ended; a warning when unpublished or without a ready track), Stop for one started by hand, the form (Off, Start now, Once, Repeat), the clash message | useApi, useFlash, CollapsibleCard, FlashMessage, WeeklyTimesEditor | |
| `components/audio/AudioShowSettingsCard.vue` | the settings at a glance, publish, the edit form (name, order, transition, fade length, volume) | useApi, useShowActions, useFlash, FlashMessage, CollapsibleCard, StatusBadge, PublishToggle, `@shared` AUDIO | |
| `components/audio/ShowPreview.vue` | "Preview the show": plays the show (saved settings, ready tracks) in the browser with the screens' engine; ⏭ Next track, ■ Stop, the track playing, "Try again" if the browser refuses sound; follows changes while playing (a new volume at once; a change to the tracks, order, transition or fade starts its next track), stops when the page is left; its timeline starts when ▶ is pressed | `@shared/audioPlayer.mjs`, `@shared` audioUrl, mediaDisplayName | |
| `components/audio/TrackList.vue` | upload, rows (▶/■ to listen at the show's volume, name with ✎, length, file, status), reorder, delete | useItemList, useRename, CollapsibleCard, `@shared` audioUrl, mediaDisplayName, LIMITS | |
| `views/SlideshowDetailView.vue` | loads the default duration, the slideshow (404 → the list) and its slides; the header with its tags; the disabled banner | useApi, SlideshowSettingsCard, SlideList, TagPill | |
| `views/SettingsView.vue` | loads `GET /settings` once for the Display and MAC cards; the cards in order (Display, MAC filtering, Branding, Change password, Software updates, Delete content) | useApi, the settings and updates cards | |
| `components/slideshow/SlideshowSettingsCard.vue` | the settings facts, publish/disable, hide/unhide, the edit form (name, priority, duration, schedule, background audio: the published audio shows, and the current one marked if it has been unpublished) | useApi, useShowActions, useFlash, ScheduleEditor, StatusBadge, PublishToggle, FlashMessage, `@shared` LIMITS | |
| `components/slideshow/ScheduleEditor.vue` | always/timed, times, days (v-model; two fields, no wrapper) | WeeklyTimesEditor | |
| `components/ui/WeeklyTimesEditor.vue` | start and end time and the days of the week (v-model, edited in place; `daysLabel`) | none | used by ScheduleEditor and AudioEventCard |
| `components/slideshow/SlideList.vue` | upload, rows (name, then type and stored file name), rename (✎: Enter or leaving the field saves, Esc cancels), reorder, delete (the question names the slide), missing thumbnails, polling while processing, preview (hover or pinned), each video's sound (VideoSoundControl) | useApi, SlidePreview, VideoSoundControl, `@shared` mediaUrl, mediaDisplayName, LIMITS | |
| `components/slideshow/VideoSoundControl.vue` | a video's Sound switch and, while on, the background audio meanwhile (lowered to a % or paused); saved at once | useApi, `@shared` AUDIO | |
| `components/slideshow/SlidePreview.vue` | hover or pinned preview, titled with the slide's name | `@shared` mediaUrl, mediaDisplayName | |
| `components/settings/DisplaySettingsCard.vue` (the duration, the pin, the video format explained, with its warning, and converting the existing videos with its warning and progress), `MacFilterCard.vue` (with `MacFilterWarning`), `PasswordCard.vue`, `BrandingSettings.vue` (the logo, and the background colour: a colour picker and a code field kept in step) | one Settings card each | useApi, useFlash, FlashMessage; `@shared` LIMITS (duration, password), VIDEO_FORMATS and DEFAULT_VIDEO_FORMAT (display), DEFAULT_BACKGROUND and isColour (branding); useSecurity (password); useBranding (logo) | |
| `components/NavBar.vue` | sidebar (Slideshows, Audio, Settings, Help, Open viewer) | useApi, useBranding, useNav, NavIcon, `@shared` PROJECT_URL | |
| `components/NavIcon.vue` | inline SVG icons | none | |
| `components/DefaultPasswordWarning.vue` | red banner | useSecurity | |
| `components/updates/UpdateNotice.vue` | dismissable updater notice (in the layout: every page) | useApi | |
| `components/settings/ConfigRecoveryNotice.vue` | the "settings file couldn't be read" box (every page) while `data/config-recovery.json` exists: which file was kept, whether the last good copy was restored or the defaults used, "I've dealt with it" | useApi | |
| `components/settings/RestartNotice.vue` | the "Restart the Server" box (every page, `.page-warning`) while a saved port isn't in use yet: what changes, what the Clients and the firewall need; "Restart the Server now…" (password and last chance), then waits for the Server on its new port and moves the page there | useApi, useRestartState, ConfirmDangerDialogs | |
| `components/settings/ServerPortCard.vue` | Settings → Port: the port, checked as the server checks it, and what a change needs | useApi, useFlash, useRestartState, FlashMessage, CollapsibleCard, `@shared` LIMITS | |
| `composables/useRestartState.js` | `useRestartState()` → `{ state, refresh }`: GET /settings/maintenance/restart, one copy for the whole admin panel | useApi | used by RestartNotice, ServerPortCard |
| `components/updates/InstallerNotice.vue` | run-the-installer box (in the layout: every page; the box is `.page-warning`) | useApi, `@shared` installerCommand | |
| `components/updates/UpdateAvailableNotice.vue` | "Update available" with manual updates (in the layout: every page, nothing to close), linking to `/settings#updates` | useApi | |
| `components/updates/UpdateSchedule.vue` | in the Software updates card: the waiting version (Update now, Set a time, or the automatic install's time) and the schedule form | useApi, useFlash, FlashMessage, useUpdateInfo helpers | |
| `components/updates/SoftwareUpdates.vue` | the card (`id="updates"`): puts the parts together, shows the outcome of the last attempt; open while an update runs, went wrong, or (manual) waits | useUpdateInfo, UpdateStatus, UpdateSchedule, BranchSwitcher, SwitchDialogs, CollapsibleCard | |
| `components/updates/UpdateStatus.vue` | the facts (running, updates and the schedule, last check, last update) and the progress box | useUpdateInfo helpers | |
| `components/updates/BranchSwitcher.vue` | branch name, Check branch, the result with the software and installer panels, "Switch to …" | useApi, useUpdateInfo helpers | |
| `components/updates/SwitchDialogs.vue` | Missing software (its own ModalDialog), then the shared steps with the switch's texts (ids `switch-…`) | useApi, ModalDialog, ConfirmDangerDialogs, useUpdateInfo helpers | |
| `components/settings/DeleteContentCard.vue` | the "Delete content" card: Delete All… (loads the slideshows and audio shows; nothing but the sample → says so), the warning listing each slideshow and its slides and each audio show and its tracks; Restore Defaults… (needs the updater), the warning listing what is reset and kept with the installer command; the shared steps; then "Restoring defaults…" until the server is back, and the login page | useApi, useFlash, FlashMessage, CollapsibleCard, ConfirmDangerDialogs | |
| `components/ui/ConfirmDangerDialogs.vue` | the shared confirmation steps (D40): warnings and the admin password (`verify(password)` → token), then the last chance (`confirm(token)`); focus, Esc, no cancelling while an answer is on its way; props `idPrefix`, `title`, `finalTitle`, labels; slots: the first dialog's text, `final` | ModalDialog | used by SwitchDialogs, DeleteContentCard |
| `components/settings/MacFilterWarning.vue` | warning and how-to pop-ups in one ModalDialog (Esc/outside: back from the how-to, else cancel); `GET /settings/my-device` | useApi, ModalDialog | |
| `components/ui/StatusBadge.vue`, `PublishToggle.vue` (`small`, `busy`), `TagPill.vue`, `ModalDialog.vue` (`role`, `labelledby`, `tag`; emits `close` on Esc or outside; attributes go to the card), `FlashMessage.vue` (`flash`, `tag`) | shared pieces | none | |

### 12.8 Shared client code

**`shared/contract.json`** and **`shared/index.js`**
- `contract.json`: `socketEvents`, required by the server (realtime/displaySocket.js) and imported by index.js.
- `contract.json` also has `limits` (`passwordMinLength`, `slideSeconds { min, max }`, `mediaNameMax`), read by adminPassword, slideshowRules and mediaNames, and `display` (`defaultBackground`, `colourPattern`, `videoFormats`, `defaultVideoFormat`), read by settingsService and brandingService.
- `index.js`: `SOCKET_EVENTS` (the viewer), `LIMITS` (the duration inputs, the password card, the slide name field), `DEFAULT_BACKGROUND` (the viewer, the Branding card), `VIDEO_FORMATS`, `DEFAULT_VIDEO_FORMAT` (the Display card), `isColour(value)` (the Branding card), `PROJECT_URL` (NavBar), `installerCommand(branch)` (InstallerNotice), `mediaUrl(folder, file)` (SlideList, SlidePreview; the same as the server's `pathHelpers.mediaUrl`, checked by a unit test), `mediaDisplayName(item)` (SlideList, SlidePreview, TrackList: what an item is called, D38), `AUDIO` (the audio show card), `audioUrl(folder, file)` (TrackList; the same as the server's `pathHelpers.audioUrl`, checked by a unit test).
- **Rule:** public values only (they are built into the browsers' JavaScript).

**`shared/audioPlayer.mjs`** (the audio engine, §18.3, §18.8)
- `createAudioPlayer({ createElement, timers, now, serverNow, onChange })` → `setShow(show | null)`, `next()`, `duck(factor, ms)`, `pause()`, `resume()`, `retryNow()`, `stop()`, `destroy()` (also stops its timers), `state()` (`{ show, track, playing, paused, blocked, duck }`).
- Built like the slide clock: the media elements, timers and clocks are passed in, so it is tested over simulated time (`client/display/test/audioPlayer.test.mjs`). Two elements ("decks") let one track fade out while the next fades in.
- Since 0.7.0 it plays to the show's timeline (`shared/musicTimeline.mjs`) on the Server's time: the track and the point in it come from `musicAt(show, serverNow())`; a timer moves on at each track's slot end and a check every `SYNC_MS` (1 s) keeps it there: more than `DRIFT_SEEK_S` (0.25 s) out, it's put back; more than `DRIFT_EASE_S` (0.04 s), it plays `EASE_RATE` (2 %) faster or slower. Joining a show, or coming back to it, starts where the timeline is now; resuming after a pause does too.
- In order or shuffled (the timeline's order); no transition or a crossfade starting `fadeSeconds` before the end; the show's volume times the duck factor; switching shows uses the new show's transition, no show fades out (`FADE_OUT_MS`).
- A show without `startedAt` (the preview) gets a timeline of its own from the moment it's first given; `next()` starts a new one with the next track; a change to what it plays or when starts its next track.
- Failures: a track that errors stays silent until its slot ends, and the next one starts in step (one try per track, never a busy loop); one that stalls is put back in step; a refused `play()` (NotAllowedError) leaves it silent and tries again every `RETRY_BLOCKED_MS` (a minute), or at once with `retryNow()`, joining the timeline where it is.
- Used by the admin panel's `ShowPreview` and the viewer's `BackgroundAudio`. Its timing is only changed with its tests.

**`shared/musicTimeline.mjs`** (since 0.7.0, §18.8)
- `trackMs(show, i)`, `slotMs(show, i)` (a track's length less the fade with a crossfade, unless it's shorter than two fades; `UNKNOWN_TRACK_SECONDS`, 180, without a length), `sequence(show, round)` (in order starting after `after`; shuffled from a seed of the show, `startedAt` and the round, never the same track twice in a row, nor `after` first; two tracks take turns), `musicAt(show, t)` → `{ track, start, end, round }`.
- The one definition of the music's timeline: the engine and the Server's `audioTimeline` both use it. Tested by `client/display/test/musicTimeline.test.mjs`.

**`shared/slideTimeline.mjs`** (since 0.7.0, §18.8)
- `slotMs(slide)` (an image's duration, a video's length, 10 s when either is missing), `positionAt(slides, startedAt, t)` → `{ index, start, end, round }` (before `startedAt`: the first slide, from `startedAt`), `boundaryAfter(slides, startedAt, t)` (the end of the slide on at `t`); `DEFAULT_IMAGE_SECONDS`, `UNKNOWN_VIDEO_SECONDS`.
- The one definition of the timeline: the viewer's slide clock and the Server's `playlistTimeline` both use it, so they can't disagree. Tested by `client/display/test/slideTimeline.test.mjs`.

### 12.9 Installers

**`installers/install.sh`** (see §8): the configuration (including `INSTALLER_VERSION` and the list of parts), `main()`, the switch to the latest installer (`use_latest_installer`, `run_installer_from`, `use_branch_installer`, `followed_branch`: they run before any part is loaded, so they're in this file; `followed_branch` keeps its simple name check, which only chooses which installer to download) and the loader (`load_modules`, `download_modules`, `load_modules_from`). Each part has the module header described at the top of this document.

| Part | What it has | Used by |
|---|---|---|
| `lib/ui.sh` | `has_tty`, `ask`, `ask_yes_no`, `ask_choice` (the 1/2 questions), `ask_port`, `ask_yes_in_time`, `banner`; `choose_mode`, `choose_branch`, `offer_reboot` | main, sudo, display, server, firewall |
| `lib/branch.sh` | `valid_branch` (the full rule), `read_branch_setting`, `read_main_at_switch`, `write_branch_setting` (atomic) | ui, server, **update.sh** |
| `lib/json.sh` | `write_json`, `json_string` | server (`update-status.json`), **update.sh** |
| `lib/schedule.sh` | `read_schedule`, `now_epoch`, `iso_time`, `to_epoch`, `install_due`, `next_install`, `set_install_at` (D41) | **update.sh only** (not one of `INSTALLER_MODULES`) |
| `lib/system.sh` | `update_system`, `chromium_package`, `node_new_enough`, `lock_install_dir`, `slideshow_port` | server, display, firewall |
| `lib/sudo.sh` | `check_sudo_password` and its helpers, `SUDO_STATUS` | main, the summaries |
| `lib/server.sh` | `install_server`, `fetch_branch`, `save_branch_setting`, `write_service`, `write_update_units`, `write_installer_record` (its own `printf`: `version` is a number), `summary_server` | main |
| `lib/display.sh` | `install_display`, `collect_macs_html`, `ask_server_url`, `summary_display` | main |
| `lib/kiosk.sh` | `write_server_kiosk` (the template as it is), `write_display_kiosk` (the template with `SERVER_URL` and `MACS_HTML` filled in) | server, display |
| `lib/desktop.sh` | `write_autostart`, `write_help_shortcut` | server, display |
| `lib/firewall.sh` | `check_firewall`, `setup_ufw`, the detection helpers, `firewall_reminder` | main |
| `kiosk/server.sh`, `kiosk/display.sh` | the two kiosk scripts exactly as installed (display: empty `SERVER_URL=""` and `MACS_HTML=""` lines to fill in) | kiosk.sh |

**`installers/update.sh`:** see §9.1.

### 12.10 Other files

| File | Role |
|---|---|
| `system-requirements.json` | Read by services/updates (at the target commit, and installerVersion at ROOT) and server/test. The README states the `installer.version` ↔ `INSTALLER_VERSION` rule. |
| `sample-data/…` | Read by sampleSlideshow and brandingService (placeholder logo). |
| `noticeboard-guide.html` | Served at `/admin/help`; the Help shortcut opens it with `file://`. Its anchors (`#installer-needed`, `#settings`, …) are linked from the admin panel. |
| `package.json` (root) | workspaces; `build` (display, then admin), `start`, `test` and the `test:*` groups; **used by install.sh and update.sh** (`npm install`, `run build`, `prune`). |
| `server/package.json`, `client/*/package.json` | workspace dependencies; the apps' `build` scripts. |
| `client/*/vite.config.js` | the `@shared` alias; `base` (`/` and `/admin/`). |
| `.env.example` | what `/opt/noticeboard/.env` can hold (`SECURE_COOKIES`, `NOTICEBOARD_LOG_LEVEL`). |

---

## 13. Important functions: relationships and change impact

| Function | Location | Callers | Calls | Reads | Writes / side effects | If it changes… |
|---|---|---|---|---|---|---|
| `configService.init` | services/configService.js | index.js, **install.sh** | configIO, bcrypt, crypto | config.json | creates `data/`, `data/slideshows/`, and config.json (or regenerates it on a parse error) | install.sh first run; every server start |
| `configService.set/update` | same | slideshowStore, settingsService, adminPassword | writeConfig | none | writes the whole config; emits `'change'` → scheduler recompute and display settings broadcast | playlists and display settings broadcasts; the persistence format |
| `schedulerService.computeActive` | services/schedulerService.js | interval, config change, init | `_matchesSchedule` | config.slideshows | emits `'update'` when the folder list changes | which slideshows air; playlist broadcasts |
| `buildPlaylist` | services/playlistService.js | displaySocket (broadcast, `display:ready`) | slideshowStore, pathHelpers | config, slideshow.json (via the store) | none | **the viewer contract** (`{ slides: [{ type, url, duration, slideshow, length? }] }`: keys may only be added); the clock's change detection (JSON signature) |
| `broadcastPlaylist` (inside displaySocket) | realtime/displaySocket.js | scheduler `'update'`, `displayEvents.playlistChanged` (slideshows PUT, slide DELETE/reorder, uploadQueue) | buildPlaylist, io.emit | as above | socket emit | every display |
| `broadcastDisplaySettings` (inside displaySocket) | realtime/displaySocket.js | config `'change'`, `displayEvents.displaySettingsChanged` (logo), the installer and update state (every 5 minutes, and when a display connects) | services/displaySettings (`current`, `refresh`) | config, logo mtime, installer.json, update-check.json, update-schedule.env | socket emit (deduplicated) | pin and logo on the displays |
| `macService.resolveRequest` | services/macService.js | macFilter, adminAuth | macLookup, isMacApproved | config.macFiltering, ARP | none | who can reach anything; `/settings/my-device` via `req.clientMac` |
| `store.modifySlides` | services/slideshowStore.js | mediaItems (4×), slides.js (thumbnails), uploadQueue.updateSlide, sampleSlideshow.replaceSlides, videoConversion | withFolderLock, readSlides, writeConfig | slideshow.json | writes it only when changed | every change to a slideshow's slides; the lock prevents lost writes |
| `writeConfig` | utils/configIO.js | configService, slideshowStore | fs | none | atomic JSON write (`.tmp` + rename) | every persisted JSON written by Node |
| `enqueueProcessing` | services/uploadQueue.js | slides.js POST | mediaService, updateSlide (store.modifySlides), displayEvents.playlistChanged | tmp upload | media file, slideshow.json, deletes the tmp file | upload pipeline; update.sh's upload-wait |
| `syncSampleSlideshow` | services/sampleSlideshow.js | index.js | uniqueSlug, replaceSlides (store.modifySlides), store.commitEntries, enqueueThumbnail | sample-data, config | copies files, writes slideshow.json and config | sample behaviour after every update |
| `requestSwitch` | services/updates/index.js | settings/updates.js | getInfo, checkBranch, updateFiles.saveSwitch | systemd dir, files | writes the branch file, status, request (→ systemd path unit → update.sh) | **the contract with update.sh** |
| `checkBranch` | same | settings/updates.js, requestSwitch | git, requirementsOf | git objects | fetches a remote-tracking branch | the switch checks shown to the admin |
| `installerVersion.installedVersion` / `installerNeeds` | services/updates/installerVersion.js | installerStatus, requirementsOf, test | configIO.readJsonFile, fs | installer.json, start-kiosk.sh, system-requirements.json | none | the home page installer box, switch warning |
| `versionInfo` | services/updates/index.js | settings/updates.js `/version` | git, updateFiles.readStatus | HEAD, update-status.json | none | sidebar "Last updated" |
| `adminPassword.usesDefault` | services/adminPassword.js | settings/security.js `/security` | bcrypt | config.passwordHash | cache | the default-password banner |
| `requireApprovedDevice` / `requireAdmin` | middleware/access.js | every route (via macFilter/adminAuth) | macService, adminSession | config.macFiltering, ARP, the cookie | 404 / 401 responses, logs | **who can reach anything**; the 404 and 401 conventions other programs rely on |
| `displaySettings.current` / `refresh` | services/displaySettings.js | realtime/displaySocket.js | brandingService, configService, installerVersion.status | config.display, logo mtime, installer.json, system-requirements.json | none | the `display:settings` payload (open screens: keys may only be added) |
| `createSlideshowClock` | client/display/src/slideshowClock.js | SlideShow.vue, tests | slideTimeline, injected timers and clock | none | none | all viewer timing (tested) |
| `positionAt` / `boundaryAfter` | shared/slideTimeline.mjs | slideshowClock, playlistTimeline, tests | none | none | none | **every screen in step**: the viewer and the Server must read the timeline the same way |
| `createPlaylistTimeline` | server/services/playlistTimeline.js | displaySocket, tests | slideTimeline, injected timers and clock | none | `playlist:update` at the switch | when every screen switches playlist, and its `startedAt` |
| `createAudioPlayer` | shared/audioPlayer.mjs | ShowPreview.vue, BackgroundAudio.vue, tests | musicTimeline, injected media elements, timers and clocks | none | none | all audio timing: the timeline, crossfades, switching, drift, failures (tested) |
| `musicAt` / `sequence` | shared/musicTimeline.mjs | audioPlayer, audioTimeline, tests | none | none | none | **the music in step**: the engine and the Server must read the timeline the same way |
| `createAudioTimeline` | server/services/audioTimeline.js | displaySocket, tests | musicTimeline, injected timers and clock | none | `audio:update` when a change takes effect | each show's `startedAt` and `after`: when every screen changes track |
| `useApi.request` | client/admin/src/composables/useApi.js | every admin component | fetch | none | redirects to login on 401 | every admin call; the 401-vs-403 convention |
| `run_installer_from` / `use_latest_installer` | install.sh | main, use_branch_installer | curl, bash -n, exec | update-branch.env | exec replaces the process | which installer version runs (and what older installers accept: a line starting `INSTALLER_VERSION=`) |
| `install_server` | installers/lib/server.sh | main | many | several | the whole server set-up | installations |
| `install_commit` / `restart_server` | update.sh | main | git, npm, kill, curl | config port | the code on disk, restart | every automatic update |
| `branch_merged` | update.sh | main | git fetch, ls-remote, merge-base, merge-tree | update-branch.env | none | auto-return to main |
| `install_due` / `next_install` | installers/lib/schedule.sh | update.sh | date | update-schedule.env, update-check.json | none | when every Server installs updates; what the admin panel says about it |

---

## 14. Shared and duplicated behaviour

Behaviour that more than one part needs, and where it lives. Most of it has one owner; where two copies remain, the entry says why and how they're kept equal.

| # | Behaviour | Where it lives | Notes |
|---|---|---|---|
| D1 | Read `slideshow.json` (and any show's JSON file) | `slideshowStore.readSlides` (`showStore.readItems`), the only reader | A missing or unparseable file, or one without a slides list, gives no slides; other keys are kept. |
| D2 | Write `slideshow.json` (and any show's JSON file) | `slideshowStore` (`create`, `modifySlides`), i.e. `showStore`, atomic | `modifySlides` is locked per slideshow and writes only when something changed. |
| D3 | The slideshow entries in `config.slideshows` | `slideshowStore` (`list`, `find`, and the writes) | |
| D4 | Slide duration rule (whole seconds, 1–3600) | `shared/contract.json` `limits.slideSeconds`: the server checks it (`slideshowRules.parseSlideSeconds`), the admin inputs use it (`LIMITS`) | `null` is allowed only for a slideshow's own duration (use the default). |
| D5 | Image duration fallback, 10 s | `config/defaults.js` (a new config), playlistService (`?? 10`), `shared/slideTimeline.mjs` (`DEFAULT_IMAGE_SECONDS`, for the viewer and the Server's timeline), the admin panel (`?? 10` until the settings arrive) | Only fallbacks: the saved setting always wins. |
| D6 | "This device itself" | `macLookup.isLocalhost` (the MAC filter) and `network.isLoopback` (the kiosk exit) | **Different on purpose.** The MAC filter accepts exactly `127.0.0.1`, `::1`, `::ffff:127.0.0.1` and `localhost` (since 0.6.4 not an empty address: while MAC filtering is on, a request whose address can't be told is refused); the kiosk exit accepts the whole 127.0.0.0/8 range and `::1`, never an empty address. |
| D7 | Strip `::ffff:` from an address | `network.plainAddress` | |
| D8 | MAC filter check and deny | `middleware/access.js` | Logs `<area>: MAC denied` (Display or Admin). |
| D9 | Verify the admin password | `adminPassword.verify` | Each caller keeps its status on purpose: login 401; password change and the branch-switch check 403 (a 401 would send the admin panel to the login page). |
| D10 | The default password | `config/passwordDefaults.js` | Also written, for people, in the installer's summary, the README and the guide. |
| D11 | Session cookie and JWT | `services/adminSession.js` | |
| D12 | Password minimum length (8) | `shared/contract.json` `limits.passwordMinLength` (adminPassword, PasswordCard) | |
| D13 | Where uploads wait: `tmp/noticeboard-uploads` | `middleware/uploads.js` `createUpload` | Slides (`upload-…`, 500 MB each) and the logo (`logo-…`, 20 MB). update.sh waits while the folder has a recent file. |
| D14 | Media type lists | `services/mediaTypes.js` | The lists overlap without being identical: slide images and videos, logo images, the extensions `/media` serves (including audio), the sample's file names. The admin panel's file pickers use broad `accept` lists; the server decides. |
| D15 | Media URLs `/media/<folder>/slides/<file>` and `/audio/<folder>/tracks/<file>` | `pathHelpers.mediaUrl`, `audioUrl` (server) and `mediaUrl`, `audioUrl` in `shared/index.js` (admin panel) | A unit test keeps them equal. |
| D16 | Where the built apps are | `pathHelpers.displayDistDir`, `adminDistDir` | |
| D17 | Serving an app for every path, or the "not built" page | `routes/spa.js` | |
| D18 | Socket event names | `shared/contract.json` | |
| D19 | Page wake-up events (visibility, resume, pageshow, focus, online) | `usePageWake` | SlideShow listens to `online` too; VideoSlide doesn't. |
| D20 | Corner buttons and their pop-ups | `CornerButton`, `ScreenDialog` | The pin and the exit button keep their own opacity (0.3 / 0.5) and auto-close (90 s / 60 s). |
| D21 | Published badge, publish toggle, tags, publish and hide | `StatusBadge`, `PublishToggle`, `TagPill`, `useShowActions` | Used by SlideshowsView, SlideshowSettingsCard, AudioShowsView and AudioShowSettingsCard. |
| D22 | Pop-up dialogs (overlay, Esc, click outside) | `ModalDialog` | Used by MacFilterWarning and SwitchDialogs. SlidePreview has its own lighter overlay: it's a hover preview. |
| D23 | "Saved." and error messages | `useFlash` + `FlashMessage` | The caller sets the tone. |
| D24 | API calls and a 401 | `useApi` `request` | The login check and LoginView pass `redirectOn401: false`. |
| D25 | Read the branch setting | `lib/branch.sh` `read_branch_setting` (install.sh's parts, update.sh), `updateFiles.readBranchSetting` (server) | install.sh's `followed_branch` reads it too, because it runs before the parts are loaded. |
| D26 | Branch-name rule | `lib/branch.sh` `valid_branch` and `updates/branchName.validBranchName` | Two copies (bash and JavaScript), kept equal by `tests/installers/branch-names.sh`. `followed_branch` has only a simple check: it just chooses which installer to download, and a bad name gives main's. |
| D27 | The update status file | `lib/json.sh` `write_json` (install.sh, update.sh), `updateFiles` (server, JSON.stringify) | `installer.json` is written with `printf`, because its version is a number. |
| D28 | The port in config.json | `configIO.readConfig`, used through small wrappers: `slideshow_port` (lib/system.sh), update.sh's `server_port`, server/index.js | update.sh has its own two-line wrapper so the update path loads as little as possible. |
| D29 | Node.js version rule | `lib/system.sh` `node_new_enough` and `system-requirements.json` | Two copies because the installer checks Node.js before the repository exists; a unit test keeps them equal (20.19+ on 20, 22.12+, or 23+). |
| D30 | The kiosk scripts | `installers/kiosk/server.sh`, `display.sh` | Each script has its own copy of the common parts (browser detection, flags, `xset`, the exit check, the restart loop), because they are installed exactly as written. Sharing them would change the installed scripts: a change for its own `INSTALLER_VERSION`. |
| D31 | Yes/no and 1/2 questions | `lib/ui.sh` `ask_yes_no`, `ask_choice` | |
| D32 | The installer's boxed headings | `lib/ui.sh` `banner` | |
| D33 | Reading and writing JSON files | `configIO`: `readJsonFile`, `writeFileAtomic` (temporary file `.<pid>.tmp`), `writeConfig` (`.tmp`) | |
| D34 | An update that never finished (60 min) | `services/updates` (`busy`) | UpdateStatus shows "Didn't finish" from the server's `busy`. |
| D35 | Telling the displays what changed | `services/displayEvents.js` | `configService 'change'` means only that config.json changed. |
| D36 | Async route handlers and their errors | `middleware/asyncRoute.js` (`route`, `jsonRoute`) | |
| D37 | The background colour's default and form; the video formats and their default | `shared/contract.json` `display` (`defaultBackground`, `colourPattern`, `videoFormats`, `defaultVideoFormat`) | Read by settingsService (checks a new colour or format; `videoFormat()`), brandingService (sends the colour) and, through `shared/index.js`, the viewer, the Branding card and the Display card. |
| D38 | Media names: the rule, and what the admin panel shows | `services/mediaNames.js` (the rule: trimmed, no control characters, at most `limits.mediaNameMax`); `mediaDisplayName` in `shared/index.js` (`name`, else `originalName`, else the type and date added) | For slides now, and for audio tracks later. Names stay in the admin panel: the playlist doesn't carry them. |
| D39 | Section cards that fold, and never hide a warning | `components/ui/CollapsibleCard.vue` + `useCollapsed` | Each card says when it needs attention: Change password (the default password), Software updates (an update running, the server restarting, the last attempt failed, rolled back or cancelled, an error message), Slides (a failed slide or upload). The page warnings sit outside the cards. |
| D40 | Asking for the admin password again before something that can't easily be undone | `services/actionTokens.js` (the one-time token, per action), `middleware/passwordLimiter.js` (wrong tries, counted together), `components/ui/ConfirmDangerDialogs.vue` (the dialogs), `.danger-dialog` in `styles/base.css` (their texts) | Used by the branch switch and Delete All; Restore Defaults will use it too. Each action keeps its own warning texts. |
| D41 | The update schedule: when an install is due | `installers/lib/schedule.sh` only (update.sh); it writes the next install time into update-check.json for the admin panel | The server only checks and saves the values (`updates/schedule.js`, `updateFiles`); `updateFiles.readSchedule` reads the file with the same defaults as `read_schedule`. |
| D42 | Restore Defaults: what is reset and what is kept | the server (`contentReset.applyPendingRestore`, `KEPT_DATA`) for data/, tmp/ and logs/; update.sh (`RESTORE_KEEP`, `clean_folder`) for the rest of the folder | Two lists on purpose: each side resets what it owns. A file the installer adds to the folder must go on `RESTORE_KEEP` (`tests/installers/update-restore.sh` checks every file the installer writes). |
| D43 | A video's format: choosing it, recording it, converting to it | `settingsService.videoFormat` (the choice), `mediaService` (`processVideo`, `videoFormatOf`), the slide's `format`, `videoConversion` (existing videos) | Uploads and conversions encode with the same `processVideo`; a slide without `format` is checked with ffprobe. **H.265 (HEVC) is the default** (the owner, 2026-09-28: smaller files); **H.264 is the fallback for older hardware** (a Raspberry Pi 3 can't decode H.265; Chromium on a Raspberry Pi 4 or 5 uses its hardware decoder; a PC's browser on its own, e.g. Firefox can't, so the admin panel's preview of a new video stays blank there). The setting chooses one format; the viewer never plays both on purpose: a video in the other format is left to fail on a screen that can't play it, showing nothing for its length (the slide clock, §3.5). The Display card warns while it's chosen, and while videos already uploaded aren't all in the saved format (`videoConversion.formats()`, `GET /settings/videos/formats`, since 0.6.13); *Convert existing videos* fixes that. Encoding H.265 takes several times longer than H.264 on a Raspberry Pi. |
| D44 | An audio show's settings and their limits | `shared/contract.json` `audio` (orders, transitions, fadeSeconds, volume; for a video's sound: withSound, lowerTo): `audioShowRules` checks, `audioShowStore` takes the defaults, the admin card offers them (`@shared` AUDIO) | |

---

## 15. External contracts an installed system relies on

An installed Server receives new code through the `update.sh` that is **already on disk**. The installer, the kiosk scripts and the systemd units change only when the installer is run again. The new code must therefore keep every one of these working:

**Run by systemd and by the updater already on the Server**
1. **`installers/update.sh`** must stay at that path: the update service runs it.
2. **`server/index.js`** must stay the entry point, run from `/opt/noticeboard` with `/usr/bin/node`. The root `package.json` must keep the scripts `npm install`, `npm run build` and `npm prune --omit=dev`, run from the repository root, and `build` must produce `client/display/dist` and `client/admin/dist`.
3. **`GET /api/auth/status`** must answer 2xx on `localhost:<config.port>` within 90 s of a restart. This is the health check of the update.sh that installs the new code; failing it causes a rollback.
4. **`server/utils/configIO.js`** must keep exporting `readConfig(path)` returning a promise of the parsed config. `update.sh` and `install.sh` load it with `node -e` to read the port.
5. **`server/services/configService.js`** must keep exporting `init()`: `install.sh` calls it on the first install.
6. The **new update.sh must still contain the text `update-branch.env`**. Otherwise older Servers refuse to switch to the branch.
7. **Nothing may be tracked under `data/`, `tmp/`, `logs/` or `.env`.** Otherwise every updater refuses the commit.
8. The **`tmp/noticeboard-uploads/`** folder must stay the place where uploads wait, because update.sh waits for it.
9. **`tmp/update-request`** starts update.sh; the server writes it, and the systemd path unit watches for it. An older update.sh treats any text in it as a request to install, which is only what `check` avoids.

**Kiosk scripts** (not updated by sync)
10. `GET /` answers 200 when the device is allowed and 404 when MAC filtering blocks it.
11. `POST /api/device/kiosk-exit/claim` returns **exactly** `{"exit":true}` when an exit was requested, with no spaces.
12. `?kiosk=off` turns off the kiosk behaviours in the viewer.

**Help shortcuts and links**
13. `/opt/noticeboard/noticeboard-guide.html` (the server's `file://` shortcut) and `/admin/help` (the display shortcut) must stay where they are.
14. The guide anchors the admin panel links to must stay.

**Files in `data/`** (their formats and paths must not change)
15. `config.json` (JSON5-readable, with every key in §5.1), `slideshows/<folder>/slideshow.json` (slide fields in §5.1 and §6), media names, `branding/logo.png`, `update-branch.env`, `update-status.json`, `update-check.json` (keys may be added), `update-notice.json`, `update-schedule.env`, `restore-defaults`, `installer.json` and `backups/`.
15a. **Restore Defaults keeps** every file the installer writes into the install folder (`RESTORE_KEEP` in update.sh, `KEPT_DATA` in contentReset).

**Viewer and admin pages already open in browsers**
16. They keep running old code until they reload, so:
    - socket.io must stay at `/socket.io`, with the event names `display:build`, `display:ready`, `playlist:update`, `display:settings`, `audio:update`, and since 0.7.0 `time:ping` and `time:pong`, and their payloads (keys may only be added; `playlist:update` gained `startedAt` in 0.7.0).
    - The viewer reloads when `display:build` changes, after fetching `/` successfully.
    - The admin panel polls `GET /api/settings/updates` and reloads when `commit` changes.

**Sessions and URLs**
17. The session cookie `nb_admin_token`, signed with `config.jwtSecret`, must be accepted, so admins stay logged in across the update.
18. These URLs must stay: `/`, `/admin`, `/admin/*`, `/admin/help`, `/media/<folder>/slides/<file>`, `/audio/<folder>/tracks/<file>`, `/branding/logo?v=`, and every `/api` path in §4.1 (the admin panel is rebuilt with the code, but the kiosk scripts and open tabs are not).

**Browser storage**
19. The keys `noticeboard:navCollapsed`, `noticeboard:collapsedCards` and `noticeboard:lastRecoveryReload` (merely nice to keep).

**The installer and the kiosk**
20. What older installers look for when they hand over: `installers/install.sh` must exist at every commit. It must pass `bash -n`, and for non-main branches contain a line starting with `INSTALLER_VERSION=`. **Older installers download only this one file.**
21. The installer version heuristic reads `/opt/noticeboard/start-kiosk.sh`.

---

## 16. Known issues

Behaviour kept as it is until a change is planned for it (§18): fixing one changes behaviour, so it is designed, reviewed and tested on its own. The list was cleared for a stable base in 0.6.2–0.6.13 (§18.5; what each version fixed is in §19). What is left:

1. **The media route allows audio extensions** (`.mp3 .wav .ogg`) that nothing produces there. Reviewed after audio support (0.6.7): still an issue, reported and left as it is (the owner, 2026-09-28). Audio shows' tracks are `.m4a`, served only at `/audio`, and a slide is only ever an image or a video, so `/media` never holds audio. Harmless (the files would still be MAC filtered), but the allowlist is wider than it needs to be.
2. **Changing the default image duration doesn't resend the playlist** (kept as it is on purpose: the owner, 0.6.11; `tests/api/socket-events.js` records it). Slideshows without their own duration keep the old one on screen until the playlist is next sent: a publish, upload, reorder or delete, a scheduler change, or a display reconnecting.

---

## 17. Tests

Run them with `node tests/run.js <group> [filter]` or the npm scripts. A file that fails is followed by how it ended (exit code, signal, or why it could not start) and how long it ran. A file whose Node.js process crashed rather than failing a check (a signal, or a Windows crash code such as 0xC0000409, seen now and then on Windows, at any point in a test: after 0.7 to 5 s so far) is run once more, and the summary says so; one that fails a check is never run again. `socket-events.js` waits for the start-up job that makes the sample video's thumbnail (and fills in its length) before it connects: that job resends the playlist when it finishes, which now and then landed in the first step as a second, identical empty playlist (found through the Server's log, which the test prints when a step differs). `npm run build` must come first for api, browser and upgrade.

| Group (npm script) | Where | What it covers | Needs |
|---|---|---|---|
| unit (`npm test`) | `server/test/`, `client/display/test/` | the Server's clock as a screen tells it (6: exact offsets, the shortest round trip winning, odd answers ignored, two screens minutes apart agreeing); the slide clock (13 tests: the timeline, failing slides keeping their place, hidden and frozen pages catching up, playlist changes, 30 simulated days with two screens whose clocks are minutes apart); the slide timeline (5) and the Server's playlist timeline (5: at once with nothing on, a change at the slide's end, the same playlist ignored, going back cancelling a switch); event audio's rules and the weekly rule (8: each mode, start now ended by a scheduled event, `nextChange`, clashes of every pair of modes, `eventState`, a simulated fortnight minute by minute); the audio engine (17: each track at its time, joining mid-way, two screens with clocks minutes apart on the same track and point all day, drift put back, crossfade timing, show volume, switching shows, fading out, coming back like a radio, a new timeline from the Server, failing and stalling tracks, a refused play retried every minute or at once with `retryNow`, duck/pause/resume, the preview's own timeline, a simulated day of crossfades without timers piling up); the music timeline (5) and the Server's audio timelines (5: a new show, the volume at once, a change at the track's end after it, going back cancelling it, an event and after it); installer version ↔ system requirements (5); the Node.js version rule in installers/lib/system.sh ↔ system-requirements.json (1); the shared foundations: address helpers, both loopback rules, media type lists, contract event names, and `shared/index.js` ↔ the server (mediaUrl, LIMITS), the media name rule and mediaDisplayName (9) | Node 20+ |
| api (`test:api`) | `tests/api/` | **contract.js**: 106 entries recorded in `tests/fixtures/api-contract.json`. They cover every route's status, content type and JSON shape, the exact MAC-denied page (seen from the PC's network address), the kiosk-exit answer, the cookie attributes, the socket events and a playlist. Also: branch switching end to end with the real update.sh (31 checks), the slideshow lifecycle, upload errors and stress, graceful shutdown, one admin check per request (`admin-check-once.js`, from the debug log), **the data files byte-for-byte** for a fixed script of actions (`data-files.js` ↔ `tests/fixtures/data-files.json`), the store's edge cases (`slideshow-store.js`), audio shows (`audio-shows.js`: defaults, limits, tracks converted to AAC with their length and name, rename, reorder, delete, `/audio`), MAC filtering's settings (`mac-settings.js`: only the fields sent change, MACs normalised and checked, no duplicates, the Server's own entry kept, a bad change refused and nothing changed), an unreadable config.json (`config-recovery.js`: the last good copy kept on save, a broken file kept and the copy restored, the note until dismissed, no copy: the defaults), the port and restarting (`restart.js`: the port's range, `restartNeeded` in the API and on the screens, the token, the Server stopping and coming back on the new port), MAC filtering on the live connection (`socket-mac.js`: refused at connect through the PC's network address, the Server itself allowed, a connected device dropped when filtering is turned on), background audio (`audio-update.js`: a slideshow's audio show checked and stored only when chosen, `audio:update` with the playlist and only when it changes, published shows with ready tracks only, deleting a show clears it), event audio (`audio-events.js`: the modes and times checked, overlaps refused naming the other show, `eventState`, `audio:update`'s `event` for a start-now event, a running once event taking over, unpublished, stopped), a video's own sound (`video-sound.js`: videos only, the choices and limits, off removing the keys, the playlist's keys only on that video), the update schedule's routes and the screens' mark (`update-schedule.js`), the video format for new uploads and converting the existing videos (`video-format.js`: H.265 by default, H.264 when chosen, checked with ffprobe; other formats refused; each video's length in the playlist; a conversion showing each video processing in its turn while the screens keep its file, then replacing it; a second run changing nothing; a restart mid-way; the count of videos not in the saved format, before and after converting), Restore Defaults (`restore-defaults.js`: the request, then after a restart exactly the kept files, default settings and password, a new session secret, the sample as new, no second reset), Delete All (`delete-all.js`: only the sample left, every audio show gone and the sample's choice of one cleared, settings and logo kept, the tokens, the playlist sent, the shared limit on wrong passwords), slide names (`media-names.js`: recorded on upload, with accents; renaming; the limits; no playlist sent and none carrying names), and **what a display receives for 15 admin actions** (`socket-events.js` ↔ `tests/fixtures/socket-events.json`), and the "app not built" pages (`spa-fallback.js`) | Node 22+; ffmpeg for video |
| browser (`test:browser`) | `tests/browser/` | branch-switching UI, installer notice, Last updated, login loop, MAC warning, mobile layout, sidebar, merged notice, the viewer and admin panel end to end (`viewer-and-admin.js`), slideshows and media with video (`slideshows-and-media.js`), the viewer's reliability under outages, freezes, crashes and updates (`viewer-reliability.js`, scenarios A–E), and the viewer controls' computed styles (`viewer-look.js` ↔ `tests/fixtures/viewer-look.json`), the admin panel's computed styles (`admin-look.js` ↔ `tests/fixtures/admin-look.json`, 82 elements on desktop and phone), the larger pages' computed styles and texts (`admin-pages-look.js` ↔ `tests/fixtures/admin-pages-look.json`: the slideshow page with its edit form, schedule and preview, the Settings cards, the branch check and the Missing software dialog; 57 elements and 6 texts), the login page (`login-page.js`), and the updater's warnings on every admin page and the viewer's warning mark (`warnings-everywhere.js`), slide names in the slide list, preview and delete question (`slide-names.js`), cards folding to their title without hiding a warning (`collapsible-cards.js`), a reorder that can't be saved shown in the slide list (`reorder-error.js`), a card's messages (`messages.js`: "Saved."'s timer never clears a later error, which stays until its ✕), screens in step (`screens-in-step.js`: two viewers, each in its own window so neither is a hidden tab, with clocks minutes out agreeing on the Server's time and showing the same slide; a third joining later going straight to it; all three switching together after a change; the slideshow's music playing the same track at the same point on all three), the Port card and the restart box (`restart.js`: on every page, password and last chance, the page moving to the new port by itself), the audio pages (`audio-shows.js`: create, settings, upload through the file picker, ▶/■, "Preview the show" with ⏭ and ■, rename, reorder, delete, the list), background audio (`background-audio.js`: the slideshow's choice and fact, the viewer following it, unpublishing, None, a click starting refused sound; a video's Sound switch, and on screen the video playing with the background lowered to its volume, then paused, and brought back; the Event audio card: Start now taking over a screen, Stop giving the slideshow's show back, an overlapping event refused), Delete All's card and dialogs, the audio shows listed (`delete-all.js`), Restore Defaults' warning and request (`restore-defaults.js`), the video format setting, its explanations and warning, the warning while uploaded videos aren't in the saved format, and converting the existing videos (`video-format.js`), the update schedule, the waiting version's choices, the manual notice and the viewer's mark (`update-schedule.js`), slides fitting the screen (`slide-fit.js`: a landscape and a portrait image in a portrait and a landscape window, checked on the screen's pixels, with the background colour) | Chrome (the runner starts a headless one) |
| installers (`test:installers`) | `tests/installers/` | install flow, branch choice, handover, self-update (the real-GitHub check only with `NB_TEST_NETWORK=1`), sudo, firewall, kiosk scripts, update.sh (updates, branches, merged return, **the schedule** with a fake clock: `update-schedule.sh`; **Restore Defaults**: the clean, the keep list against every file the installer writes, a restart after a failed reinstall: `update-restore.sh`), **the module loader** (`module-loader.sh`: local, at a commit, the followed branch, missing or broken parts, the baseline installer handing over). They load the installer through `tests/helpers/installer.sh` (`load_installer`), as a real run loads its parts. Plus two comparisons: **golden files** (the 10 generated files ↔ `tests/fixtures/installer-golden/`) and **branch names** (`lib/branch.sh` ↔ the server, `tests/fixtures/branch-names.txt`) | bash (Git Bash on Windows) |
| upgrade (`test:upgrade`) | `tests/upgrade/` | **the upgrade rehearsal**, in three steps. Nothing about the data, API, playlist, login or kiosk answer may change at any step. | bash, Node |

The upgrade rehearsal works like this:
1. An installed older version (`NB_BASELINE`, default `fc4ba53`), with data seeded through its own API, takes the working tree through **its own** update.sh, as a real Server does.
2. The new update.sh installs a following commit.
3. It goes back to the baseline.

The display settings a screen receives are compared the way open screens depend on them: every key the older version sent keeps its value; new keys may be added.

Helpers:
- `tests/run.js` is the runner. It lists the files itself, so it works on Node 20, and it finds Chrome and Git Bash.
- `tests/helpers/app.js` makes throwaway app copies and servers.
- `tests/helpers/cdp.js` is the Chrome client (`newWindow`: a page in a window of its own, for tests that need several visible pages: Chrome slows the timers of a tab behind another).
- `tests/upgrade/state.js` seeds and takes the snapshots for the rehearsal.

The snapshot files in `tests/fixtures/` were recorded from known-good code. They are recorded again (`NB_UPDATE_SNAPSHOT=1`) only for a deliberate, reviewed change.

---

## 18. Planned and in-progress changes

Every planned change starts here, before any code: what changes and why, the parts affected, the risks to existing users and installed Servers and Clients, and how it will be tested. A change to behaviour or structure is reviewed with the owner before coding. Once it's done, the sections above describe it and it leaves this list.

| # | Change | Status | Version (§19) |
|---|---|---|---|
| 18.1 | The viewer's black screen that only a power cycle cleared | On hold: the owner reports it if it happens again | a patch release when fixed |
| 18.3 | Audio: audio shows, slideshow background audio, video sound, event audio | Built on `feature/audio-support` (phases 1–7 done); to check on a real Pi, then merge into main with the owner's OK | 0.6.0 |
| 18.4 | The words Server and Client everywhere; the supported devices | Done (the kiosk scripts' text with §18.5 item 2, installer version 4); on `feature/audio-support`, to merge with it | 0.6.1 |
| 18.5 | The Known Issues cleared for a stable base (§16) | Done on `feature/audio-support` (all 12 items), to merge with it | 0.6.2 to 0.6.13 (one per item) |
| 18.6 | Releases: main follows GitHub Releases; branches return to main once a Release has their work | Planned, after 18.5 | 0.8.0 |
| 18.8 | Every screen in step: slides and music on the Server's clock | Approved (2026-09-28), being built on `feature/audio-support`, before the merge | 0.7.0 |

Design notes D44–D47 are reserved for 18.3.

### 18.1 The viewer's black screen that only a power cycle cleared

**What was seen (on an earlier version):** the slides went black while the location pin still showed; slideshow changes no longer reached that screen; the Pi's own keyboard and mouse stopped responding, even unplugged and plugged back in; the server and the viewer still worked from other devices; only a power cycle brought the screen back. The code involved hasn't changed since, so it has to be assumed to be still present.

**What that points to:** the page's own recovery can't be the whole story: a slide that stops is skipped within 30 seconds (the slide clock, §3.5), and a stuck page reloads itself (`recovery.js`). Dead input devices mean something below the page stopped: the desktop compositor (labwc) or the graphics driver, which Chromium (and its hardware video decoding) depends on. Screen blanking is less likely, because the pin was still visible.

**On hold** (the owner's decision): if it happens again, the owner collects the evidence below and this plan continues.

**Step 1, the evidence (the owner, on the Pi):** the log of the boot that hung, which the Pi keeps across restarts:
```
journalctl --list-boots | tail -5          # the boot before the power cycle is usually -1
journalctl -b -1 -k -p warning | tail -80  # the kernel: graphics (v3d, vc4, drm), memory
journalctl -b -1 -t noticeboard-kiosk | tail -40
journalctl -b -1 | grep -iE "labwc|chromium|oom|gpu|v3d|vc4|drm" | tail -80
cat /proc/device-tree/model; uname -r; chromium --version
```

**Step 2, recovery whatever the cause:** a watchdog, so a screen that stops being drawn recovers by itself:
- The viewer reports to the server that it is alive and drawing (driven by the browser's drawing loop, which stops when the page is no longer drawn), every 30 seconds.
- The kiosk script checks its own screen's reports; if they stop while the server answers, it restarts the browser.
- If a new browser doesn't bring them back (the compositor or driver is stuck), a small root service installed by the installer restarts the desktop session, and as a last resort reboots the Pi (rate-limited, and logged).
- This changes the kiosk scripts and adds a unit, so `INSTALLER_VERSION` goes to 3 and the admin panel and every screen will ask for the installer to be run again (§3.5, §3.6).

**Step 3, prevention:** chosen from what the logs show (e.g. Chromium's graphics or video-decoding flags, or a driver setting). The exact design of steps 2 and 3 is written here, and reviewed, before any code.

### 18.3 Audio

**What changes (the owner's 2do features "Audio Support" and "Master / Event Audio Override"):** audio shows (tracks uploaded, named, ordered, played in order or shuffled, with no transition or a crossfade of a chosen length, a show volume, previewed in the admin panel, published or not); a slideshow's background audio (one published audio show, or none); a video's own sound, with the background audio lowered or paused while it plays; and event audio, which takes over from the background audio at a time.

**The owner's decisions:** every screen plays the audio; the kiosk is allowed to play sound through an installer bump (`INSTALLER_VERSION` 3: until the installer is run again on a Server or Client its screen stays silent, nothing breaks); moving to a slideshow with another audio show switches at once with that show's transition (none: fade out); loudness is evened out when a track is uploaded; when an event ends, background audio starts its next track; events start now (until stopped, and never past the next scheduled event), once (from a date and time to another) or repeat (days and times, like a slideshow's schedule); saving an event that overlaps another is refused.

**Data (new; nothing existing changes shape):**
- `config.audioShows[]`: `{ folder, name, enabled, order: 'in-order' | 'shuffle', transition: 'none' | 'crossfade', fadeSeconds, volume, event?, addedAt }`; `event`: `{ mode: 'now' | 'once' | 'repeat', from?, to?, days?, startTime?, endTime? }`.
- `data/audioshows/<folder>/audioshow.json`: `{ tracks: [{ id, type: 'audio', originalName, name?, filename, status, duration, addedAt }] }`, the files in `tracks/`, served at `/audio/<folder>/tracks/<file>`.
- A slideshow entry gains `audioShow` (a folder, or absent for none); a video slide gains `sound`, `withSound: 'lower' | 'pause'`, `lowerTo` (%).

**How it fits (reuse, not copies):**
- **One store for both kinds:** `slideshowStore` becomes an instance of a store factory (`services/showStore.js`), `audioShowStore` another; `slideshowStore` keeps its API, so its callers and its files are unchanged.
- **Uploads:** the slide routes' upload, list, rename, delete and reorder become one route factory used for slides and tracks; the upload queue takes the store; `mediaService.processAudio` (ffmpeg → AAC `.m4a`, `loudnorm`) sits beside `processVideo`; names use `mediaNames` and `mediaDisplayName` (D38). update.sh waits for audio uploads like any other.
- **Screens:** a new socket event `audio:update` (`{ shows, slideshows, event }`; older viewers ignore it), sent on connect and on `displayEvents.audioChanged()`. Playlist video entries gain `sound`, `withSound`, `lowerTo` (keys only added). The engine, `shared/audioPlayer.mjs` (§12.8), is plain JavaScript with injectable media elements and timers (like the slide clock) and unit-tested; the viewer's `BackgroundAudio.vue` and the admin panel's show preview both use it. A refused `play()` (a kiosk without the new flag) leaves the screen silent.
- **Events:** `services/audioEvents.js` (pure) decides the active event and checks overlaps; repeating events reuse the slideshow schedule's rules.
- **Admin panel:** "Audio" in the sidebar (list and detail pages, a track list with ▶, "Preview the show", an event card); "Background audio" on a slideshow's settings; "Play its sound" on a video. Shared pieces: CollapsibleCard, PublishToggle, StatusBadge, ConfirmDangerDialogs, and the rename field (moved out of SlideList).
- Delete All and Restore Defaults include audio shows.

**Phases** (each designed here in detail before its code, tested with every group and committed):
1. **Done:** foundations with no visible change: the store factory (`services/showStore.js`), the item-route factory (`routes/api/mediaItems.js`), the shared rename (`composables/useRename.js`), `getMediaDuration`. Every snapshot stayed identical.
2. **Done:** audio shows in the admin panel: store, routes, `/audio`, processing with loudness levelling, pages, track preview (D44).
3. **Done:** the audio engine (`shared/audioPlayer.mjs`, 12 unit tests over simulated time) and "Preview the show" (`ShowPreview.vue`). **Still to check on a real Pi:** crossfades on the Server's screen and a Client (smoothness, CPU); if they aren't smooth there, "no transition" stays and the limit is documented.
4. **Done:** background audio on the screens (`audio:update`, `BackgroundAudio.vue`, the slideshow's "Background audio"), and the installer bump to version 3 (the kiosk may play sound). Detail below.
5. **Done:** video sound: a video's Sound switch, and the background audio lowered or paused while it plays. Detail below.
6. **Done:** event audio: an audio show that every screen plays instead while its event is on (start now, once, or repeating; overlaps refused). Detail below.
8. **In progress (0.6.14), from the owner's test on Pis:** a video playing its own sound silenced the background music completely, even set to "lower to 60 %". The page is right (a browser check with the audio elements watched: the music keeps playing at 0.6 while the video plays). The cause is below it: loudness levelling (`loudnorm`) raised every track to **96 kHz**, while videos' sound is usually 48 kHz, and a Pi's audio output doesn't mix two streams at such different rates. Fix: every sound we produce is **48 kHz** (tracks and videos' sound), and a read-only `?debug=audio` view on the viewer shows the engine and its audio elements, to check on a real screen. Tracks and videos uploaded before stay as they are (re-upload them). If the Pi still can't play two sounds at once, the options that need it go (the owner, 2026-09-28): a video with sound always pauses the background, and shows have no crossfade.
7. **Done:** Delete All, Restore Defaults and the documents: **Delete All** also deletes every audio show with its tracks and event, and clears every kept slideshow's choice of one (the sample's), in one config write before the slideshows' own (`showStore.removeMany(folders, other)`); its warning lists the audio shows with their track counts, and its result names them (`deletedAudio`). **Restore Defaults** already removes them (it empties `data/` and resets the config); its warnings now say so. Tests: api (`delete-all.js`: audio shows gone with their folders, the sample's choice cleared, the screens told), browser (`delete-all.js`: the audio shows in the warning), the Settings page's text snapshot re-recorded on purpose.

**Phase 4 in detail (done): background audio on the screens**
- **A slideshow's audio show:** a slideshow entry gains `audioShow` (an audio show's folder), stored only when one is chosen, so slideshows without audio keep their exact data (the data-files test). `PUT /api/slideshows/:folder` takes `audioShow` (a folder or null for none); `slideshowRules.parseAudioShow` refuses a folder that isn't an audio show ("Choose an audio show that exists"). Any audio show can be chosen through the API; the admin panel offers the published ones, plus the current choice if it has since been unpublished (marked "not published: silent until it is published again").
- **Deleting an audio show** also clears it from the slideshows that chose it, in the same config write (`showStore.remove(folder, other)` gains the other keys to write with it), so a later show with the same name doesn't take its place.
- **What the screens are told:** `services/audioPlaylist.js` `buildAudio()` → `{ shows: { <audio folder>: { id, order, transition, fadeSeconds, volume, tracks: [{ url, length }] } }, slideshows: { <slideshow folder>: <audio folder> }, event: null }`. Only published audio shows with at least one ready track are in `shows`, and only slideshows whose audio show is in `shows` are in `slideshows` (published or not: which slideshows are on air is the playlist's job). `event` stays null until phase 6. The shape of each show is exactly what `shared/audioPlayer.mjs` takes.
- **The socket:** a new event, `audio:update` (`socketEvents.AUDIO_UPDATE` in the contract), sent to a display with its playlist on `display:ready`, and to all when it changes: on a config `change` (a slideshow's audio show, an audio show's settings, publishing, deleting) and on `displayEvents.audioChanged()` (a track ready, renamed, reordered or deleted), only when it differs from the last one sent (like `display:settings`). Older viewers ignore an event they don't know.
- **The viewer:** `useSocket` gains `audio` (the last `audio:update`, empty until one arrives). `SlideShow.vue` emits `on-air` with the slideshow of the slide on screen (the playlist's `slideshow` key); App.vue keeps it (null while the waiting screen shows) and gives it with `audio` to a new `BackgroundAudio.vue` (no markup), which calls `player.setShow(audio.shows[audio.slideshows[onAir]] ?? null)` on the engine. So a change of slideshow switches the audio at once with the new show's transition, a slideshow without audio fades it out, and two slideshows on the same audio show carry on without a break. A refused play (a kiosk not yet allowed sound, or an ordinary browser tab) stays silent and tries again every minute, or at once when someone clicks or presses a key on the screen (the engine gains `retryNow()`).
- **The kiosk:** both kiosk scripts (`installers/kiosk/server.sh`, `display.sh`) add `--autoplay-policy=no-user-gesture-required` to the browser's flags. `INSTALLER_VERSION` 3, with `installer.version` 3 and a changes line ("Background audio: the kiosk may play sound", displays: true) in system-requirements.json, and the golden files re-recorded on purpose. Until the installer runs again on a Server or Client its screen stays silent and the admin panel asks for the installer run as it does today; nothing else changes.
- **Admin panel:** SlideshowSettingsCard shows "Background audio" (the show's name, or None) and has a "Background audio" select in its form (GET /api/audioshows for the choices). The guide explains choosing it, that the sound comes out of the screen's usual output (HDMI on most TVs), and that a Server or Client needs its installer run again first.
- **Risks:** the playlist and `display:settings` are unchanged; `audio:update` is new, so open screens and older viewers are unaffected; a screen reloads onto the new viewer as after any update. The admin pages' look snapshot gains the "Background audio" fact (re-recorded on purpose); the socket-events recording gains `audio:update` after the playlist on connect.
- **Tests:** unit: `retryNow`; api: `audio:update` payloads (published only, ready tracks only, a slideshow's choice, deleting clears it, only sent when changed), `audioShow` validation, the contract gaining the new event; browser: the select and the fact, and a viewer following a slideshow change (the audio elements' sources, as far as a headless browser can tell); installers: the flag in both kiosk scripts, the golden files, installer version 3.

**Phase 5 in detail (done): video sound**
- **Data:** a video slide gains `sound: true` (stored only when on), and with it `withSound: 'lower' | 'pause'` (what the background audio does meanwhile) and `lowerTo` (the background's volume while it plays, 0–100 %, default 20). Slides without sound keep their exact data. The limits go in the contract's `audio` section (`withSound`, `lowerTo { min, max, default }`).
- **The route:** `PUT /api/slideshows/:folder/slides/:id/sound` `{ sound, withSound?, lowerTo? }` (added through the slide routes' `extend`), checked by `slideshowRules.parseVideoSound` (a video only; the choices and limits from the contract); announces a new playlist. Turning sound off removes all three keys.
- **The playlist:** a video entry gains `sound: true, withSound, lowerTo` only when its sound is on (keys only added: open screens and older viewers are unaffected, and the socket-events recording, which has no sound, stays the same).
- **The viewer:** `VideoSlide` takes `sound`: such a video starts unmuted; if the browser refuses (a kiosk not yet allowed sound), it plays muted instead, so the slide still plays and keeps to time. `SlideShow`'s `on-air` carries the slide itself (not only its slideshow), and App passes BackgroundAudio the video's sound settings while such a slide is on: **lower** calls `duck(lowerTo / 100, 500 ms)`, **pause** calls `pause()`; when the slide goes, `duck(1, 500 ms)` or `resume()`, carrying on where the track was. The engine already has both (tested); nothing new in its timing.
- **Admin panel:** in the slide list, each video gets a **Sound** switch; when on, "While it plays, the background audio: lowers to [20] % / pauses". Saved at once, like a rename. The guide explains it and that a slideshow without background audio simply plays the video's sound.
- **Risks:** only slides with sound on change anything; a refused unmuted play falls back to muted, so no video is skipped because of sound. **Tests:** api (the sound route: videos only, the choices and limits, off removes the keys; the playlist's keys only when on; the data-files and socket-events recordings unchanged); browser (the switch and options in the slide list; on the viewer, a video with sound falling back to muted in a headless browser and still playing, and the background audio lowered to the chosen level, then back, or paused and resumed).

**Phase 6 in detail (done): event audio**
- **What it is:** an audio show can be an **event**: while the event is on, every screen plays that show instead of any slideshow's background audio. Afterwards each screen goes back to its slideshow's audio show, starting its next track (the engine already does this when it comes back to a show). Only a published show with a ready track plays; the event card says so otherwise.
- **When** (the owner, 2026-09-28): **Start now**, until stopped (or until the next scheduled event starts, which then takes over and ends it); **once**, from a date and time to another; **repeating**, on chosen days from a start to an end time (the same days-and-times rule as a timed slideshow, on the Server's own clock). The end is after the start; a repeating event doesn't cross midnight.
- **Data:** the audio show entry gains `event`, stored only when set: `{ mode: 'now', since }` (ISO time), `{ mode: 'once', from, to }` (local date-times, `YYYY-MM-DDTHH:MM`), or `{ mode: 'repeat', days: [0-6], startTime, endTime }`.
- **Rules, in one pure module** (`services/audioEvents.js`, unit-tested over simulated weeks): `activeEvent(shows, now)` → the folder of the event playing now, or null; `clashes(folder, event, shows)` → the other scheduled events it overlaps (once with once, once with each repeat occurrence, repeat with repeat on a shared day); `nextChange(shows, now)` → when the answer next changes. A start-now event ends when any scheduled event starts after its `since`. The weekly rule is moved out of schedulerService into `utils/weeklyTimes.js` (`inWeeklyWindow(times, date)`), which both use, so they can't drift apart; the scheduler's behaviour is unchanged.
- **Overlaps are refused** when saving (`PUT /api/audioshows/:folder/event`, `{ mode, … }` or null to remove; checked by `audioShowRules.parseEvent` and `audioEvents.clashes`): 409 with the clashing show and its times ("Clashes with "Summer fair" on Sat 10:00–16:00"). A start-now event never clashes (the next scheduled event ends it).
- **Telling the screens:** `audio:update`'s `event` becomes the folder of the event playing (its show is then in `shows` even if no slideshow uses it). A small `services/audioEventClock.js` (like the scheduler) works out the active event on a config change and at `nextChange` (a timer, at most a minute away), and emits `'update'` when it changes; displaySocket sends the audio again (only if it differs).
- **The viewer:** BackgroundAudio plays `shows[event]` while there is one, else the slideshow's show, through the same engine: switching uses the new show's transition, and coming back plays the next track (since 0.7.0 the Server starts every other show's timeline again at the event's end, with that next track, §18.8). A video's own sound lowers or pauses event audio in the same way.
- **Admin panel:** an **Event audio** card on the audio show's page (CollapsibleCard): Off / Start now / Once (from and to) / Repeat (days, start and end: the days-and-times fields moved out of ScheduleEditor into `WeeklyTimesEditor.vue`, used by both, the slideshow form looking exactly as before). It shows the state: "Playing now on every screen", "Next: Sat 10:00", "Ended", or "Not published: it won't play", with **Stop** for a start-now event, and the clash message when saving is refused. The audio show list shows "Event" on a show that has one. `GET /api/audioshows` adds `eventState` (`playing`, `next` time, `ended`).
- **Risks:** the scheduler's rule moves to a shared module (its tests and the slideshow schedule's behaviour must stay the same); the payload only fills a key that was null. **Tests:** unit (`audioEvents`: each mode, the boundaries, start-now ended by a scheduled event, clashes of every pair of modes, `nextChange`; `weeklyTimes` against the scheduler's cases); api (the event route: validation, clashes refused, removing; `audio:update`'s `event` for a start-now event and a once event already running; `eventState`); browser (the event card: Start now and Stop on a screen following it, back to the slideshow's show; a clash message; the slideshow form unchanged).

**Risks:** the installer bump asks every Server and Client for an installer run (the owner accepted it); the playlist and `display:settings` only gain keys, and `audio:update` is new, so open screens and older viewers are unaffected; slideshows' data stays byte-for-byte the same (the data-files test).

**Tests:** `audioPlayer` and `audioEvents` unit tests over simulated time; api tests for audio shows, tracks, processing (ffprobe), `/audio` and `audio:update`; browser tests for the pages, the preview, the slideshow and video settings, the event card; the golden files and installer version for the kiosk flag; the upgrade rehearsal.

### 18.4 The words Server and Client; the supported devices

**Version:** 0.6.1 (a patch: wording and documentation).

**Why:** the Noticeboard will run on more than Raspberry Pis, and a Raspberry Pi can be either role. Words that name the hardware ("the Pi", "the server Pi", "a remote display Pi") are replaced by the role.

**The owner's decisions (2026-09-28):**
- **Server:** the device running the Noticeboard server. **Client:** a device showing the Noticeboard viewer. The hardware is named only where it matters (installation, video decoding, the device list).
- **Words only:** everything people read changes: the admin panel, the viewer's texts, the installer's and update.sh's messages, README, the Help guide, this document and code comments. File names, API paths, socket events and data keys stay (e.g. `installers/kiosk/display.sh`, `display:*` events, `displays` in system-requirements.json, `/api/device`): installed Servers, Clients and open screens rely on them (§15).
- **The supported devices,** at the top of README, the Help guide and this document, with their status:

| Device | Server | Client | Video | Status |
|---|---|---|---|---|
| Raspberry Pi 3 | yes | yes | H.264 only, 1080p only | Supported (choose H.264 in Settings) |
| Raspberry Pi 4 | yes | yes | H.264 and H.265 | Supported |
| Raspberry Pi 5 | yes | yes | H.264 and H.265 | Supported |
| Orange Pi Zero 2W | no | yes, headless | H.264 and H.265 | Planned: needs a headless Client installer (a later feature; today's Client installer needs a desktop) |

**Done (2026-09-28).** The text inside the files the installer copies onto each device (the kiosk scripts) changed with §18.5 item 2, since it needs an installer version (4). **How:** a word list (Pi → Server/Client by context; "display" as a device → Client; "screen" stays for the physical screen) applied file by file, reading each sentence (no blind search-and-replace). **Risks:** texts only: the look and text snapshots (admin pages, viewer) and the installer's golden files change on purpose; nothing an installed system reads changes. **Tests:** every group; snapshots re-recorded after a reviewed diff.

### 18.5 The Known Issues cleared (§16)

**Why:** a clean, stable base before the next features. Each item is a bug fix with its own patch number (0.6.2 to 0.6.13, in this order), as the owner decided (2026-09-28):
1. (0.6.2, **done**) **socket.io MAC filtered.** A socket.io middleware (`io.use`) in displaySocket applies the same approval rule as `requireApprovedDevice` (one implementation: macService's `resolveAddress`, which `resolveRequest` now uses too) to the connecting address, and closes the connections a change to MAC filtering no longer allows; a refused device gets a connect error and nothing else. The viewer never loads on such a device anyway (`/` is filtered), so screens see no change.
2. (0.6.3, **done**) **The Server's kiosk follows the port.** `installers/kiosk/server.sh` reads the port from `data/config.json` each time it waits for the Server before starting the browser (as update.sh does, through `configIO.readConfig`), falling back to 3000. The kiosk scripts' texts take §18.4's words at the same time. `INSTALLER_VERSION` 4 with a changes line; golden files re-recorded on purpose; `kiosk-scripts.sh` checks a port from the settings and the fallback.
3. (0.6.4, **done**) **An empty client address is refused** when MAC filtering is on: `macLookup.isLocalhost` no longer counts `''` as this device (D6 updated); a request without an address is blocked.
4. (0.6.5, **done**) **The port is checked, and a restart is asked for when needed.** `PUT /api/settings` checks `port` (a whole number from 1024 to 65535, `limits.port` in the contract; whether another program uses it can't be told reliably, so that isn't checked). A **Port** card in Settings. `services/restartState` knows the port the Server is running on; while the saved one differs, `GET /api/settings/maintenance/restart` says `restartNeeded` and so does `display:settings` (the screens' warning mark). Like the installer box, an amber **Restart the Server** box on every admin page says what changes and that each Client's installer must be run again with the new address, and the firewall rule changed; its **Restart the Server now…** asks for the admin password and a last chance (D40), then the Server ends gracefully and systemd starts it again (`Restart=always`; no new rights). The page waits for the Server on the new port (`/api/auth/status` may be read from the same site for this) and moves there. The Delete content card's "set a custom port again in Settings" is now true. Tests: `api/restart.js`, `browser/restart.js`.
5. (0.6.6, **done**) **Unused npm packages:** the Known Issue and §18.2 are removed (the owner, 2026-09-28); the packages are left as they are (§11 says so).
6. (0.6.7, **done: reported**) **The media route's audio extensions:** reviewed after audio support. Still an issue, and reported only (not fixed here): `/media` still allows `.mp3 .wav .ogg`, which nothing puts there (tracks are `.m4a`, served at `/audio`). Harmless, but a wider allowlist than needed. It stays on the list.
7. (0.6.8, **done**) **Reorder errors shown:** `useItemList.move` shows the error ("Couldn't save the new order: …") and reloads the list from the Server, so what's shown is what's saved.
8. (0.6.9, **done**) **An unreadable config.json is never overwritten.** configService keeps `data/config.last-good.json`, written after every config.json that loads, is created or is saved. At start-up, a config.json that can't be read is moved aside as `config.json.broken-<time>` (kept, never deleted), and the last good copy is restored and loaded; with no good copy, the Server starts from its defaults (a new config.json is written as soon as anything is saved, e.g. the sample slideshow; the unreadable one stays kept). Either way `data/config-recovery.json` records what happened, and an amber box on every admin page (`ConfigRecoveryNotice`) says so, which file was kept and what to do, until "I've dealt with it" (`GET/DELETE /api/settings/config-recovery`). A missing config.json on a first start still creates the defaults, as before (§15: the installer's `init()` call is unchanged). The upgrade rehearsal leaves the copy out of its comparison, like the updater's own records. Tests: `api/config-recovery.js`; the data-files recording gains the copy.
9. (0.6.10, **done**) **macFiltering handled by settingsService,** like `display`: `enabled` (boolean) and `approved` (a list of `{ mac, label? }`, MACs normalised and checked, no duplicates) validated; only the fields sent change, the rest are kept. `configService.update` stays a plain top-level merge.
10. (0.6.11, **done: kept**) **Kept as it is** (the default duration doesn't resend the playlist).
11. (0.6.12, **done**) **Messages don't clear later ones.** useFlash cancels its timer whenever a new message is shown; a success can still clear itself, an error stays until it's dismissed (a ✕ on the message) or replaced by the next attempt's result.
12. (0.6.13, **done**) **Video formats:** the Display card warns when the videos already uploaded aren't all in the saved format ("1 of the 3 videos uploaded isn't H.265, the format selected. A screen that can't play it shows nothing for the video's length, then carries on. *Convert existing videos* below makes them all H.265."), from `videoConversion.formats()` (each video's recorded format, else ffprobe; nothing written), at `GET /settings/videos/formats`; the count is loaded again after saving and after a conversion. README and the guide say plainly: **H.265 (HEVC) is the default; H.264 is the fallback for older hardware** (Raspberry Pi 3). The viewer plays one format, the selected one; a video in the other format is left to fail on a screen that can't play it, as now (the setting is there to correct it). The item moves from Known Issues to the description of the Display settings (it is the design, not an issue).

**Risks:** the port touches the installer (version 4): the upgrade rehearsal must pass. The restart relies on the service's `Restart=always` (a Server started some other way, e.g. by hand, just stops: the box says so). Refusing an empty address could block a device that was let in before; the MAC filter's tests cover the addresses the server sees. The config recovery changes start-up: tested with a broken file, with and without a good copy. **Tests:** unit (the empty address, the macFiltering rules, the port rule); api (the socket refused for an unapproved device, settings validation, restart needed and the request, config recovery at start-up); browser (the Port field, the restart box and button, reorder errors, messages that stay, the video format warning); installers (the kiosk reading the port, golden files, version 4); the upgrade rehearsal.

### 18.6 Releases: main follows GitHub Releases

**Version:** 0.8.0 (a feature; 0.7.0 went to §18.8).

**Why:** merging into main should not by itself update every installed Server; publishing a Release should.

**main, the stable channel:** when the followed branch is main, update.sh asks GitHub for the latest published Release (`GET https://api.github.com/repos/fructus-sum/noticeboard/releases/latest`, which never returns drafts or prereleases), fetches its tag and uses the tag's commit as the target. From there the existing install, build, health check, rollback and status run unchanged. Rules:
- Never backwards automatically: if the Release's commit is already in what's running (a Server installed from main before the first Release, or newer), nothing is installed.
- No Release yet, or GitHub unreachable: nothing changes (the card says why), as for an unreachable branch today.
- The API allows 60 unauthenticated requests an hour per address; a Server checks at most every 15 minutes (Clients never check).

**Other branches:** unchanged: the latest commit of the branch, the same install process; manual branch changes work as today. A manual switch to main installs the latest Release even when it is older than what's running: the branch check says so ("main's latest Release, v0.x, is older than what's running; switching goes back to it") and the two confirmations still apply.

**Back to main after a Release:** `branch_merged` becomes "the latest Release contains the branch's work" (the branch's tip, or what's installed if the branch was deleted, is in the Release's commit: an ancestor, or squashed/rebased in, as `contained_in` checks now). Merging into main alone no longer returns a Server to main. Before returning, update.sh compares the Release's `installer.version` (its system-requirements.json) with this Server's installer record: if the installer must be run first, it stays on the branch, and the existing installer warning says so and what running it brings; once the installer has run (or when none is needed), the next due check returns to main. The notice then says the branch's work is in Release v0.x.

**The installer and the system requirements come from the same place:** on main, from the Release's tag (the installer handover, `installerCommand`, the "run the installer" box, update.sh's recovery command, the requirements checked before a switch); on a branch, from that branch as now. The one-line install command in README can stay pointing at main's install.sh: it hands over to the Release's installer (as it hands over to a branch's today).

**What the admin panel shows:** on main, "Version 0.8.0" (the Release name) with its commit, in the sidebar and the Software updates card; on a branch, the branch and commit as now. Publishing a Release: set the `package.json` versions to its number and add its row to §19 before tagging (a checklist in §19).

**Risks:** every Server on main stops following main's commits once this reaches it: it has to arrive through the current mechanism (merged into main), and the first Release must be published straight after, or main's Servers stay on the commit that brought it. The API and the tags are new dependencies of the updater (offline handling as for branches). **Tests:** installers (a stand-in GitHub with Releases: latest, draft and prerelease ignored, none yet, never backwards, a manual switch to an older Release; returning to main only once a Release contains the branch, waiting for the installer when its version rose); api and browser (the version shown, the branch check's older-Release message); the upgrade rehearsal from the version before.

---

### 18.8 Every screen in step: slides and music on the Server's clock

**Version:** 0.7.0 (a feature), on `feature/audio-support`, merged into main with audio (the owner, 2026-09-28).

**Why:** today every screen keeps its own time. Its slideshow starts when it loads, and its music starts from wherever it joined. So screens side by side show different slides, and screens heard together play the music at different points (an echo). The owner wants them in step. The limit is accepted: about a tenth of a second between screens, plus whatever delay each TV adds to its sound.

**One clock: the Server's.**
- Each screen measures how far its clock is from the Server's, over the socket it already has:
  - new events `time:ping` { sent } and `time:pong` { sent, server };
  - offset = server + round trip / 2 − received;
  - the sample with the shortest round trip wins out of 5 at connect, and one exchange every 5 minutes keeps it fresh.
- A new `client/display/src/serverClock.js` (pure, unit-tested) gives `serverNow()`.
- Screens' own clocks don't need to be right. Older viewers ignore the new events.

**Slides on a shared timeline.**
- The playlist gains `startedAt`, in the Server's time (a key only added).
- Each slide takes its duration (images) or its length (videos; a video without a known length counts as 10 s).
- Every screen works out from `serverNow()` which slide is on and how far into it. A screen that loads, reconnects or wakes goes straight to the right slide; the right point, for a video.
- **A playlist change** keeps today's rule that nothing is cut short:
  - the Server works out the end of the slide on the timeline when the change happens (E);
  - the new playlist starts from its first slide at E, as a screen does today, but now every screen at the same moment;
  - the Server sends it at E, with `startedAt = E` (built: sent at the boundary rather than ahead of it, so a screen never holds a playlist that isn't on yet; the few ms it takes to arrive are caught up from the timeline).
- The Server keeps the timeline in memory. After a restart it starts again at the first slide (screens reconnect and follow).
- **The slide clock** becomes "the timeline says which slide", with its reliability kept:
  - an image that won't load, or a video that won't play, holds its place until its time is up, as a video with a length does today;
  - a hidden, asleep or frozen page catches up when it wakes;
  - the "every slide keeps failing" recovery reload stays;
  - its 30-simulated-days tests move over, with new ones for two screens with different clocks.
- **Videos** start at the right point (`currentTime`). If one drifts more than 0.5 s from where the timeline says, it's put back.
- A screen that loses the Server keeps the timeline it has, so screens stay in step through an outage.

**Music on the same clock.**
- Each audio show in `audio:update` gains `startedAt` (the Server's time its timeline began: when it was published or changed, or at start-up) and `after` (the track that played just before it began, or null: the timeline starts with the next one).
- **Which track, and where in it**, come from `serverNow()`:
  - in order: round and round, from the track after `after`;
  - shuffled: each round's order comes from a seed made from `startedAt` and the round number, so every screen draws the same order, still never the same track twice in a row;
  - a crossfade starts the next track `fadeSeconds` before the end, on every screen together.
- **Drift:** a track more than 0.25 s out is put back; smaller drift is eased away by playing 2 % faster or slower for a moment.
- The engine (`shared/audioPlayer.mjs`) takes `serverNow`, and a show with `startedAt`. The admin panel's preview keeps using the browser's clock, with the same code. Its tests move over, with two-screen ones added.
- Ducking and pausing for a video's sound follow the slides, so they happen together too.
- **Event audio:** starts and ends at its times on every screen. At its start the event's show starts a new track (its `startedAt` moves to that moment, `after` the track its timeline was on). At its end the Server starts every other show again (`startedAt` then, `after` the track it was on when the event began), which keeps the owner's rule "afterwards, the next track".
- **A change to a show** (its tracks, order, transition or fade) takes effect when the track on at that moment ends, as a playlist change does, and the new timeline starts there, after that track; the volume changes at once. The Server keeps the timelines in memory (`services/audioTimeline.js`); after a restart every show starts again from its first track.

**Decided (the owner, 2026-09-28): like a radio.**
- When the screens come back to a slideshow whose music was playing before, today each screen plays **the next track**. In step, the simplest and steadiest rule is **"like a radio"**: each show plays all the time on its timeline, and a slideshow joins its show wherever it is now, often mid-track.
- The alternative is for the Server to restart the show at a new track every time its slideshow comes back on. It's possible, but each such return is one more moment when all the screens must switch music together, and it's more to go wrong.
- **Chosen:** like a radio. Each show plays all the time on its timeline, and a slideshow joins its show where it is now.

**Affects:**
- server: `playlistService` (`startedAt`, boundaries), `audioPlaylist` (each show's `startedAt`, re-anchoring after an event), `displaySocket` (the time events), `schedulerService` / the event clock (the boundary of a change);
- viewer: `serverClock.js` (new), `slideshowClock.js`, `SlideShow.vue`, `VideoSlide.vue` (start at a point, drift), `BackgroundAudio.vue`;
- shared: `audioPlayer.mjs`, `slideTimeline.mjs` and `musicTimeline.mjs` (new); server: `playlistTimeline.js` and `audioTimeline.js` (new);
- contract: the two time events (added).

**Risks:**
- The slide clock is the heart of "runs for months", so its rewrite keeps every current test and scenario (outages, freezes, crashes, updates) and adds two-screen ones.
- Open screens with an older viewer ignore `startedAt` and the time events, and carry on as today until they reload.
- The payloads only gain keys, so the socket and contract recordings are re-recorded on purpose.

**Tests:**
- unit, over simulated time: offsets and round trips; two screens with clocks minutes apart on the same slide and track, through playlist changes, outages and sleeping pages; seeded shuffle giving the same order everywhere; drift correction;
- browser: two viewers in the same browser, each in its own window, with different clock offsets (CDP `Emulation.setVirtualTimePolicy` is too coarse, so a test-only clock offset through `?debugClockOffset`, which only a test sets) showing the same slide and the same track at the same time;
- the viewer-reliability scenarios unchanged;
- on the owner's Pis: two screens side by side, and a Server and a Client in one room.

**Phases** (each tested, committed):
1. **Done:** the server clock and the time events.
2. **Done:** the slide timeline.
3. **Done:** the music timeline.
4. Docs, the full run, the Pi check.

## 19. Versions

**Rules** (the owner, 2026-09-28)
- Versions are MAJOR.MINOR.PATCH. **1.0.0 is the version with Display Groups**; until then they are 0.x.
- A merge into main that brings new features raises MINOR (PATCH back to 0). One that only fixes bugs, or only tidies without changing what users see, raises PATCH.
- Work in progress names the version it will become (§18's table, and the line at the top of this document). The version of main changes only when that work is merged, in the merge commit, together with this section.
- A bug fixed on its own (§16, §18) is a patch release, listed here with what it fixed; a bug fixed inside a feature branch is listed with that version.
- **Merged together** (the owner, 2026-09-28): the words Server and Client (§18.4) and the Known Issues fixes (§18.5) are built on `feature/audio-support` and merge into main with audio as one item, after the check on a real Pi; each keeps its own version number here, and main moves from 0.5.0 to the last of them at that merge.
- **Each bug fix counts as its own patch number,** even when several are done together (the owner, 2026-09-28): e.g. §18.5's twelve items are 0.6.2 to 0.6.13, and wording or documentation work such as §18.4 is a patch too.
- `package.json` (the root, `client/admin` and `client/display`) still says 1.0.0, npm's default; nothing reads it. Setting it to the version here is for the owner to decide (by hand, with the matching top entries of `package-lock.json`, never with npm install on Windows).

**Current:** main is **0.5.0**. On `feature/audio-support`, done and waiting for the check on a real Pi, then one merge into main: **0.6.0** "Audio" (§18.3), **0.6.1** (§18.4 the words Server and Client), **0.6.2–0.6.13** (§18.5 the Known Issues, one per item). Planned: **0.7.0** (§18.8 every screen in step, on the audio branch before the merge), then **0.8.0** (§18.6 Releases) and **0.9.0** (the installer and update redesign, planned).

**History** (numbered after the fact for everything before 0.6.0)

| Version | Date | Reached main | What it brought | Bugs fixed |
|---|---|---|---|---|
| 0.1.0 | 2026-04-28 | direct commits | The prototype: the server foundation (config, MAC filter, routing), the admin panel, multiple file uploads | |
| 0.2.0 | 2026-09-26 | direct commits | Installable and unattended: one installer with auto-update and a sudo check, fast restart and display reload after updates, the device address button, the sample slideshow and "No slideshow published" screen, the user guide in the admin panel, displays that keep cycling for months, choosing the update branch in the admin panel and returning to main after a merge, the optional firewall check, the kiosk only for the viewer with an exit button, system-requirements.json | the kiosk on newer Raspberry Pi OS; slides stuck on processing when several were uploaded at once; the admin login page reloading itself endlessly |
| 0.3.0 | 2026-09-27 | PR #1 "QALife updates" (8c39d54), then fc4ba53 | The viewer's exit control, location pin setting, cursor hiding and logo; the password warning; the admin at /admin on one port; slideshow durations, hide and unhide, sample protection, previews and video thumbnails; the admin panel on phones; the MAC filtering warning; the software check before switching branch; "run the installer again" notices; the sidebar's "Last updated" | |
| 0.4.0 | 2026-09-27 | PR #2 "Reorganise the code…" (3b4f77c) | The refactor (12 stages, the test suite in the repository, the System Design); slides that always fit the screen on a background colour; the updater's warnings on every admin page and a warning mark on every screen | the location pin's pop-up pointing the public to the admin panel |
| 0.5.0 | 2026-09-28 | merge of QALife-updates (e2deb54) | Slide names; admin cards that fold to their title; Delete All; the update schedule; Restore Defaults; new videos in H.265 with a format setting, converting existing videos, and videos keeping to time; module comments brought up to date; MAC filtering's network requirements in the README and Help | the merged-notice test failing on a clean working tree |
| 0.6.0 | on the branch | `feature/audio-support` | "Audio": audio shows with tracks, order, crossfades, volume and a preview; background audio for slideshows; video sound; event audio (§18.3). The README's new opening | |
| 0.6.1 | on the branch | `feature/audio-support` | The words Server and Client everywhere, and the supported devices (§18.4) | |
| 0.6.2 | on the branch | `feature/audio-support` | | the live connection (socket.io) wasn't MAC filtered |
| 0.6.3 | on the branch | `feature/audio-support` | installer version 4 | the Server's own screen ignored a changed port (the kiosk had 3000 built in) |
| 0.6.4 | on the branch | `feature/audio-support` | | an empty client address counted as the Server itself |
| 0.6.5 | on the branch | `feature/audio-support` | a Port card in Settings, and "Restart the Server" | the port wasn't checked, and a change needed a restart by hand |
| 0.6.6 | on the branch | `feature/audio-support` | | the unused npm packages item closed (the packages left in, the owner's choice) |
| 0.6.7 | on the branch | `feature/audio-support` | | the media route's audio extensions reviewed: still an issue, reported (§16) |
| 0.6.8 | on the branch | `feature/audio-support` | | reorder errors were ignored |
| 0.6.9 | on the branch | `feature/audio-support` | | an unreadable config.json was overwritten with the defaults |
| 0.6.10 | on the branch | `feature/audio-support` | | MAC filtering's settings were saved as sent, whole |
| 0.6.11 | on the branch | `feature/audio-support` | | the default duration not resending the playlist: kept as it is (the owner's choice) |
| 0.6.12 | on the branch | `feature/audio-support` | | a message's timer could clear a later message |
| 0.6.13 | on the branch | `feature/audio-support` | the Display card warns about videos in the other format | |
| 0.6.14 | on the branch | `feature/audio-support` | `?debug=audio` on the viewer | a video's sound silenced the background music on a Pi (every sound is now 48 kHz) |

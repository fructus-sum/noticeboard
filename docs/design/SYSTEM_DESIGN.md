# Noticeboard — System Design

**What this document is:** how the Noticeboard code works: its parts and how they talk to each other, the files and formats it keeps, the operating-system set-up, what installed Servers and Clients and open screens rely on, and what is shared or still written twice. It describes only what exists in the code, and (§18) the changes planned or in progress. The README gives an overview and says how to install it; the user guide (`noticeboard-guide.html`) is for the people running a noticeboard.

**Keeping it up to date:** every planned change starts in §18, before any code. Then change this document in the same commit as the code it describes, so it is always a live view of the software and of the work in progress. Code comments refer to it as `SYSTEM_DESIGN §<n>`, and to the entries of §14 by their D-number: when a number changes, update those comments too (search the code for `SYSTEM_DESIGN`).

**Version:** main is **0.7.1** (since the merge of `feature/audio-support`, 2026-09-28: audio, the words Server and Client, the Known Issues, the fix from the Pi test, every screen in step, and Branding first on the Settings page). Next: **0.8.0** (Releases) and **0.9.0** (the installer and update redesign), on `feature/releases-installer`. 1.0.0 is the version with Display Groups. The rules and the history are in §19.

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
│  Client + Server: noticeboard-client kiosk ── chromium                │
│    --kiosk http://localhost:<port>/   (desktop autostart, or cage)    │
└──────────────▲───────────────────────────────────▲────────────────────┘
               │ HTTP + socket.io                  │ HTTP (admin panel)
┌──────────────┴──────────────┐           ┌────────┴───────────────┐
│ Client (0..n)               │           │ Any browser on the LAN │
│ noticeboard-client kiosk    │           │ /admin (password)      │
│   ── chromium --kiosk URL   │           │ / (viewer)             │
│ (autostart, or cage)        │           └────────────────────────┘
│ (no repo, no Node.js)       │
└─────────────────────────────┘
```

Set up by one installer, on Raspberry Pi OS or Debian, with a desktop or headless (the owner's words, §18.4: hardware is named only where it matters). A device is a **Client + Server**, a **Client only** or a **Server only** (§8, §18.7):

- **Server:** the device running the Noticeboard server. It runs Node.js, stores all content, hosts the admin panel, and updates itself from GitHub. As a Client + Server it also shows the slideshow full screen on its own screen, through its Client; a Server only has no screen of its own.
- **Client:** what shows the Noticeboard viewer full screen: the Client's files in `/opt/noticeboard-client/` (`noticeboard-client kiosk`), started by the desktop's autostart, or headless by `noticeboard-kiosk.service` (cage). A Client only runs Chromium pointed at its Server's URL. It has no copy of the repository: the viewer it shows is served by the Server, so it gets new viewer code when the Server updates, and its own files follow the Server's version by themselves (`noticeboard-client check`, a bundle the Server signs, §18.7 phase 3).

**Supported devices:**

| Device | Server | Client | Video | Status |
|---|---|---|---|---|
| Raspberry Pi 3 | yes | yes | H.264 only, 1080p only | Supported (H.264 chosen in Settings) |
| Raspberry Pi 4 | yes | yes | H.264 and H.265 | Supported |
| Raspberry Pi 5 | yes | yes | H.264 and H.265 | Supported |
| Orange Pi Zero 2W | no | yes, headless | H.264 and H.265 | The installer can set it up as a headless Client (0.9.0, §18.7); not yet checked on the device |
| A PC or virtual machine with Debian | yes | yes, with a desktop or headless | depends on the hardware | The installer can set it up (0.9.0); not yet checked on real hardware |

New videos are H.265 (HEVC) by default; H.264 is the fallback for older hardware (`display.videoFormat`, D43). The viewer plays one format, the one selected; a video in the other format is left to fail on a screen that can't play it.

---

## 2. Repository layout

```
noticeboard/
├── .github/workflows/tests.yml  the full test run on GitHub Actions for every push (§17)
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
│   ├── lib/                   its steps: ui, branch, json, release, answers, system, sudo, server, client, desktop, firewall
│   │                          (branch.sh and json.sh are also loaded by update.sh; schedule.sh only by update.sh)
│   ├── client/                kiosk.sh, noticeboard-client: the Client's files, installed as they are
│   └── update.sh              the self-updater run by systemd on the Server
├── server/                    CommonJS, Express 4, socket.io 4
│   ├── index.js, app.js       the entry point (systemd runs server/index.js) and the Express app
│   ├── config/                defaults.js (a new config.json), passwordDefaults.js (the default password)
│   ├── middleware/            access.js (MAC filter, admin check), macFilter.js and adminAuth.js (their names),
│   │                          asyncRoute.js, uploads.js, passwordLimiter.js, errorHandler.js
│   ├── realtime/              displaySocket.js (socket.io: the live connection to the displays)
│   ├── routes/                index.js (mounting), spa.js (the apps' catch-all and "not built" page)
│   │   └── api/               index.js, auth.js, device.js, client.js, slideshows.js, slides.js, audioshows.js, tracks.js, mediaItems.js (the items' routes)
│   │       └── settings/      index.js, general.js, security.js, logo.js, updates.js, maintenance.js (the Settings page)
│   ├── services/              configService, showStore, slideshowStore, audioShowStore, slideshowRules, audioShowRules,
│   │                          playlistService, audioPlaylist, audioEvents, audioEventClock, displayEvents,
│   │                          schedulerService, settingsService, adminPassword, adminSession, macService,
│   │                          mediaService, mediaTypes, mediaNames, uploadQueue, brandingService, sampleSlideshow,
│   │                          contentReset, actionTokens, clientBundle
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
└── tests/                     run.js (the runner: unit, api, browser, installers, upgrade, all), snapshot.js (a run on
                               a snapshot of a commit), helpers/,
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
| `/usr/local/sbin/noticeboard-system` | `noticeboard-system.path` (when `tmp/system-request` exists) | root | The system step (oneshot, at most 45 min): runs main's latest Release's installer with `--apply` when update.sh asks (§9.1, §18.7 phase 2) |
| `noticeboard-client kiosk` (a Client + Server) | XDG autostart `/etc/xdg/autostart/noticeboard-kiosk.desktop` at desktop login, or headless `noticeboard-kiosk.service` (cage on tty1) | desktop user | The Client's kiosk (`installers/client/kiosk.sh`): keeps Chromium in kiosk mode on `http://localhost:<port>/` |
| Chromium | the kiosk | desktop user | Shows the viewer (`/`) |

On a Client only, the same kiosk is started the same way; it shows a local waiting page (with the device's MAC addresses) until its Server answers, then runs Chromium in kiosk mode on the Server's URL. A Client only also runs `noticeboard-client check` as root (`noticeboard-client-update.timer`: 5 minutes after start-up, then every 15 minutes; oneshot): it follows the Client files its Server runs (§18.7 phase 3), and the kiosk starts again from the new files by itself when the version changes. A Server only runs neither.

### 3.2 Server start-up (`server/index.js`)

0. `contentReset.applyPendingRestore()`: when Restore Defaults left its marker (`data/restore-defaults`), it deletes the marker, everything in `data/` but `update-branch.env`, `installer.json` and `client-signing.key`, the files in `tmp/` but `update.lock`, and the logs (`app.log` emptied in place), so the server starts as a new install (D42).
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
- `ExitKiosk` appears unless `?kiosk=off` or `?kiosk=headless` (a Client without a desktop).
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
| `POST /api/device/kiosk-exit/claim` | macFilter | `{"exit":true\|false}`, consuming the request | **the Client's kiosk** (curl, exact string compare) |
| `GET /api/client/version` | macFilter | `{ version, commit, clientHash }` (services/clientBundle; §18.7 phase 3) | **`noticeboard-client check`** on a Client only |
| `GET /api/client/bundle` | macFilter | the installer at the running commit (tar.gz, made once per commit in `tmp/`) | **`noticeboard-client check`** |
| `GET /api/client/bundle.sig` | macFilter | its ed25519 signature (64 bytes, raw) | **`noticeboard-client check`** |
| `GET /api/client/key` | macFilter | the public key (PEM); the key pair made on first need | **the installer's Client step, `noticeboard-client trust-server`** |
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
| `GET /api/settings/updates/installer` | adminAuth | whether the installer needs running again: `{ required, installed, needed, changes, displays, clientsFollow, branch, ref, returning, automatic, systemFailed, lastByHand }` | InstallerNotice |
| `GET /api/settings/version` | adminAuth | `{ commit, date, installedAt, branch }` | NavBar |
| `GET /api/settings/updates/branches` | adminAuth | `git ls-remote --heads` | useUpdateInfo |
| `POST /api/settings/updates/check` | adminAuth | fetch the branch, validate it, requirements and installer needs | BranchSwitcher |
| `POST /api/settings/updates/verify-password` | adminAuth, 5 wrong per 15 min (shared, D40) | one-time token for the switch (5 min) | SwitchDialogs |
| `POST /api/settings/updates/switch` | adminAuth + token | writes the branch file, status and request | SwitchDialogs |
| `POST /api/settings/maintenance/verify-password` | adminAuth, 5 wrong per 15 min (shared, D40) | `{ password, action: 'delete-all' | 'restore-defaults' | 'restart' | 'full-update' }` → one-time token for that action (5 min) | DeleteContentCard, RestartNotice, FullUpdate |
| `POST /api/settings/maintenance/full-update` | adminAuth + token (action `full-update`) | `updates.fullUpdate`: main only, with the system step set up (else 409 and why); status `requested`, request `full` → the updates info | FullUpdate |
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
- The Client's kiosk relies on it: a 404 on `/` means "waiting for approval".
- A wrong password inside the admin panel gives **403**, not 401, because a 401 makes the panel jump to the login page.

### 4.2 Files used as a channel between the server and `update.sh`

| File | Server side | update.sh side |
|---|---|---|
| `data/update-branch.env` | `updateFiles.saveSwitch` writes `NOTICEBOARD_BRANCH=<b>`; `updateFiles.readBranchSetting` reads it | reads `NOTICEBOARD_BRANCH` and `NOTICEBOARD_MAIN_AT_SWITCH` (the latest Release's commit at the switch; main's commit when an older update.sh switched); `write_branch_setting` (lib/branch.sh) writes both |
| `tmp/update-request` | `requestSwitch` (`<time> <branch>`), `installNow` (`install-now`), `fullUpdate` (`full`), `setSchedule` and `setInstallAt` (`check`) write it; so does the `noticeboard` command (`install-now`, `full`) | the systemd `.path` unit starts `update.sh`, which deletes the file at once; `check` only checks, anything else may install; `full` also runs the system step |
| `tmp/system-request` | none | `run_system_step` writes the Release's commit; `noticeboard-system.path` starts root's system step, which deletes it |
| `tmp/system-result` | `readSystemResult` (the updates info, the installer notice: `systemFailed`) | root's system step writes `{ commit, release, result: done | failed | refused, message, time }`; `run_system_step` waits for it (and the `noticeboard` command shows it) |
| `data/update-schedule.env` | `updateFiles.saveSchedule` (`EVERY`, `TIME`, `DAY`, `SINCE`), `saveInstallAt` (`AT`); `readSchedule` | `lib/schedule.sh` reads it; `set_install_at` removes `AT` once its time has come (or sets it, when Update now finds the lock busy) |
| `data/restore-defaults` | `contentReset.requestRestore` writes it; `applyPendingRestore` deletes it at start-up | update.sh: while it exists, a run is a restore (reinstall into a clean folder, restart even after a failure) |
| `data/update-status.json` | `requestSwitch` writes `state: requested`; `getInfo` and `versionInfo` read it | `write_status` for every other state |
| `data/update-check.json` | `getInfo` reads it (the waiting version: `waitingUpdate`); `installerVersion.status` reads `installerFor` | `write_check`, with `installCheckedAt`, `fetchedAt`, `nextInstall`, `available`, `availableSubject`, `availableDate`, `availableRelease` (on main, the waiting Release's tag) and `installerFor` (the tag of a Release with the followed branch's work that waits for the installer; kept by runs that don't look again) |
| `data/update-notice.json` | `getNotice` reads it; `dismissNotice` deletes it | `returned_to_main` writes it (with the Release's tag, `release`) |
| `tmp/noticeboard-uploads/*` | multer puts uploads here; the queue deletes them | a file younger than 60 min means "upload in progress, wait" |
| `tmp/update.lock` | none | `flock`, also held by `install.sh` |
| `data/installer.json` | `installerVersion.installedVersion` reads it | written by `install.sh`; `installer_behind` reads its `version` |
| the Releases' tags (`refs/tags/vX.Y.Z` in the install folder's git) | `releases.releaseAt` names the running Release from them (the version shown); `releases.latestRelease` fetches the tag it checks | `fetch_release`, `branch_merged` and `remember_main` fetch each tag they use (and `install.sh`'s `main_ref`) |

### 4.3 Kiosk scripts ↔ server

- **Readiness.** `curl … <base>/`, the base being `http://localhost:<port>` on a Client + Server and the saved Server address on a Client only: 200 = show the viewer, 404 = MAC not approved, anything else = Server unreachable.
- **Exit** (with a desktop only). `curl -s -X POST --max-time 3 <base>/api/device/kiosk-exit/claim` every 3 s, compared with the exact string `{"exit":true}`. Headless, the viewer opens with `?kiosk=headless` and nothing is asked.
- **Leaving kiosk mode.** Kill the kiosk browser, then run `<browser> --no-first-run <base>/?kiosk=off`.

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
| `port` | number | 3000 | index.js; update.sh, install.sh and a Client + Server's kiosk via `configIO.readConfig` | `PUT /settings` (a whole number from 1024 to 65535, the contract's `limits.port`; takes effect after a restart: services/restartState) |
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
| `NOTICEBOARD_INSTALLER_SHA`, `NOTICEBOARD_INSTALLER_BRANCH`, `NOTICEBOARD_INSTALLER_RELEASE`, `NOTICEBOARD_MODE`, `NOTICEBOARD_INSTALL_BRANCH` | install.sh, set when it re-runs itself | install.sh |
| `NOTICEBOARD_GITHUB_API` | tests only (a stand-in for https://api.github.com) | lib/release.sh, updates/releases.js |
| `NOTICEBOARD_API_RATE_LIMIT` | tests only (a test that clicks faster than a person) | routes/api/index.js, the API rate limit (120 a minute per address) |

### 5.3 Hard-coded settings (not configurable)

- **Admin:** default password `Admin@12345` (`config/passwordDefaults.js`); JWT lifetime 7 days and cookie `nb_admin_token` (`services/adminSession.js`); new passwords at least 8 characters (`shared/contract.json` `limits.passwordMinLength`).
- **Rate limits:** API 120/min; login 5/15 min; the password checks inside the admin panel (branch switch, Delete All) 5 wrong/15 min, counted together.
- **Uploads:** 500 MB per file, 50 files; logo upload 20 MB; logo fits within 500×500.
- **Scheduler and viewer:** at most 5 active slideshows; scheduler interval 60 s; display clock constants in `slideshowClock.js`.
- **Updates:** a stale update counts after 60 min; a password-check token lasts 5 min; timer every 15 min (the schedule decides when a run installs; manual mode checks once a day); kiosk exit request expires after 60 s.
- **Kiosk:** a Client + Server's kiosk reads the port from `config.json` each time it waits for its Server.

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
| `data/client-signing.key` | PEM (PKCS#8 ed25519 private key), mode 600 | services/clientBundle (on first need) | services/clientBundle (signing the Client bundle, the public key) | nobody | **every Client only** (their pinned `server.pub`); kept by Restore Defaults (`KEPT_DATA`), never touched by updates or branch switches (0.9.0) |
| `data/backups/<time>-from-<branch>/…` | copies of the `.json`/`.env` files in `data/` | update.sh before a branch switch | the admin (manually) | none | recovery |
| `tmp/noticeboard-uploads/upload-*`, `logo-*` | uploaded files | multer (slides, logo) | uploadQueue, brandingService | deleted after processing | **update.sh** (upload-in-progress check) |
| `tmp/update-request` | text | requestSwitch | the systemd path unit, update.sh | update.sh deletes it; install.sh deletes it | instant switches |
| `tmp/client-bundle-<commit>.tar.gz`, `….sig` | the installer at that commit (`git archive`) and its signature | services/clientBundle (on the first request for that commit) | GET /api/client/bundle, bundle.sig | nobody (deleted by Restore Defaults) | Clients only updating (0.9.0) |
| `tmp/system-request`, `tmp/system-result` | a commit; flat JSON `{ commit, release, result, message, time }` | update.sh; `noticeboard-system` (root) | `noticeboard-system.path`; update.sh, updates/updateFiles | `noticeboard-system` deletes the request | root's system step (0.9.0) |
| `tmp/update.lock` | empty | update.sh / install.sh | flock | none | mutual exclusion |
| `tmp/update-failed-commit` | a SHA | update.sh | update.sh | update.sh | skipping a bad commit |
| `logs/app.log` (+ rotated `app1.log`, …) | winston JSON lines, 5 MB × 3 | logger | people | logger | troubleshooting |
| `/opt/noticeboard/.env` | env file (must exist: the unit's `EnvironmentFile=`) | install.sh (only if missing) | systemd | nobody | `SECURE_COOKIES` |
| `/opt/noticeboard/start-kiosk.sh` (untracked in git; only on a Server installed before 0.9.0) | bash | installers before 0.9.0 | their autostart; **updates/installerVersion** (installer version heuristic, without `installer.json`) | the installer removes it (0.9.0) | the old Server kiosk |
| `client/admin/dist/`, `client/display/dist/` | built SPAs | `npm run build` (install.sh, update.sh) | Express static; displayBuildId | every build | viewer and admin |

Outside the install folder:

| Item | Created by | Purpose |
|---|---|---|
| `/etc/systemd/system/noticeboard.service`, `noticeboard-update.{service,timer,path}` | install.sh | server and updater |
| `/etc/systemd/system/noticeboard-system.{service,path}` | install.sh (a Server, installer version 6) | root's system step |
| `/usr/local/sbin/noticeboard-system`, `/usr/local/bin/noticeboard`, `/usr/local/lib/noticeboard/{branch,json,release}.sh` | install.sh (`write_root_files`) | root's own files: the system step, the command, the installer's parts they load |
| `/etc/xdg/autostart/noticeboard-kiosk.desktop` | install.sh (a Client with a desktop) | runs `noticeboard-client kiosk` at login |
| `/etc/systemd/system/noticeboard-kiosk.service` | install.sh (a headless Client) | cage on tty1 running `noticeboard-client kiosk` |
| `/etc/noticeboard/install.env` | install.sh (`save_answers`) | the saved answers: role, platform, Server address, user (the kiosk reads them) |
| `/opt/noticeboard-client/current/`, `version` | install.sh (`write_client_files`) | the Client's files and their version (on a Client only: the Server's version it follows) |
| `/opt/noticeboard-client/hash`, `installed.tar.gz`, `previous.tar.gz`, `skip` | `noticeboard-client check` (a Client only) | the Server's `clientHash`; the bundle installed and the one before it (rollback); a commit that didn't work, skipped until the Server offers another |
| `/etc/noticeboard/server.pub` | install.sh (`pin_server_key`), `noticeboard-client trust-server` | the Server's public key a Client only pinned; every bundle is verified with it |
| `/etc/systemd/system/noticeboard-client-update.{service,timer}` | install.sh (a Client only, installer version 7) | `noticeboard-client check` every 15 minutes, as root |
| `/tmp/noticeboard-kiosk-up` | the Client's kiosk | the version its viewer is up with (the rollback waits for it) |
| `/usr/local/bin/noticeboard-client` | install.sh (`write_client_launcher`) | the Client's command (runs `current/noticeboard-client`) |
| `/usr/local/bin/noticeboard-kiosk.sh` | installers before 0.9.0 (Client) | the old Client kiosk; the installer removes it |
| `~/Desktop/noticeboard-help.desktop` (or the XDG desktop directory) | install.sh | Help shortcut (`file:///opt/noticeboard/noticeboard-guide.html` on a server, `<SERVER_URL>/admin/help` on a Client only) |
| `~/.config/noticeboard-kiosk/` | Chromium | kiosk browser profile |
| `/tmp/noticeboard-waiting.html`, `/tmp/noticeboard-waiting-profile/` | the Client's kiosk | waiting page |
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
| The updater's notices on every admin page; the warning mark on every screen while the installer needs running again (by hand, or after a failed system step), or a newer version waits (any schedule) | `App.vue` (admin), `UpdateNotice`, `InstallerNotice`, `UpdateAvailableNotice`; `AdminWarning.vue`, `services/displaySettings` (`installerNeeded`, `updateAvailable`), `updates/installerVersion`, `services/updates` |
| Full update (main, the system step set up): the installer's system step, then the Release again (password, last chance) | `FullUpdate`, `ConfirmDangerDialogs`, `settings/maintenance.js`, `updates.fullUpdate`, update.sh (`full`), `noticeboard-system` |
| The `noticeboard` command on a Server: `update [--full]`, `status` | `installers/root/noticeboard` |
| Update schedule: every 15 minutes, every 2 hours, daily or weekly at a time, or manual; a waiting version with Update now, Set a time, or the automatic install | `UpdateSchedule`, `UpdateStatus`, `settings/updates.js`, `services/updates` (`schedule.js`, `updateFiles`), `installers/lib/schedule.sh`, update.sh |
| Exit button (kiosk with a desktop only), cursor hides when idle | `ExitKiosk.vue`, `useActivity.js`, device.js exit requests, the Client's kiosk |
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
| Software updates: status (on main the Release's version), branch switch with two confirmations (main: its latest Release, with a warning when that's older), software check, merged-branch notice, installer-needed box | `components/updates/` (SoftwareUpdates, UpdateStatus, BranchSwitcher, SwitchDialogs, UpdateNotice, InstallerNotice), `useUpdateInfo`, `services/updates`, `systemCheck`, update.sh |
| Sidebar: logo, By Fructus Sum, links, the version (on main, the Release's) and Last updated, collapse | `NavBar`, `NavIcon`, `useNav`, `useBranding` |
| Section cards fold away to their title (remembered; a card with a warning stays open) | `CollapsibleCard`, `useCollapsed`, and the eight cards that use it |
| User guide | `noticeboard-guide.html`, served at `/admin/help` |

---

## 8. Installation

Entry point: `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash`, or `sudo bash installers/install.sh`.

`install.sh` holds the configuration, the switch to the latest installer, the loading of its parts and `main()` (the root check, the switch, the loading, then `run_installer`: the questions and steps in order), which is called on the last line, so a half-downloaded script runs nothing. `set -euo pipefail`. The steps are in `installers/lib/*.sh` and the Client's files in `installers/client/` (§12.9).

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
3. **`load_modules`**: the parts from the same commit as the script. `NOTICEBOARD_INSTALLER_SHA=local`: next to the script. A commit: each file downloaded from `raw.githubusercontent.com/…/<sha>/installers/{lib,client}/…` into `mktemp -d`. Not set (the latest installer couldn't be fetched): next to the script if it's in a checkout, else downloaded at the followed branch. Each module is checked with `bash -n` and loaded, the Client's files (`CLIENT_FILES`: `kiosk.sh`, `noticeboard-client`) are checked with `bash -n` and read into `CLIENT_FILE_<name>`, the functions `main()` calls are checked, and the download is deleted. Anything missing or broken: an error and exit 1, before any change.
4. `run_installer`: `DESKTOP_USER=${SUDO_USER:-pi}` (the user the Noticeboard runs as, whose screen the Client uses), banner, `/dev/tty` check (questions are read from `/dev/tty`, because stdin is the script under `curl | bash`).
5. `load_answers` (`lib/answers.sh`: `/etc/noticeboard/install.env`, the saved answers), `choose_role` (1 Client + Server / 2 Client only / 3 Server only → `ROLE` both/client/server, and `MODE` server/display for what reads it; the default is the saved role, else a Server folder → 1, else an older Client's kiosk script → 2; `NOTICEBOARD_ROLE`, or an older installer's `NOTICEBOARD_MODE`, skips the question), `refuse_role_change` (a saved role and another chosen: an error before any change), the user check.
6. With a Server: `choose_branch`. If `update-branch.env` names a non-main branch, ask whether to keep it or go back to main.
   With a Client: `choose_platform` (1 Raspberry Pi with its desktop / 2 Debian with a desktop / 3 minimal or headless → `PLATFORM` pi/desktop/headless; the default is the saved one, else `detect_platform` in `lib/system.sh`: a display manager or a graphical default target means a desktop, `/proc/device-tree/model` a Raspberry Pi). Client only: `ask_server_url` (the default is the saved one, else an older kiosk script's `SERVER_URL=` line; `NOTICEBOARD_SERVER_URL` skips it).
7. `use_branch_installer`. Hand over to the installer of what will be installed, passing the answers (`NOTICEBOARD_ROLE`, `NOTICEBOARD_PLATFORM`, `NOTICEBOARD_SERVER_URL`, `NOTICEBOARD_INSTALL_BRANCH`, and `NOTICEBOARD_MODE` for an installer before 0.9.0): the chosen branch's if it differs from the branch the installer came from; on main, the latest Release's (`latest_release`, lib/release.sh), exporting `NOTICEBOARD_INSTALLER_RELEASE` so that installer doesn't hand over again. No Release published, or GitHub can't be asked: main's installer carries on (§18.6).
8. On a Raspberry Pi only (`is_raspberry_pi`): the sudo check below.
9. **`check_sudo_password`** (optional hardening):
   - Find the `NOPASSWD: ALL` rule for the user in `/etc/sudoers.d/*` and back it up to `/root/noticeboard-sudoers-backup`.
   - Comment the rule out in a copy and install the copy only if it passes `visudo -cf`.
   - Prove the user's password works through `sudo -S`, and restore the backup on any failure.
10. **Server install (`install_server` = `install_server_packages` (1–3), `install_server_code` (4–8), `install_server_services` (9–11)):**
   1. `update_system`: `apt-get update`, then `dist-upgrade` with `force-confold` and a 300 s lock wait.
   2. `apt-get install git ffmpeg curl` (Chromium is the Client's).
   3. `node_new_enough` (20.19+, 22.12+, or 23+), else NodeSource `setup_20.x` and `apt-get install nodejs`. Abort if still too old.
   4. Get the code: an existing `.git` gets `lock_install_dir` (flock on `tmp/update.lock`), removal of `tmp/update-request`, `fetch_branch` as the owner (falling back to main). Otherwise `git clone` as root, then the lock. Then `checkout --force -B <branch>` as the owner: a branch's latest commit, or on main `main_ref`: the latest Release's tag, fetched on its own (main's latest commit when none is published or GitHub can't be asked; it says so). The status message and the summary name the Release.
   5. `npm install`, `npm run build`, `npm prune --omit=dev`.
   6. If `data/config.json` is missing: `node -e "require('./server/services/configService').init()"`.
   7. `.env` if missing (`SECURE_COOKIES=false`).
   8. `save_branch_setting`: writes `update-branch.env` only if the branch changed, and always writes `update-status.json` (`state: updated`).
   9. `write_service`, `daemon-reload`, `enable`, `restart noticeboard`.
   10. `chown -R <user> /opt/noticeboard`.
   11. `write_update_units` (service, path, timer), `write_system_units` (the system step's service and path unit), `write_root_files` (`/usr/local/sbin/noticeboard-system`, `/usr/local/bin/noticeboard` and `/usr/local/lib/noticeboard/{branch,json,release}.sh`, root's, from the files read in: `ROOT_FILES`, `ROOT_LIBS`); enable the timer and the two path units.
   (`write_installer_record` → `data/installer.json` (`INSTALLER_VERSION=7`) comes last, in `run_installer`, after the Client: a run that stopped part way doesn't count.)
11. **The Client (`install_client`, `lib/client.sh`), for Client + Server and Client only:** `update_system` (Client only: a Client + Server's was done), `apt-get install chromium curl` (and `cage` when headless); `write_client_files` (the Client's files as read in → `/opt/noticeboard-client/current/`, root-owned, the installer's commit → `/opt/noticeboard-client/version`), `write_client_launcher` (`/usr/local/bin/noticeboard-client`, which runs `current/noticeboard-client`). With a desktop: `write_autostart "/usr/local/bin/noticeboard-client kiosk"` and `write_help_shortcut` (the guide on the Server: `file://…/noticeboard-guide.html`; a Client only: `<SERVER_URL>/admin/help`), and a headless service left from before is removed. Headless: `write_kiosk_service` (`noticeboard-kiosk.service`: cage on tty1 as the user, `Conflicts=getty@tty1.service`), enabled; no autostart. Then `remove_old_kiosks` (`start-kiosk.sh` and `/usr/local/bin/noticeboard-kiosk.sh` of installers before 0.9.0). A Client only also gets `openssl`, `write_root_libs` (`/usr/local/lib/noticeboard/{branch,json,release}.sh`, for `reinstall-stable`) and `write_client_update_units` (`noticeboard-client-update.{service,timer}`, the timer enabled): it follows its Server (§18.7 phase 3). Server only: the autostart and the old kiosks are removed instead. Then `save_answers`; a Client only then `pin_server_key` (no key pinned yet: `noticeboard-client trust-server` shows the Server's key fingerprint and pins it in `/etc/noticeboard/server.pub` after a yes; the Server out of reach or older than 0.9.0: it says the Client won't update itself until that's run); with a Server, `write_installer_record`.
12. The summaries: the Server's (URLs using `hostname -I` and `slideshow_port`, the default password, sudo status, logs, branch) and the Client's (what it shows, the sudo status for a Client only, how to stop a headless kiosk, and on a Raspberry Pi the screen-blanking advice).
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
**`install.sh --apply`** (root's system step, §18.7 phase 2): `apply_saved_installation` instead of `run_installer`: the saved answers (none: an error), no questions, no hand-over, sudo check, firewall or reboot; `install_server_packages` (the package list updated but no system upgrade: `APPLY`), `install_server_services --no-restart`, `install_client`, `save_answers`, `write_installer_record`. Never the code: update.sh installs it next. On a Client only, `noticeboard-client check` runs it from a verified bundle (`NOTICEBOARD_INSTALLER_SHA=local`): `install_client` only, never a key pinned.

14. With a Client: `offer_reboot` (Enter = `systemctl reboot`): the kiosk starts at start-up (a headless one started at once would take over tty1, where the installer may be running).

Where each step lives: §12.9. The prompts (`ask_yes_no`, `ask_choice`, `ask_port`, `ask_yes_in_time`) and the boxed `banner` are in `lib/ui.sh`, used by every step that asks or prints a heading.

---

## 9. Updates and branch following

### 9.1 `installers/update.sh`

Everything runs from `main()` on the last line, because `git checkout` replaces this file while it runs. `set -euo pipefail`. `INSTALL_DIR` is taken from the script's own location. Before `main()` it loads `installers/lib/branch.sh`, `json.sh`, `schedule.sh` and `release.sh` from its own commit, so a checkout can't swap them mid-run; if it can't, it stops before touching anything.

1. Work out `BRANCH`: `NOTICEBOARD_BRANCH` (a one-off) → `update-branch.env` → `main`. Also read `MAIN_AT_SWITCH`.
2. If running as root while the folder is owned by someone else, re-exec as the owner. Refuse to run as any other user.
3. Read the schedule (`read_schedule`), the time (`now_epoch`), and `installCheckedAt`/`fetchedAt` from the check file. If `tmp/update-request` exists, delete it at once; unless it says `check`, set `requested` and `force`. `--force` also sets `force`.
4. `flock -n tmp/update.lock`. If it's busy, write `status: requested` (for a switch, or for Update now, which also sets the schedule's `AT` to now so the next run installs) and exit 0.
5. `PREVIOUS_BRANCH` = the current symbolic ref, `CURRENT` = `HEAD`. `valid_branch`, else cancel and restore the setting.
6. The service must be `active` or `activating`, else `check: waiting`.
7. Uploads in progress (a file younger than 60 min in `tmp/noticeboard-uploads`) → `check: waiting`.
7a. **May this run install?** `due` when requested, when switching, or when `install_due` (lib/schedule.sh) says so. Otherwise it only checks; in manual mode, not at all if the last check was less than a day ago.
8. **Return to main once a Release has the branch's work** (§18.6), only when `due`, following a non-main branch and not switching: `branch_merged`.
   - Ask for main's latest Release (`latest_release`) and fetch its tag; unsure (none, or GitHub can't be asked): stay.
   - If the branch was deleted (`ls-remote` exit code 2), compare `CURRENT`.
   - Otherwise require the latest Release to have changed since the switch (`MAIN_AT_SWITCH`, the Release's commit then; without a record, the Release must differ from the branch's tip).
   - Then `merge-base --is-ancestor` into the Release's commit, or `merge-tree --write-tree` to detect a squash or rebase.
   - If it's in the Release but the Release needs a newer installer than `data/installer.json` records (`installer_behind`; no record: never waits), stay and keep its tag in `INSTALLER_FOR` (update-check.json's `installerFor`, the notice). Runs that don't look again keep it; following main or switching clears it.
   - Otherwise: `write_branch_setting main`, `switching=1`, `RETURNED_FROM`, `RELEASE`.
9. **The target.** On main, `fetch_release`: the latest Release's tag is fetched on its own (`+refs/tags/T:refs/tags/T`) and `TARGET` is its commit (`RELEASE` its tag). None published: a switch to main is cancelled, Restore Defaults reinstalls `CURRENT`, otherwise `check: up-to-date` saying so (exit 0). GitHub can't be asked: a switch is cancelled, otherwise `check: offline`. On another branch, `fetch_branch_tip`: `git fetch origin +refs/heads/B:refs/remotes/origin/B` and `TARGET = origin/B`; on failure a switch is cancelled, a deleted branch gives `check: error`, otherwise `check: offline`. `TARGET_NAME` is how messages name it ("Release v0.8.0 (abc1234)" or "abc1234 from B"), and the recovery command (`installer_url`) comes from the same place.
10. Record `fetchedAt`, and when `due` `installCheckedAt` (and remove a set time that has come). If `TARGET` equals `CURRENT`: when switching, check out the branch and write the notice or status. Always `check: up-to-date`.
10a. **Never backwards on main:** not switching and not restoring, a Release already in what runs (`merge-base --is-ancestor TARGET CURRENT`, e.g. a Server with newer commits of main from before the first Release) leaves it as it is (`check: up-to-date`). A switch to main or Restore Defaults installs an older Release.
11. A previously failed target (`tmp/update-failed-commit`) is skipped unless forced.
11a. **Not due:** `check: available` with the waiting commit, its subject and date (on main, its Release: `availableRelease`), and when it will be installed; exit 0.
12. `refuse_reason`: the target has files in `data tmp logs .env`, or (when switching) its `update.sh` lacks the text `update-branch.env`.
12a. **The system step** (main only, §18.7 phase 2): a Release whose `installer.version` is above the record (`installer_behind`), or a Full update (the request `full`), when the system step is set up (`system_step_ready`: `systemctl is-enabled noticeboard-system.path`): `run_system_step` writes `tmp/system-request` (the commit), sets `status: updating`, and waits for `tmp/system-result` with that commit (`sleep 5`, at most 45 min). Done: carry on. Failed, refused or no answer: the commit goes into `update-failed-commit`, `status: failed` with the step's message, exit 1: the code isn't touched. Not set up: a Full update fails saying to run the installer once by hand; otherwise the code installs as before (the installer notice asks for a run by hand). A Full update on a branch fails at once (its installer is run by hand), and a Full update skips the up-to-date and never-backwards exits: the Release is installed again.
13. On a switch, `backup_settings` → `data/backups/<time>-from-<prev>/`.
14. `status: updating`. `PORT = server_port` (node + configIO).
14a. **Restore Defaults** (`data/restore-defaults` exists): the run is due and forced, skips the merged-branch return, installs even when `TARGET` equals `CURRENT` (on main, the latest Release, even an older one than what runs), first cleans the folder (`clean_folder`: `git clean -ffdxq` keeping `RESTORE_KEEP`: `data/`, `tmp/`, `logs/`, `.env`, `start-kiosk.sh`, `node_modules/`, `client/*/dist/`), restarts the server even if the install failed and was rolled back (the server resets its data at start-up), and writes its status after the restart.
15. `install_commit`: `checkout --force -B`, `npm install --include=dev`, `npm run build`, `npm prune --omit=dev`. On failure: re-install `CURRENT` → `rolled-back`, or `failed`.
16. `wait_for_uploads` (at most 30 min), then `restart_server`:
    - `kill -TERM` the `MainPID`; systemd restarts the service.
    - Wait up to 90 s for a new PID that answers `GET http://localhost:$PORT/api/auth/status`.
    - On failure, roll back and restart again.
17. Success: remove the failed-commit file, write the status (`updated`, the switched message, or the merged notice), `remember_main` (records `NOTICEBOARD_MAIN_AT_SWITCH` after a switch to a non-main branch), `check: up-to-date`.

Every `write_check` also records `installCheckedAt`, `fetchedAt` and `nextInstall` (`next_install`), so the admin panel shows when the next automatic install is without working it out itself. **The schedule's rules** (`lib/schedule.sh`, D41): 15 minutes, every run; 2 hours, 2 hours since the last run that could install (or since the schedule was chosen, `SINCE`); daily and weekly, the first run at or after the chosen time since then, so a Server that was off catches up at its next run; manual, never by itself. A set time (`AT`) takes the place of the automatic install until it has come. Times are the Server's local clock; `NOTICEBOARD_NOW` sets the time for tests.

`write_json` (`lib/json.sh`, shared with the installer) builds flat JSON objects from strings in bash, stripping control characters and escaping `\` and `"`, and replaces the file atomically.

### 9.2 Server side (`services/updates/`)

- **`getInfo`:** git HEAD and branch, the Release running on main (`releases.releaseAt`: the highest `vX.Y.Z` tag on HEAD; `release` and `version`), the configured branch, the status file, the check file, whether the timer and path units are enabled (from the `*.wants` symlinks), whether a request is pending, and `busy` (requested or updating less than 60 min ago). `versionInfo` (the sidebar) adds the same `version`.
- **`checkBranch`:** what a switch would install: for main, its latest Release (`mainTarget`: `releases.latestRelease` asks GitHub and fetches the tag; none published → 409, GitHub unreachable → 502), with `older: true` when that's an ancestor of HEAD (the admin panel warns); for another branch, `branchTip` (`ls-remote`, fetch). Then the same refusals as `update.sh`, the commit's subject and date, and `requirementsOf(commit)`. The latter reads `system-requirements.json` at that commit, runs `systemCheck.checkRequirements`, and calls `installerNeeds`.
- **The switch has three steps:** `checkBranch`, then `verify-password` issues a one-time token, then `switch` consumes it and calls `requestSwitch`.
  - `requestSwitch` rechecks the branch and refuses missing software unless `acceptMissing`.
  - `updateFiles.saveSwitch` writes the branch file, then `status: requested`, then the request file, and restores all three on failure.
- **The schedule:** `setSchedule` and `setInstallAt` check the values (`updates/schedule.js`), save them (`updateFiles`) and write a `check` request, so update.sh records the new next install time within seconds; `installNow` writes status `requested` and an `install-now` request; `fullUpdate` (main only, with the system step set up, else 409 and why) writes status `requested` and a `full` request. `getInfo` adds the schedule, the waiting version (`waitingUpdate`: the check file's `available`, unless it is the running commit), whether the system step is set up (`systemStep`: its path unit's `*.wants` link) and its last answer (`lastSystemStep`); `updateWaiting` gives the screens' `updateAvailable`, on any schedule.
- **Installer-needed** (on main with the system step set up, `automatic`: only when its last run, for a Release not running yet, failed: `systemFailed` with its message; §18.7 phase 2): `installerVersion.installedVersion` reads `data/installer.json`, else estimates from `start-kiosk.sh` (contains `kiosk-exit` → 1, else 0; no file → null). It is compared with `installer.version` in `system-requirements.json`. `status()` also gives `ref`, where the installer command comes from (on main the running Release's tag, else the branch), and, while a Release with the followed branch's work waits for the installer (update-check.json's `installerFor`), that Release's needs instead, read from its tag, with `returning` (the notice then says to choose main when the installer asks). `lastByHand`: on main without the system step, for a version whose installer sets it up (6 on): the notice says this run is the last by hand. `installerNeeds`' `displays` (each Client needs one run as Client only) holds only while the record is below 7; from 7 on a change for the Clients gives `clientsFollow` (they follow by themselves) (§18.7 phase 4).

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
noticeboard-system.service   Type=oneshot (root), ExecStart=/usr/local/sbin/noticeboard-system, TimeoutStartSec=45min
noticeboard-system.path      PathExists=/opt/noticeboard/tmp/system-request
```

**A Client only's update units** (installer version 7, §18.7 phase 3):

```
noticeboard-client-update.service  Type=oneshot (root), ExecStart=/usr/local/bin/noticeboard-client check, TimeoutStartSec=20min
noticeboard-client-update.timer    OnBootSec=5min, OnUnitActiveSec=15min, RandomizedDelaySec=120
```

**Desktop:**
- XDG autostart runs `Exec=/usr/local/bin/noticeboard-client kiosk` (a Client with a desktop). Headless, `noticeboard-kiosk.service` runs `cage -s -- /usr/local/bin/noticeboard-client kiosk` on tty1 as the user (`PAMName=login`, `Conflicts=getty@tty1.service`, `Restart=always`), and Chromium gets `--ozone-platform-hint=auto` for cage's Wayland display.
- Chromium runs with flags that suppress error dialogs, the infobar, update checks and the first-run pages, with its own `--user-data-dir`, and (installer version 3) `--autoplay-policy=no-user-gesture-required`, so background audio plays without a click. A Client + Server's kiosk opens `http://localhost:<port>/`, the port read from `data/config.json` each time it waits for the Server (3000 if it can't be read).
- `xset` turns screen blanking off (X11 only; it's a no-op on Wayland/labwc; not run headless). On a Raspberry Pi, the summary says where to turn Screen Blanking off.

**Privileges:**
- The installer runs as root.
- The server and the updater run as the desktop user.
- The updater restarts the server by killing it (systemd restarts it), so it never needs sudo.
- On main, what only root can do goes to root's system step (installer version 6): it runs only main's latest Release's installer, downloaded from GitHub at the commit GitHub says is that Release's, never code from the app's folder; update.sh only asks (`tmp/system-request`) and reads the answer (§18.7 phase 2).
- On a Client only, root's `noticeboard-client check` runs an installer only from a bundle whose signature verifies with the Server key pinned at install (`/etc/noticeboard/server.pub`); `reinstall-stable` only from GitHub over HTTPS, at main's latest Release (§18.7 phase 3).

**Other integration:**
- **Logging:** the Client's kiosk uses `logger -t noticeboard-kiosk` and its updater `logger -t noticeboard-client` (the journal).
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
| `curl` | installers, the Client's kiosk | downloads, health and exit checks, GitHub's Releases API (`lib/release.sh`) |
| `chromium` / `chromium-browser` | the Client's kiosk | display |
| `cage` | `noticeboard-kiosk.service` (a headless Client) | the kiosk full screen without a desktop |
| `openssl` (1.1.1+, for `pkeyutl -rawin`), `tar`, `sha256sum` | `noticeboard-client` (a Client only) | verifying the Server's signed bundle, unpacking it, the key's fingerprint |
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

**`routes/api/client.js`**
- **Purpose:** what a Client only asks its Server for, to update itself (§4.1, §18.7 phase 3): `GET /version`, `/bundle`, `/bundle.sig`, `/key`. MAC filter only, like the viewer.
- **Uses:** services/clientBundle, asyncRoute. **Used by:** routes/api/index.js; `noticeboard-client` on a Client only, the installer's Client step.

**`routes/api/device.js`**
- **Purpose:** the server's addresses for the pin, and kiosk exit requests.
- **Functions:** `deviceOf` (loopback → `this-server`, else the plain address).
- **State:** the `exitRequests` Map.
- **Uses:** `network` (`lanInterfaces`, `plainAddress`, `isLoopback`).
- **Relied on by:** the Client's kiosk (exact JSON).

**`routes/api/settings/`**
- **`index.js`:** mounts the five parts under `/api/settings` (their paths don't overlap).
- **`general.js`:** `GET/PUT /` (settingsService), `/device` (network), `/my-device` (`req.clientMac`).
- **`security.js`:** `/security` and `/password` (adminPassword).
- **`logo.js`:** `/logo` GET/POST/DELETE (`logoInfo`, uploads with prefix `logo`, 20 MB, `LOGO_MIME`; brandingService; `displayEvents.displaySettingsChanged`).
- **`updates.js`:** the software-update routes and `/version` (services/updates, `jsonRoute`, `wrongPasswordLimiter`).
- **`maintenance.js`:** `/maintenance/verify-password` (the password for an action → its token; `wrongPasswordLimiter`) , `/maintenance/delete-all` (with the token: `contentReset.deleteAllContent`) `/maintenance/restore-defaults` (with the token: `contentReset.requestRestore`), `/maintenance/restart` and `/maintenance/full-update` (with the token: `updates.fullUpdate`).
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
- **Purpose:** `deleteAllContent()` → `{ deleted: [names], deletedAudio: [names] }`: every audio show (`audioShowStore.removeMany`, in one config write with every slideshow's `audioShow` removed; skipped when there are none, so the slideshows' entries stay as they are), then every slideshow but the sample (`store.removeMany`: one config write, then the folders), then `displayEvents.playlistChanged()` (the audio reaches the screens through the config change). `requestRestore(by)`: the marker, the status and the `restore-defaults` request (D42). `applyPendingRestore()` (start-up): the reset itself. `KEPT_DATA`: `update-branch.env`, `installer.json`, `client-signing.key` (every Client only has its public key pinned).
- **Uses:** slideshowStore, audioShowStore, slideshowRules (`isSample`), displayEvents, services/updates (`updaterReady`, `updateFiles.saveRestoreRequest`), pathHelpers, logger. **Used by:** settings/maintenance.js, server/index.js.

**`services/clientBundle.js`**
- **Purpose:** the Server's side of "Clients follow their Server" (§18.7 phase 3): `version()` → `{ version, commit, clientHash }` (the Release's tag on main, else `<branch>@<short commit>`; a SHA-256 of `git ls-tree` of the installer's files at the running commit); `bundle()` → the tar.gz of `installers/install.sh`, `lib/`, `client/`, `root/` at the running commit (`git archive`, once per commit in `tmp/client-bundle-<commit>.tar.gz`) and its ed25519 signature (`.sig`); `publicKey()` → PEM. The key pair (`data/client-signing.key`, 600) is made on first need.
- **Uses:** updates/git, updates/releases (`releaseAt`), pathHelpers (`clientKeyPath`, `clientBundlePath`), Node crypto. **Used by:** routes/api/client.js.
- **Change impact:** every Client only's `noticeboard-client` reads these answers: the version's fields, the bundle's layout and the signature's form are §15 contracts.

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
- **`index.js`:** `getInfo`, `versionInfo`, `getNotice`/`dismissNotice`, `installerStatus`, `listBranches`, `checkBranch` (+ `requirementsOf`), `requestSwitch`, `setSchedule`, `setInstallAt`, `installNow`, `fullUpdate`, `waitingUpdate`, `updateWaiting`; re-exports `validBranchName`, `issueToken` and `takeToken`. Errors for the admin carry `expose`. Used by settings/updates.js, settings/maintenance.js (`fullUpdate`), displaySettings (`updateWaiting`).
- **`git.js`:** `git(args, timeout)` in ROOT, never prompting.
- **`branchName.js`:** `validBranchName`, the JS twin of `installers/lib/branch.sh` `valid_branch` (kept in step by `tests/installers/branch-names.sh`).
- **`releases.js`:** `latestRelease` (asks GitHub's Releases API, `NOTICEBOARD_GITHUB_API` or api.github.com, and fetches the tag; null when none is published), `releaseAt` (the highest `vX.Y.Z` tag on a commit), `versionName`. The JS twin of `installers/lib/release.sh` (D48).
- **`updateFiles.js`:** the one owner of the files shared with update.sh: `readBranchSetting`, `readStatus`/`readCheck`/`readNotice`, `deleteNotice`, `requestPending`, `unitsEnabled`, `readSchedule`/`saveSchedule`/`saveInstallAt` (`update-schedule.env`), `requestRun` (`check` or `install-now`), `saveInstallNow`, `saveSwitch` (the three writes in order, restored on failure).
- **`schedule.js`:** `EVERY`, `DEFAULT`, `parseSchedule`, `parseInstallAt` (a valid schedule and set time; the rules for when to install are only in lib/schedule.sh, D41).
- **`installerVersion.js`:** `installedVersion` (record, else the kiosk-script heuristic), `installerNeeds`, `status` (with `ref` and `returning`, §9.2). Also used by server/test/installer.test.js.

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
| `App.vue` | composition, `?kiosk=off` and `?kiosk=headless`, idle cursor, the background colour (`--nb-background`), the slideshow on air for the background audio | useSocket, useActivity, recovery, the six components | |
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
| `views/SettingsView.vue` | loads `GET /settings` once for the Display and MAC cards; the cards in order (Branding first since 0.7.1, then Display, MAC filtering, Port, Change password, Software updates, Delete content) | useApi, the settings and updates cards | |
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
| `components/updates/InstallerNotice.vue` | run-the-installer box (in the layout: every page; the box is `.page-warning`): the failed system step, the return to main, the last run by hand on main (`lastByHand`), one run on each Client as Client only (`displays`) or nothing to do on them (`clientsFollow`) | useApi, `@shared` installerCommand | |
| `components/updates/UpdateAvailableNotice.vue` | "Update available" whenever a newer version waits, on any schedule, with when it installs (in the layout: every page, nothing to close), linking to `/settings#updates` | useApi, useUpdateInfo (`when`) | |
| `components/updates/FullUpdate.vue` | in the Software updates card: "Full update…" on main with the system step set up, its last answer; following a branch, or before the step is set up, how to run the installer by hand | useApi, ConfirmDangerDialogs, useUpdateInfo, `installerCommand` | |
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

**`installers/install.sh`** (see §8): the configuration (including `INSTALLER_VERSION` and the list of parts), `main()`, the switch to the latest installer (`use_latest_installer`, `run_installer_from`, `use_branch_installer`, `followed_branch`: they run before any part is loaded, so they're in this file; `followed_branch` keeps its simple name check, which only chooses which installer to download) the loader (`load_modules`, `download_modules`, `load_modules_from`), `run_installer` (the questions and steps in order) and `apply_saved_installation` (`--apply`). Each part has the module header described at the top of this document.

| Part | What it has | Used by |
|---|---|---|
| `lib/ui.sh` | `has_tty`, `ask`, `ask_yes_no`, `ask_choice` (the numbered questions), `ask_port`, `ask_yes_in_time`, `banner`; `choose_role` (with `set_role`, `has_server`, `has_client`), `choose_platform`, `choose_branch`, `offer_reboot` | main, sudo, client, server, firewall |
| `lib/branch.sh` | `valid_branch` (the full rule), `read_branch_setting`, `read_main_at_switch`, `write_branch_setting` (atomic) | ui, server, **update.sh** |
| `lib/json.sh` | `write_json`, `json_string` | server (`update-status.json`), **update.sh** |
| `lib/release.sh` | `latest_release` (main's latest published Release: its tag, or none, or GitHub couldn't be asked), `release_tag_ref` (D48) | main (`use_branch_installer`), server (`main_ref`), **update.sh** |
| `lib/schedule.sh` | `read_schedule`, `now_epoch`, `iso_time`, `to_epoch`, `install_due`, `next_install`, `set_install_at` (D41) | **update.sh only** (not one of `INSTALLER_MODULES`) |
| `lib/answers.sh` | `load_answers` (→ `SAVED_*`), `refuse_role_change`, `save_answers` (`/etc/noticeboard/install.env`) | main, ui (the defaults), client (the saved URL) |
| `lib/system.sh` | `update_system`, `chromium_package`, `is_raspberry_pi`, `detect_platform`, `node_new_enough`, `lock_install_dir`, `slideshow_port` | server, client, firewall, ui, main |
| `lib/sudo.sh` | `check_sudo_password` and its helpers, `SUDO_STATUS` | main, the summaries |
| `lib/server.sh` | `install_server` (= `install_server_packages`, `install_server_code`, `install_server_services [--no-restart]`), `fetch_branch`, `main_ref` (main's latest Release, else its latest commit), `save_branch_setting`, `write_service`, `write_update_units`, `write_system_units`, `write_root_files` (with `write_root_libs`), `write_installer_record` (its own `printf`: `version` is a number), `summary_server` | main, `--apply` |
| `lib/client.sh` | `ask_server_url`, `install_client`, `write_client_files`, `write_client_launcher`, `write_kiosk_service`, `write_client_update_units` (a Client only), `pin_server_key` (a Client only, not with `--apply`), `remove_old_kiosks`, `summary_client` | main, `--apply` |
| `lib/desktop.sh` | `write_autostart`, `write_help_shortcut` | client |
| `lib/firewall.sh` | `check_firewall`, `setup_ufw`, the detection helpers, `firewall_reminder` | main |
| `root/noticeboard-system`, `root/noticeboard` | root's system step and the Server's command, installed exactly as they are (`ROOT_FILES`), with the parts they load (`ROOT_LIBS`: branch, json, release) | server.sh (`write_root_files`); `noticeboard-system.service`, people |
| `client/kiosk.sh`, `client/noticeboard-client` | the Client's kiosk and command, installed exactly as they are (`CLIENT_FILES`); the kiosk reads `install.env`, starts again from new files when the version changes and writes `/tmp/noticeboard-kiosk-up`; the command's `check`, `trust-server` and `reinstall-stable` follow the Server on a Client only (§18.7 phase 3) | client.sh (installs them); the launcher, the autostart, the headless service and `noticeboard-client-update.service` run them |

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
| `checkBranch` | same | settings/updates.js, requestSwitch | git, releases.latestRelease (main), requirementsOf | git objects, GitHub's Releases API | fetches a remote-tracking branch, or main's latest Release's tag | the switch checks shown to the admin |
| `installerVersion.installedVersion` / `installerNeeds` | services/updates/installerVersion.js | installerStatus, requirementsOf, test | configIO.readJsonFile, fs | installer.json, start-kiosk.sh, system-requirements.json | none | the home page installer box, switch warning |
| `versionInfo` | services/updates/index.js | settings/updates.js `/version` | git, updateFiles.readStatus, releases.releaseAt | HEAD and its tags, update-status.json | none | sidebar version and "Last updated" |
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
| D30 | The kiosk | `installers/client/kiosk.sh` only (since installer version 5) | One kiosk for a Client + Server and a Client only, with a desktop or headless: what differs is read from `install.env`. |
| D31 | Yes/no and 1/2 questions | `lib/ui.sh` `ask_yes_no`, `ask_choice` | |
| D32 | The installer's boxed headings | `lib/ui.sh` `banner` | |
| D33 | Reading and writing JSON files | `configIO`: `readJsonFile`, `writeFileAtomic` (temporary file `.<pid>.tmp`), `writeConfig` (`.tmp`) | |
| D34 | An update that never finished (60 min) | `services/updates` (`busy`) | UpdateStatus shows "Didn't finish" from the server's `busy`. |
| D35 | Telling the displays what changed | `services/displayEvents.js` | `configService 'change'` means only that config.json changed. |
| D36 | Async route handlers and their errors | `middleware/asyncRoute.js` (`route`, `jsonRoute`) | |
| D37 | The background colour's default and form; the video formats and their default | `shared/contract.json` `display` (`defaultBackground`, `colourPattern`, `videoFormats`, `defaultVideoFormat`) | Read by settingsService (checks a new colour or format; `videoFormat()`), brandingService (sends the colour) and, through `shared/index.js`, the viewer, the Branding card and the Display card. |
| D38 | Media names: the rule, and what the admin panel shows | `services/mediaNames.js` (the rule: trimmed, no control characters, at most `limits.mediaNameMax`); `mediaDisplayName` in `shared/index.js` (`name`, else `originalName`, else the type and date added) | For slides now, and for audio tracks later. Names stay in the admin panel: the playlist doesn't carry them. |
| D39 | Section cards that fold, and never hide a warning | `components/ui/CollapsibleCard.vue` + `useCollapsed` | Each card says when it needs attention: Change password (the default password), Software updates (an update running, the server restarting, the last attempt failed, rolled back or cancelled, an error message), Slides (a failed slide or upload). The page warnings sit outside the cards. |
| D40 | Asking for the admin password again before something that can't easily be undone | `services/actionTokens.js` (the one-time token, per action), `middleware/passwordLimiter.js` (wrong tries, counted together), `components/ui/ConfirmDangerDialogs.vue` (the dialogs), `.danger-dialog` in `styles/base.css` (their texts) | Used by the branch switch, Delete All, Restore Defaults, Restart and Full update. Each action keeps its own warning texts. |
| D41 | The update schedule: when an install is due | `installers/lib/schedule.sh` only (update.sh); it writes the next install time into update-check.json for the admin panel | The server only checks and saves the values (`updates/schedule.js`, `updateFiles`); `updateFiles.readSchedule` reads the file with the same defaults as `read_schedule`. A newer version waiting shows on every admin page (`UpdateAvailableNotice`) and screen (`updates.updateWaiting`) on any schedule (since §18.7 phase 2). |
| D42 | Restore Defaults: what is reset and what is kept | the server (`contentReset.applyPendingRestore`, `KEPT_DATA`) for data/, tmp/ and logs/; update.sh (`RESTORE_KEEP`, `clean_folder`) for the rest of the folder | Two lists on purpose: each side resets what it owns. The Client signing key is kept: a new one would stop every Client only updating until `trust-server` is run on each. A file the installer adds to the folder must go on `RESTORE_KEEP` (`tests/installers/update-restore.sh` checks every file the installer writes). |
| D43 | A video's format: choosing it, recording it, converting to it | `settingsService.videoFormat` (the choice), `mediaService` (`processVideo`, `videoFormatOf`), the slide's `format`, `videoConversion` (existing videos) | Uploads and conversions encode with the same `processVideo`; a slide without `format` is checked with ffprobe. **H.265 (HEVC) is the default** (the owner, 2026-09-28: smaller files); **H.264 is the fallback for older hardware** (a Raspberry Pi 3 can't decode H.265; Chromium on a Raspberry Pi 4 or 5 uses its hardware decoder; a PC's browser on its own, e.g. Firefox can't, so the admin panel's preview of a new video stays blank there). The setting chooses one format; the viewer never plays both on purpose: a video in the other format is left to fail on a screen that can't play it, showing nothing for its length (the slide clock, §3.5). The Display card warns while it's chosen, and while videos already uploaded aren't all in the saved format (`videoConversion.formats()`, `GET /settings/videos/formats`, since 0.6.13); *Convert existing videos* fixes that. Encoding H.265 takes several times longer than H.264 on a Raspberry Pi. |
| D44 | An audio show's settings and their limits | `shared/contract.json` `audio` (orders, transitions, fadeSeconds, volume; for a video's sound: withSound, lowerTo): `audioShowRules` checks, `audioShowStore` takes the defaults, the admin card offers them (`@shared` AUDIO) | |
| D48 | main's latest published Release, and the Release a commit is | `installers/lib/release.sh` `latest_release` (update.sh, the installer) and `updates/releases.js` `latestRelease` (the branch check); `releases.releaseAt` names the running Release (the version shown) | Two copies (bash and JavaScript) of one question to GitHub's API, with the same three answers: a tag; none published (a 404, or an answer marked draft or prerelease); GitHub couldn't be asked. Both honour `NOTICEBOARD_GITHUB_API`, and the tests stand in for the API with one set of files read by both (`tests/helpers/github.sh`, `github.js`). A Release's tag is `v` and its version (§19). |

---

## 15. External contracts an installed system relies on

An installed Server receives new code through the `update.sh` that is **already on disk**. The installer, the Client (and an older installation's kiosk scripts) and the systemd units change only when the installer is run again. The new code must therefore keep every one of these working:

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

**The Client's kiosk, and the kiosk scripts of installations from before 0.9.0** (not updated by sync)
10. `GET /` answers 200 when the device is allowed and 404 when MAC filtering blocks it.
11. `POST /api/device/kiosk-exit/claim` returns **exactly** `{"exit":true}` when an exit was requested, with no spaces.
12. `?kiosk=off` turns off the kiosk behaviours in the viewer; `?kiosk=headless` keeps them without the exit button.

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
18. These URLs must stay: `/`, `/admin`, `/admin/*`, `/admin/help`, `/media/<folder>/slides/<file>`, `/audio/<folder>/tracks/<file>`, `/branding/logo?v=`, and every `/api` path in §4.1 (the admin panel is rebuilt with the code, but the Client's kiosk and open tabs are not).

**Browser storage**
19. The keys `noticeboard:navCollapsed`, `noticeboard:collapsedCards` and `noticeboard:lastRecoveryReload` (merely nice to keep).

**The installer and the kiosk**
20. What older installers look for when they hand over: `installers/install.sh` must exist at every commit. It must pass `bash -n`, and for non-main branches contain a line starting with `INSTALLER_VERSION=`. **Older installers download only this one file.**
21. The installer version heuristic reads `/opt/noticeboard/start-kiosk.sh` (a Server set up before installer records existed).
21a. `/etc/noticeboard/install.env` (`NOTICEBOARD_ROLE`, `_PLATFORM`, `_SERVER_URL`, `_DISPLAY_USER`) is read by the Client's kiosk on every start and by the installer's next run: its names and format stay.
21b. Root's system step and update.sh talk through `tmp/system-request` (a commit) and `tmp/system-result` (`{ commit, release, result, message, time }`): an update.sh and a `noticeboard-system` from different versions must still understand each other. The `noticeboard` command writes the same `tmp/update-request` values as the admin panel.
21c. **A Client only follows its Server** (§18.7 phase 3) through `GET /api/client/version` (`{ version, commit, clientHash }`, flat JSON without quotes in the values), `/bundle` (a tar.gz with `installers/install.sh` at its root path, which takes `--apply` with `NOTICEBOARD_INSTALLER_SHA=local`), `/bundle.sig` (a raw 64-byte ed25519 signature over the whole file) and `/key` (PEM, SPKI): every Client only's `noticeboard-client` reads them, so their paths and forms stay. `data/client-signing.key` must survive every update, branch switch and Restore Defaults: a new key stops every Client only updating until `trust-server` is run on it.

**Releases** (§18.6: a Server on main installs main's latest published Release)
22. Every Release's tag is `v` and its version (`v0.8.0`), on a commit of main, and a Release is only published with the §19 checklist done. A Server on main installs whatever `GET /repos/fructus-sum/noticeboard/releases/latest` names, so a Release that isn't ready must stay a draft or prerelease; deleting a Release doesn't take a Server back (main never goes backwards by itself).
23. A Release's commit must meet 1 to 9 like any commit, and its `update.sh` and `install.sh` must keep following Releases: a Release whose updater went back to following main's commits would take every Server on main with it.

---

## 16. Known issues

Behaviour kept as it is until a change is planned for it (§18): fixing one changes behaviour, so it is designed, reviewed and tested on its own. The list was cleared for a stable base in 0.6.2–0.6.13 (§18.5; what each version fixed is in §19). What is left:

1. **The media route allows audio extensions** (`.mp3 .wav .ogg`) that nothing produces there. Reviewed after audio support (0.6.7): still an issue, reported and left as it is (the owner, 2026-09-28). Audio shows' tracks are `.m4a`, served only at `/audio`, and a slide is only ever an image or a video, so `/media` never holds audio. Harmless (the files would still be MAC filtered), but the allowlist is wider than it needs to be.
2. **Changing the default image duration doesn't resend the playlist** (kept as it is on purpose: the owner, 0.6.11; `tests/api/socket-events.js` records it). Slideshows without their own duration keep the old one on screen until the playlist is next sent: a publish, upload, reorder or delete, a scheduler change, or a display reconnecting.

---

## 17. Tests

Run them with `node tests/run.js <group> [filter]` or the npm scripts. A file that fails is followed by how it ended (exit code, signal, or why it could not start) and how long it ran. A file whose Node.js process crashed rather than failing a check (a signal, or a Windows crash code such as 0xC0000409, seen now and then on Windows, at any point in a test: after 0.7 to 5 s so far) is run once more, and the summary says so; one that fails a check is never run again. `socket-events.js` waits for the start-up job that makes the sample video's thumbnail (and fills in its length) before it connects: that job resends the playlist when it finishes, which now and then landed in the first step as a second, identical empty playlist (found through the Server's log, which the test prints when a step differs). `npm run build` must come first for api, browser and upgrade. The summary gives each file's time and each group's.

**Without waiting for them** (DEVELOPMENT step 4):
- **GitHub Actions** (`.github/workflows/tests.yml`) runs `npm ci`, `npm run build` and `npm run test:all` on Linux with Node.js 20 for every push and pull request; a newer push to the branch cancels the run still going. `npm ci` also proves `package-lock.json` installs on Linux (the Pi's packages, §11).
- **`node tests/snapshot.js [<commit>] [<group>] [filter]`** runs the tests on a snapshot of a commit (a git worktree in the temporary folder, with this checkout's `node_modules` linked in and removed link first), so the working tree can change meanwhile. Its log is `<temporary folder>/noticeboard-snapshot-<commit>.log`.
- **One run at a time in the api, browser and upgrade groups** (fixed ports, one Chrome): `run.js` holds a lock in the temporary folder only while it's in one of them, so unit and installer tests can run beside a background run.
- **The look snapshots are per system** (`lookFixture` in tests/helpers/app.js): fonts, and so sizes, differ, so Windows's are in `tests/fixtures/` and Linux's in `tests/fixtures/linux/`. Actions records Linux's when missing and keeps them as the `linux-look-snapshots` artifact, to commit. A deliberate change of look is re-recorded on both. Actions uses Google Chrome (`CHROME_PATH`): the runner's Chromium can't play AAC or H.264/H.265, which a Pi's can; the browser tests get Node.js 20's `--experimental-websocket`.

| Group (npm script) | Where | What it covers | Needs |
|---|---|---|---|
| unit (`npm test`) | `server/test/`, `client/display/test/` | the Server's clock as a screen tells it (6: exact offsets, the shortest round trip winning, odd answers ignored, two screens minutes apart agreeing); the slide clock (13 tests: the timeline, failing slides keeping their place, hidden and frozen pages catching up, playlist changes, 30 simulated days with two screens whose clocks are minutes apart); the slide timeline (5) and the Server's playlist timeline (5: at once with nothing on, a change at the slide's end, the same playlist ignored, going back cancelling a switch); event audio's rules and the weekly rule (8: each mode, start now ended by a scheduled event, `nextChange`, clashes of every pair of modes, `eventState`, a simulated fortnight minute by minute); the audio engine (17: each track at its time, joining mid-way, two screens with clocks minutes apart on the same track and point all day, drift put back, crossfade timing, show volume, switching shows, fading out, coming back like a radio, a new timeline from the Server, failing and stalling tracks, a refused play retried every minute or at once with `retryNow`, duck/pause/resume, the preview's own timeline, a simulated day of crossfades without timers piling up); the music timeline (5) and the Server's audio timelines (5: a new show, the volume at once, a change at the track's end after it, going back cancelling it, an event and after it); installer version ↔ system requirements (5); the Node.js version rule in installers/lib/system.sh ↔ system-requirements.json (1); the shared foundations: address helpers, both loopback rules, media type lists, contract event names, and `shared/index.js` ↔ the server (mediaUrl, LIMITS), the media name rule and mediaDisplayName (9) | Node 20+ |
| api (`test:api`) | `tests/api/` | **full-update.js**: Full update (the password, the token, main only, the system step set up, one at a time), the installer notice after a failed system step, the screens' mark for a version waiting on a daily schedule. **client-updates.js**: what a Client only asks for (the version on main at a Release and on a branch, the key made on first need, the bundle's contents, its signature checked by Node and by openssl, the same hash after a change outside the installer and a new one after a change inside). **contract.js**: 106 entries recorded in `tests/fixtures/api-contract.json`. They cover every route's status, content type and JSON shape, the exact MAC-denied page (seen from the PC's network address), the kiosk-exit answer, the cookie attributes, the socket events and a playlist. Also: branch switching end to end with the real update.sh (31 checks), the slideshow lifecycle, upload errors and stress, graceful shutdown, one admin check per request (`admin-check-once.js`, from the debug log), **the data files byte-for-byte** for a fixed script of actions (`data-files.js` ↔ `tests/fixtures/data-files.json`), the store's edge cases (`slideshow-store.js`), audio shows (`audio-shows.js`: defaults, limits, tracks converted to AAC with their length and name, rename, reorder, delete, `/audio`), MAC filtering's settings (`mac-settings.js`: only the fields sent change, MACs normalised and checked, no duplicates, the Server's own entry kept, a bad change refused and nothing changed), an unreadable config.json (`config-recovery.js`: the last good copy kept on save, a broken file kept and the copy restored, the note until dismissed, no copy: the defaults), the port and restarting (`restart.js`: the port's range, `restartNeeded` in the API and on the screens, the token, the Server stopping and coming back on the new port), MAC filtering on the live connection (`socket-mac.js`: refused at connect through the PC's network address, the Server itself allowed, a connected device dropped when filtering is turned on), background audio (`audio-update.js`: a slideshow's audio show checked and stored only when chosen, `audio:update` with the playlist and only when it changes, published shows with ready tracks only, deleting a show clears it), event audio (`audio-events.js`: the modes and times checked, overlaps refused naming the other show, `eventState`, `audio:update`'s `event` for a start-now event, a running once event taking over, unpublished, stopped), a video's own sound (`video-sound.js`: videos only, the choices and limits, off removing the keys, the playlist's keys only on that video), the update schedule's routes and the screens' mark (`update-schedule.js`), the video format for new uploads and converting the existing videos (`video-format.js`: H.265 by default, H.264 when chosen, checked with ffprobe; other formats refused; each video's length in the playlist; a conversion showing each video processing in its turn while the screens keep its file, then replacing it; a second run changing nothing; a restart mid-way; the count of videos not in the saved format, before and after converting), Restore Defaults (`restore-defaults.js`: the request, then after a restart exactly the kept files (the Client signing key among them), default settings and password, a new session secret, the sample as new, no second reset), Delete All (`delete-all.js`: only the sample left, every audio show gone and the sample's choice of one cleared, settings and logo kept, the tokens, the playlist sent, the shared limit on wrong passwords), slide names (`media-names.js`: recorded on upload, with accents; renaming; the limits; no playlist sent and none carrying names), and **what a display receives for 15 admin actions** (`socket-events.js` ↔ `tests/fixtures/socket-events.json`), and the "app not built" pages (`spa-fallback.js`) | Node 22+; ffmpeg for video |
| browser (`test:browser`) | `tests/browser/` | Full update's dialogs, the failed-step notice and the branch text (`full-update.js`), branch-switching UI, installer notice, Last updated, login loop, MAC warning, mobile layout, sidebar, merged notice, the viewer and admin panel end to end (`viewer-and-admin.js`), slideshows and media with video (`slideshows-and-media.js`), the viewer's reliability under outages, freezes, crashes and updates (`viewer-reliability.js`, scenarios A–E), and the viewer controls' computed styles (`viewer-look.js` ↔ `tests/fixtures/viewer-look.json`), the admin panel's computed styles (`admin-look.js` ↔ `tests/fixtures/admin-look.json`, 82 elements on desktop and phone), the larger pages' computed styles and texts (`admin-pages-look.js` ↔ `tests/fixtures/admin-pages-look.json`: the slideshow page with its edit form, schedule and preview, the Settings cards, the branch check and the Missing software dialog; 57 elements and 6 texts), the login page (`login-page.js`), and the updater's warnings on every admin page and the viewer's warning mark (`warnings-everywhere.js`), slide names in the slide list, preview and delete question (`slide-names.js`), cards folding to their title without hiding a warning (`collapsible-cards.js`), a reorder that can't be saved shown in the slide list (`reorder-error.js`), a card's messages (`messages.js`: "Saved."'s timer never clears a later error, which stays until its ✕), screens in step (`screens-in-step.js`: two viewers, each in its own window so neither is a hidden tab, with clocks minutes out agreeing on the Server's time and showing the same slide; a third joining later going straight to it; all three switching together after a change; the slideshow's music playing the same track at the same point on all three), the Port card and the restart box (`restart.js`: on every page, password and last chance, the page moving to the new port by itself), the audio pages (`audio-shows.js`: create, settings, upload through the file picker, ▶/■, "Preview the show" with ⏭ and ■, rename, reorder, delete, the list), background audio (`background-audio.js`: the slideshow's choice and fact, the viewer following it, unpublishing, None, a click starting refused sound; a video's Sound switch, and on screen the video playing with the background lowered to its volume, then paused, and brought back; the Event audio card: Start now taking over a screen, Stop giving the slideshow's show back, an overlapping event refused), Delete All's card and dialogs, the audio shows listed (`delete-all.js`), Restore Defaults' warning and request (`restore-defaults.js`), the video format setting, its explanations and warning, the warning while uploaded videos aren't in the saved format, and converting the existing videos (`video-format.js`), the update schedule, the waiting version's choices, the manual notice and the viewer's mark (`update-schedule.js`), slides fitting the screen (`slide-fit.js`: a landscape and a portrait image in a portrait and a landscape window, checked on the screen's pixels, with the background colour) | Chrome (the runner starts a headless one) |
| installers (`test:installers`) | `tests/installers/` | install flow, branch choice, handover, self-update (the real-GitHub check only with `NB_TEST_NETWORK=1`), sudo, firewall, the Client's kiosk (`kiosk-scripts.sh`: Client + Server and its port, Client only with its waiting pages and MAC addresses, the exit, headless without it), every role and platform with the saved answers, and `--apply` (`install-flow.sh`), **the system step** (`system-step.sh`: root's `noticeboard-system` refusing all but main's latest Release, running its installer with `--apply` and reporting; the `noticeboard` command; update.sh asking for the step: needed, not needed, failing, no answer, not set up, a Full update and one on a branch), **a Client only following its Server** (`client-update.sh`: `noticeboard-client` against a stand-in Server with real ed25519 signatures: the same version, a hash-only change, a new and an older version installed with `--apply`, a bad signature refused, the kiosk not coming back and the previous files put back and skipped, a failing install, `trust-server`, `reinstall-stable` against the stand-in GitHub, `status`; the kiosk starting again on a new version is in `kiosk-scripts.sh`), update.sh (updates, branches, **main following Releases**: `update-releases.sh` (the latest Release and not main's newer commits, drafts, prereleases and none published, never backwards, a switch to main and Restore Defaults installing an older Release, the waiting Release named, the recovery command); **the return to main once a Release has the branch's work**: `update-merged.sh` (merge, squash, fast-forward, merged but not released, waiting for the installer); **the schedule** with a fake clock: `update-schedule.sh`; **Restore Defaults**: the clean, the keep list against every file the installer writes, a restart after a failed reinstall: `update-restore.sh`), **the module loader** (`module-loader.sh`: local, at a commit, the followed branch, missing or broken parts, the baseline installer handing over), the hand-over to the latest Release's installer (`installer-handover.sh`) and installing it (`install-branch.sh`). They load the installer through `tests/helpers/installer.sh` (`load_installer`), as a real run loads its parts. Plus two comparisons: **golden files** (the 13 generated files ↔ `tests/fixtures/installer-golden/`) and **branch names** (`lib/branch.sh` ↔ the server, `tests/fixtures/branch-names.txt`) | bash (Git Bash on Windows) |
| upgrade (`test:upgrade`) | `tests/upgrade/` | **the upgrade rehearsal**, in three steps. Nothing about the data, API, playlist, login or kiosk answer may change at any step. | bash, Node |

The upgrade rehearsal works like this:
1. An installed older version (`NB_BASELINE`, default `fc4ba53`), with data seeded through its own API (the first snapshot waits for the slide on air to end, so a baseline from 0.7.0 on shows the playlist as seeded), takes the working tree through **its own** update.sh, as a real Server does. The working tree is also published as main's latest Release, which is what a baseline from 0.8.0 on installs.
2. The new update.sh installs a following commit, published as main's latest Release.
3. It goes back to the baseline by a switch to a branch holding it (main never goes back by itself), and the baseline's update.sh takes over again. `NB_BASELINE=28c8b95` rehearses from 0.7.1, `NB_BASELINE=ea4de01` from 0.8.0 (both passed for 0.9.0, 2026-09-29).

The display settings a screen receives are compared the way open screens depend on them: every key the older version sent keeps its value; new keys may be added.

Helpers:
- `tests/run.js` is the runner. It lists the files itself, so it works on Node 20, and it finds Chrome and Git Bash.
- `tests/helpers/app.js` makes throwaway app copies and servers.
- `tests/helpers/github.sh` and `github.js` stand in for GitHub's Releases API (update.sh and the installer through a stand-in `curl`; the server through `NOTICEBOARD_GITHUB_API`), from one set of files (`release`, `release-kind`, `github-down`), so both see the same Releases. No test asks the real GitHub for Releases.
- `tests/helpers/cdp.js` is the Chrome client (`newWindow`: a page in a window of its own, for tests that need several visible pages: Chrome slows the timers of a tab behind another).
- `tests/upgrade/state.js` seeds and takes the snapshots for the rehearsal.

The snapshot files in `tests/fixtures/` were recorded from known-good code. They are recorded again (`NB_UPDATE_SNAPSHOT=1`) only for a deliberate, reviewed change.

---

## 18. Planned and in-progress changes

Every planned change starts here, before any code: what changes and why, the parts affected, the risks to existing users and installed Servers and Clients, and how it will be tested. A change to behaviour or structure is reviewed with the owner before coding. Once it's done, the sections above describe it and it leaves this list.

| # | Change | Status | Version (§19) |
|---|---|---|---|
| 18.1 | The viewer's black screen that only a power cycle cleared | On hold: the owner reports it if it happens again | a patch release when fixed |
| 18.3 | Audio: audio shows, slideshow background audio, video sound, event audio | Built on `feature/audio-support` (phases 1–7 done); checked on the owner's Pis (2026-09-28: all works, including the lowered background and crossfades); **merged into main** (2026-09-28, main 0.7.1) | 0.6.0 |
| 18.4 | The words Server and Client everywhere; the supported devices | Done (the kiosk scripts' text with §18.5 item 2, installer version 4); **merged into main** with audio (2026-09-28) | 0.6.1 |
| 18.5 | The Known Issues cleared for a stable base (§16) | Done (all 12 items); **merged into main** with audio (2026-09-28) | 0.6.2 to 0.6.13 (one per item) |
| 18.6 | Releases: main follows GitHub Releases; branches return to main once a Release has their work | Built on `feature/releases-installer` (2026-09-28; the sections above describe it), targeted tests and the upgrade rehearsal (from 0.3.0 and 0.7.1) pass; next the installer and update redesign (0.9.0) on the same branch. Merging needs the owner's OK and a Pi check, then the first Release (§19) | 0.8.0 |
| 18.7 | The installer and update redesign: three roles on Raspberry Pi OS or Debian, with a desktop or headless; installations that update themselves; Clients that follow their Server | Reviewed by the owner (2026-09-29). Phases 1 (roles, platforms, saved answers, one Client; installer version 5) 2 (installations that update themselves on main; installer version 6) 3 (Clients only follow their Server; installer version 7) and 4 (the notices for existing installations, the documents, the rehearsals from 0.7.1 and 0.8.0) built on `feature/releases-installer`, waiting for real-hardware checks by the owner. Nothing merged until the owner says so | 0.9.0 |
| 18.8 | Every screen in step: slides and music on the Server's clock | Built on `feature/audio-support` (phases 1–3 done, the docs updated); checked on the owner's Pis (2026-09-28); **merged into main** with audio (2026-09-28) | 0.7.0 |

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

**How it's built** (the details settled when building it, 2026-09-28):
- **One question to GitHub, asked in two languages** (D48): `installers/lib/release.sh` `latest_release` for update.sh and the installer, `server/services/updates/releases.js` for the admin panel. Both ask `NOTICEBOARD_GITHUB_API` (default `https://api.github.com`, set by the tests to a stand-in) and give three answers: a tag, none published yet (GitHub's 404, or an answer marked draft or prerelease), or GitHub couldn't be asked. The tag is then fetched on its own (`+refs/tags/<tag>:refs/tags/<tag>`), so the Server has it locally.
- **Tags and the version shown:** a Release's tag is `v` and its version (`v0.8.0`, the §19 checklist). The version shown is read from the local tags on the running commit (`git tag --points-at HEAD`, the highest `vX.Y.Z`), only when following main: no network, and the same answer after an installer run or an update.
- **No Release yet:** a Server on main keeps what it runs (the check says why, and it isn't an error); a switch to main is cancelled ("main has no published Release yet"); Restore Defaults reinstalls the running commit. GitHub unreachable: as for a branch (offline; a switch is cancelled).
- **Restore Defaults on main** reinstalls the latest Release, even when the Server runs newer commits of main (as a new installation would).
- **The branch's base** (`NOTICEBOARD_MAIN_AT_SWITCH` in update-branch.env, name kept for older update.sh) now records the latest Release's commit at the switch: a branch counts as in a Release only once the latest Release has changed since, as it needed main to move on before. Without a record, the Release's commit must differ from the branch's tip.
- **Waiting for the installer before returning:** the Release's `installer.version` is compared with `data/installer.json`'s (no record: never waits). While it waits, update.sh keeps the Release's tag in update-check.json (`installerFor`, kept by runs that don't look again); `installerVersion.status()` then reports that Release's installer needs, with its tag for the command and `returning` so the notice says to choose main when the installer asks.
- **The installer:** the README's command still runs main's latest installer first; once the questions are answered, a Server staying on (or going back to) main and a Client hand over to the latest Release's installer (`use_branch_installer`, `NOTICEBOARD_INSTALLER_RELEASE` stops it handing over again). `install_server` installs the Release's commit on main, or main's latest commit when none is published or GitHub can't be asked (it says so). Nothing it sets up changes: `INSTALLER_VERSION` stays 4.
- **The installer command shown:** from the running Release's tag on main (`installerCommand(ref)`), from the branch otherwise; update.sh's recovery text likewise.
- **The upgrade rehearsal's third step** goes back to the baseline by a branch switch, as main can't go backwards by itself any more.

**Risks:** every Server on main stops following main's commits once this reaches it: it has to arrive through the current mechanism (merged into main), and the first Release must be published straight after, or main's Servers stay on the commit that brought it. The API and the tags are new dependencies of the updater (offline handling as for branches). **Tests:** installers (a stand-in GitHub with Releases: latest, draft and prerelease ignored, none yet, never backwards, a manual switch to an older Release; returning to main only once a Release contains the branch, waiting for the installer when its version rose); api and browser (the version shown, the branch check's older-Release message); the upgrade rehearsal from the version before.

---

### 18.7 The installer and update redesign: three roles, installations that update themselves, Clients that follow their Server

**Version:** 0.9.0 (a feature), on `feature/releases-installer`, after §18.6 (0.8.0). **Status:** reviewed by the owner (2026-09-29, the decisions at the end); the owner said go (2026-09-29); phases 1 to 4 built (their real-hardware checks are the owner's); nothing is merged until the owner says so.

**Why:** today the updater runs as the desktop user and can never change packages, services or kiosk scripts, so "Run the installer again" exists; Clients have no updater, no version and no record, so a change to them means someone re-running the installer on each one; and the installer assumes a Raspberry Pi with a desktop. The owner wants (2026-09-28): one installer with three roles on Raspberry Pi OS or generic Debian, with a desktop or headless; installations that update themselves, installation-level changes included; Clients that follow whatever version their Server runs, with a recovery command; rollback where reasonably possible; a simple design. Out of scope: operating-system updates (the README may point to how they're done) and changing an installation from one role to another.

**B1. One installer, three roles, any suitable Debian**
- **Questions:** the role (*Client + Server*, *Client only*, *Server only*); for a role with a Client, the platform, preselected by detection (`/proc/device-tree/model` says Raspberry Pi; a graphical session or display manager exists): *Raspberry Pi (Raspberry Pi OS)*, *Debian with a desktop*, *minimal/headless*; Client only: the Server's address; an advanced "follow a development branch instead" (the default is main's latest Release, §18.6).
- **Answers are saved** in `/etc/noticeboard/install.env` (root-owned, mode 644: `ROLE`, `PLATFORM`, `SERVER_URL`, `DISPLAY_USER`). Updates re-run steps from it without questions (`--apply`, B2). Reinstalling offers the saved answers; a different role is refused (out of scope), with how to remove the installation first.
- **Server** (Server only, or Client + Server): as today (Node.js, ffmpeg, git, `/opt/noticeboard`, `noticeboard.service`, the update units), plus the root system step (B2). No Chromium or desktop pieces unless there is a Client.
- **One Client for every role** (`installers/lib/client.sh`, the kiosk in `installers/client/`), replacing `kiosk/server.sh`, `kiosk/display.sh` and `start-kiosk.sh` (D30 retires). Its files live in `/opt/noticeboard-client/` (`current/`, `previous/`, `version`), root-owned; `/usr/local/bin/noticeboard-client` is its command (B3). The kiosk is today's two scripts made one: the Server's address comes from `install.env` (Client + Server: `http://localhost:<port>`, the port read as today), the waiting page and exit button stay.
  - With a desktop (Raspberry Pi or Debian): XDG autostart runs the kiosk as today.
  - Minimal/headless: `noticeboard-kiosk.service` runs `cage -- chromium --kiosk <url>` on tty1 as the display user (packages `cage`, Chromium, `seatd` where needed). The waiting page works the same; the exit button is hidden (`?kiosk=headless`: there's no desktop to exit to).
- **Raspberry Pi only where it matters:** the sudo NOPASSWD offer, the screen-blanking advice, the Chromium package name. Generic Debian gets the same steps without them. NodeSource stays the source of Node.js where the distribution's is too old.

**B2. Installations update themselves**
- **A small root service** on a Server that follows main (the owner, 2026-09-29: it only ever runs the installer of main's latest Release), `noticeboard-system.service` (oneshot, root), started by `noticeboard-system.path` on `/opt/noticeboard/tmp/system-request`. It runs the installer's **`--apply <commit>`** mode: no questions, the answers from `install.env`, the steps whose results updates can't change (packages, units, the Client on a Client + Server), then the installer record.
- **Root never runs code from the user-writable `/opt/noticeboard`**, and never trusts what the request file says: it reads only a commit from it, then checks with GitHub that the commit is main's latest Release (`latest_release`, then the tag's commit; a commit from a fork is reachable through the project's URLs on GitHub, so a commit alone isn't enough) and refuses anything else, downloads the installer at that commit from GitHub (as the hand-over does today, into a root-owned temporary folder), and runs it. The answer goes to `tmp/system-result` (the only thing root writes into the folder, owned by the app's user).
- **`update.sh`'s order** on main: fetch the target; if the target's `installer.version` is higher than `installer.json`'s, request the system step for the target and wait for its result (at most 30 minutes); install the code as now; `install.sh --apply` records `installer.json`.
- **If the system step fails:** the code isn't updated, the target is skipped like a failed build (`update-failed-commit`), and the installer notice appears. Package changes are additive, so the old code keeps running.
- **Full update:** "Full update…" in Software updates (the admin password, as a branch switch), and `sudo noticeboard update --full` on the Server: both force the system step, then reinstall the code. On main only.
- **On a development branch** there is no system step: `update.sh` installs the code as now, and the installer notice appears, as now, when the branch needs a newer installer, with the command to run by hand; "Full update" and `--full` say so.
- **Command line** (`/usr/local/bin/noticeboard`, root-owned): `sudo noticeboard update` (update now, whatever the schedule), `sudo noticeboard update --full`, `noticeboard status` (version, branch, last check, last update, installer record). They write the same request files the admin panel does, so there's one path.
- **The installer notice shows only when someone has to act:** the system step failed, or needs an answer (a new question), or, on a branch, the installer must be run by hand. The admin panel's installer box and the screens' mark follow that.
- **Schedule:** unchanged (every 15 minutes, 2 hours, daily or weekly at a time, manual). **The waiting-version warnings** (the screens' mark and the admin notice) appear whenever a newer version is waiting, on any schedule (today: manual only).

**B3. Clients follow their Server**
- **What the Server offers** (it doesn't find, track, contact or push to Clients): `GET /api/client/version` → `{ version, commit, clientHash }` (`version`: the Release's tag, or `<branch>@<commit>`; `clientHash`: the SHA-256 of the Client files at the running commit); `GET /api/client/bundle` → a tar.gz of those files (`installers/client/`, the installer parts a Client needs); `GET /api/client/bundle.sig` → its signature; `GET /api/client/key` → the public key. All MAC-filtered like the viewer.
- **Signing:** the server makes an ed25519 key pair on first need (the owner, 2026-09-29) (`data/client-signing.key`, mode 600, Node `crypto`), kept by updates, branch switches and Restore Defaults (`KEPT_DATA`, `RESTORE_KEEP`). The Client installer shows the key's fingerprint and pins it in `/etc/noticeboard/server.pub`, as SSH pins a host key. The Client verifies every bundle (`openssl pkeyutl -verify -rawin`) before root runs anything from it. A rebuilt Server has a new key: `sudo noticeboard-client trust-server` shows the new fingerprint and pins it after a yes.
- **The Client's check** (`noticeboard-client-update.timer`, every 15 minutes, root): read the version the Server offers; the same as `/opt/noticeboard-client/version`: nothing; only the version changed (the same `clientHash`): record it, no kiosk restart, so screens don't blink on every Server update; different (older is fine: the Client follows its Server): download, verify, move `current/` to `previous/`, unpack, run its `--apply` (Client parts only), restart the kiosk, record the version.
- **Rollback:** if the kiosk doesn't come back (the browser not running, or the Server unreachable from the new kiosk, within 3 minutes), `previous/` is restored, its `--apply` run, and that version skipped until the Server offers another.
- **Otherwise:** an offline Client catches up at its next check; while the Server is out of reach a Client keeps showing the last viewer it had (as now); the viewer itself is still served by the Server and reloads on `display:build` as today.
- **Recovery:** `sudo noticeboard-client reinstall-stable` asks GitHub (not the Server) for main's latest Release (lib/release.sh), downloads that tag's Client files over HTTPS, reinstalls them even if current, and restarts the kiosk; the normal checks then resume and may follow the Server again.

**B4. Existing installations**
- **A Server on main** gets 0.9.0's `update.sh` the usual way, but the root system service doesn't exist on it yet: **one last installer run** is needed (installer version 5, with the usual notice). After that, installation changes apply themselves.
- **Each existing Client needs one installer run** to become a following Client (role *Client only*, the same Server address, the key pinned); the notice says so. Until then old kiosks keep working (the viewer's URL is unchanged). The Server's own `start-kiosk.sh` is replaced by the shared Client on its installer run.

**Parts affected:** `installers/install.sh` (roles, `--apply`), `lib/ui.sh` (the questions), `lib/server.sh`, `lib/display.sh` → `lib/client.sh`, `lib/kiosk.sh`, `lib/desktop.sh`, `lib/system.sh` (platform detection), new `lib/apply.sh`, `installers/client/` (the kiosk, `noticeboard-client`), `installers/update.sh` (the system step), a new `/usr/local/bin/noticeboard`; the server's `updates/` (`installerVersion`, the system-step files in `updateFiles`), new `routes/api/client.js` and `services/clientBundle.js`, `pathHelpers`, `contentReset` (`KEPT_DATA`); the admin panel's `SoftwareUpdates` (Full update), `InstallerNotice`, `UpdateAvailableNotice`; `system-requirements.json` (installer 5, with its changes); README (the roles), the user guide, this document. Reused: `installerNeeds`/`installedVersion`, `contained_in`, `run_installer_from`/`load_modules_from`, `actionTokens` and `ConfirmDangerDialogs`, `lib/schedule.sh`, `writeFileAtomic`, `lib/release.sh`.

**Risks:** root code triggered from a folder the app's user owns (hence the checks above: a commit only, verified with GitHub, the installer downloaded fresh); a Client that updates itself can break a screen nobody is watching (hence verification, rollback and `reinstall-stable`); the installer's golden files and the kiosk change on purpose (installer 5); `start-kiosk.sh` and the kiosk scripts are §15 contracts for installations that haven't re-run the installer (kept working until then); headless kiosks can only be checked on real hardware.

**Phases** (each designed here in detail as it starts, built, tested with targeted tests, committed): 1. roles, platforms, saved answers and the shared Client (B1; a real run on a Debian VM and a Pi by the owner); 2. the root system step, `--apply`, `noticeboard update [--full]`, the warnings (B2); 3. the Client offer, signing, the Client updater, rollback and `reinstall-stable` (B3); 4. migration and the documents (README with the roles, the guide, this document), then the full test run.

**Phase 1 in detail** (roles, platforms, saved answers, one Client; installer version 5):
- **The answers:** `choose_role` (1 Client + Server, 2 Client only, 3 Server only; the default is what's installed: `install.env`'s role, else a Server folder → Client + Server, else a Client kiosk → Client only) → `ROLE` (`both`, `client`, `server`), with `MODE` kept for what already reads it (`server` when there's a Server, `display` otherwise). `choose_platform`, for a role with a Client (1 Raspberry Pi with its desktop, 2 Debian with a desktop, 3 minimal/headless), preselected by `detect_platform` in `lib/system.sh` (`/proc/device-tree/model` says Raspberry Pi; a graphical default target or a display manager says there's a desktop). `ask_choice` takes the number of choices. Hand-overs pass `NOTICEBOARD_ROLE`, `NOTICEBOARD_PLATFORM`, `NOTICEBOARD_SERVER_URL`, and `NOTICEBOARD_MODE` for an older installer (a Release before 0.9.0: Server only then installs as a Server, as it did); an older installer's `NOTICEBOARD_MODE` reads as Client + Server or Client only.
- **Saved answers** (`lib/answers.sh`): `/etc/noticeboard/install.env` (`INSTALL_ENV_FILE`), root-owned, 644, lines `NOTICEBOARD_ROLE=`, `NOTICEBOARD_PLATFORM=`, `NOTICEBOARD_SERVER_URL=`, `NOTICEBOARD_DISPLAY_USER=`; read as the defaults, written after a successful run. With a saved role, choosing another is refused before anything changes (changing roles is out of scope; the message says to remove the installation first). Without the file (installed before 0.9.0) nothing is refused.
- **The Server** (`install_server`): as before, without Chromium, the kiosk, the autostart or the Help shortcut: those are the Client's.
- **One Client** (`lib/client.sh` `install_client`; the files in `installers/client/`, loaded like the other parts, into `CLIENT_FILE_<name>`): Chromium and curl (and `cage` when headless); `installers/client/kiosk.sh` and `noticeboard-client` into `/opt/noticeboard-client/current/` (root-owned), the version (`installer.json`'s commit) in `/opt/noticeboard-client/version`, and `/usr/local/bin/noticeboard-client`, a launcher that runs `current/noticeboard-client` (so phase 3 can swap `current/`). The kiosk reads `install.env`: Client + Server opens `http://localhost:<port>/` (the port read as before), Client only its Server's address; the waiting page (with this device's MAC addresses, read when it starts) until the Server answers; the crashed-browser restart; the exit button (desktop only). With a desktop: the XDG autostart runs `noticeboard-client kiosk`, and the Help shortcut is written as before. Headless: `noticeboard-kiosk.service` (tty1, `PAMName=login`, `Conflicts=getty@tty1.service`) runs `cage -s -- noticeboard-client kiosk`; the viewer opens with `?kiosk=headless`, which hides the exit button (the viewer's `ExitKiosk`) and keeps the rest of kiosk mode (the nightly reload); leaving it is `sudo systemctl stop noticeboard-kiosk`. The old `start-kiosk.sh` and `/usr/local/bin/noticeboard-kiosk.sh` are removed once the new Client is in place (`installers/kiosk/` goes: D30 retires).
- **Raspberry Pi only:** the sudo offer (`check_sudo_password`) runs only on a Raspberry Pi; the summary gives the screen-blanking advice there.
- **The reboot offer:** with any Client (the kiosk starts at start-up; a headless one started at once would take over tty1, where the installer may be running); Server only needs none.
- **What updates can't change** (installer 5, `displays: true`): the Client, its launcher and autostart or service, and the roles. The golden files are re-recorded on purpose: the autostart, the Help shortcuts, the kiosk service, the launcher (the kiosk scripts leave the set: the Client's files are copied as they are in the repository).
- **Risks:** a Server's own screen and every Client change how the kiosk starts on their next installer run (until then, the old kiosk keeps working); a headless kiosk can only be checked on real hardware (the owner). **Tests:** `install-flow.sh` (each role and platform, the saved answers reused and a different role refused, an older hand-over's answers), `kiosk-scripts.sh` (the one kiosk: Client + Server's port, Client only's waiting pages and MAC addresses, the exit, headless without it), `golden-files.sh`, `module-loader.sh` (the Client's files), `installer-handover.sh`, `install-branch.sh`; a browser check of `?kiosk=headless`.

**Phase 2 in detail** (installations that update themselves, on main; installer version 6):
- **Root's own files** (written by the installer, root-owned, never from `/opt/noticeboard`): `/usr/local/sbin/noticeboard-system` (the system step, `installers/root/noticeboard-system`), `/usr/local/bin/noticeboard` (the command, `installers/root/noticeboard`), and copies of `lib/branch.sh`, `json.sh` and `release.sh` in `/usr/local/lib/noticeboard/` for them (one copy of the rules, D48). They're read in by the installer like the Client's files (`ROOT_FILES`).
- **The system step:** `noticeboard-system.path` (`PathExists=/opt/noticeboard/tmp/system-request`) starts `noticeboard-system.service` (oneshot, root, 45 minutes at most), which runs `noticeboard-system`: it takes the request (a commit), deletes it, and refuses anything but main's latest Release: the Server must follow main (`update-branch.env`), and the commit must be that Release's (`latest_release`, then `GET …/commits/<tag>` with the sha header). Then it downloads that commit's `install.sh` into a root-owned temporary folder (`bash -n`, as the hand-over does) and runs it with `--apply`, `NOTICEBOARD_INSTALLER_SHA=<commit>` and `NOTICEBOARD_INSTALLER_RELEASE=<tag>`, and writes the result to `tmp/system-result` (`{ commit, release, result: done | failed | refused, message, time }`, owned by the app's user).
- **`install.sh --apply`:** no questions (it stops if there are no saved answers: the installer must have run once), no hand-over, no sudo check, firewall or reboot. `install_server` is split into its packages (`install_server_packages`: the system update, git, ffmpeg, curl, Node.js), its code (`install_server_code`: the folder, the build, config.json, .env, the branch setting) and its services (`install_server_services`: the units, root's files); `--apply` runs the packages and services (without restarting the server: update.sh does, after the code) and the Client, then the record (`installer.json`). An interactive run does all three, as now.
- **`update.sh`** (on main, when an install is due and not refused): if the Release's `installer.version` is above the record (`installer_behind`) and the system step is set up (`systemctl is-enabled noticeboard-system.path`), it writes the request and waits for the result for that commit (every 5 s, at most 45 minutes), saying so in the status (`updating`, "Setting up the system for Release v…"). Done: it carries on with the code. Failed, refused or no answer: the target is skipped like a failed build (`update-failed-commit`), the status says why, and the code isn't touched. Not set up (a Server from before 0.9.0): as today, the code installs and the installer notice asks for the one last manual run.
- **Full update:** `update.sh` takes a request `full`: the system step for the target even when not behind, then the code even when it's the one running (as `--force`). The admin panel's "Full update…" (Software updates, on main with the system step set up: the admin password, then a final confirmation, `actionTokens` action `full`, `POST /settings/updates/full`), and `sudo noticeboard update --full`, both write it. On a branch the server refuses it (409) and the card says to run the installer by hand.
- **The command** `noticeboard`: `sudo noticeboard update` (writes the request `install-now`: installs now, whatever the schedule), `sudo noticeboard update --full`, `noticeboard status` (the version, the branch, the last check, the last update, the installer record and the last system step, read from the files in `data/` and `tmp/`).
- **The notices:** the installer notice (admin pages, the screens' mark) shows when someone has to act: the installer is behind and the system step isn't set up, or its last run for the running Release's successor failed (`installerVersion.status()`: `automatic`, `systemFailed` with its message). The waiting-version warnings (`UpdateAvailableNotice`, the screens' `updateAvailable`) show whenever a newer version is waiting, on any schedule (`updateWaiting`, formerly `manualUpdateWaiting`).
- **Risks:** root runs code only from GitHub, at main's latest Release, checked twice (request and GitHub); a failed system step leaves the running version as it is. **Tests:** installers (`noticeboard-system`: refuses a commit that isn't the latest Release, or a Server on a branch; runs `--apply` and reports; `--apply` asks nothing and doesn't touch the code; `update.sh`: system step needed, not needed, failing and skipping the target, not set up; the `noticeboard` command), api (Full update: password, main only), browser (the Full update dialogs; the warnings on any schedule).

**Phase 3 in detail** (Clients follow their Server; installer version 7):
- **Which Clients:** a **Client only** follows its Server. A Client + Server's own screen doesn't: its bundle would be made and signed by the app's own user on the same machine, so root installing it would be root running code from the app's folder (decision 1). Its Client is kept up to date by the system step with main's Releases (phase 2), and on a branch by hand.
- **What the Server offers** (`server/services/clientBundle.js`, `server/routes/api/client.js`, MAC-filtered like the viewer; nothing is pushed or tracked): `GET /api/client/version` → `{ version, commit, clientHash }` (`version`: the Release's tag on main, else `<branch>@<short commit>`; `clientHash`: a SHA-256 of `git ls-tree` of the installer files at the running commit, so a Server update that doesn't touch them doesn't restart any screen); `GET /api/client/bundle` → a tar.gz of `installers/install.sh`, `lib/`, `client/` and `root/` at the running commit (`git archive`, made once per commit in `tmp/`); `GET /api/client/bundle.sig` → its ed25519 signature (raw, 64 bytes); `GET /api/client/key` → the public key (PEM). The key pair is made on first need (Node `crypto`) in `data/client-signing.key` (mode 600), kept by Restore Defaults (`KEPT_DATA`); updates and branch switches never touch `data/`.
- **The Client's check** (`noticeboard-client check`, root, `noticeboard-client-update.timer` every 15 minutes, only on a Client only): ask the version; the same as `/opt/noticeboard-client/version`: nothing; only the version differs (the same hash): record it, no restart; a commit it was told to skip: nothing. Otherwise download the bundle and its signature, verify them with the pinned key (`openssl pkeyutl -verify -pubin -inkey /etc/noticeboard/server.pub -rawin`), unpack into a root-owned folder and run its installer with `--apply` (`NOTICEBOARD_INSTALLER_SHA=local`: its own parts), then record the version and hash and keep the bundle as `installed.tar.gz` (the one before it becomes `previous.tar.gz`). A bundle that doesn't verify is never unpacked.
- **The kiosk follows by itself:** the running kiosk notices `/opt/noticeboard-client/version` changing (it looks every 3 seconds, as for the exit button), closes its browser and starts again from the new files; once its viewer is up for a version it writes that version to `/tmp/noticeboard-kiosk-up`.
- **Rollback:** if `/tmp/noticeboard-kiosk-up` doesn't show the new version within 3 minutes (the browser didn't start, or the Server can't be reached from the new kiosk), the check applies `previous.tar.gz` again, restores the version, and writes the commit to `skip` until the Server offers another.
- **`sudo noticeboard-client trust-server`:** shows the Server's key fingerprint (SHA-256) and pins it after a yes (a rebuilt Server has a new key). The installer does the same for a new Client only (if the Server is out of reach, or too old to offer a key, it says the Client won't update itself until `trust-server` is run).
- **`sudo noticeboard-client reinstall-stable`:** asks GitHub (not the Server) for main's latest Release (`/usr/local/lib/noticeboard/release.sh`, installed on Clients too), runs that Release's installer with `--apply` (downloaded over HTTPS at its tag, as the system step does), even if it's current, and records `<tag> (stable)` so the next check follows the Server again.
- **Installed by the installer (a Client only):** `noticeboard-client-update.{service,timer}`, the pinned key, the parts `noticeboard-client` loads, `openssl` and `curl`. `noticeboard-client status` shows the version, the role, the Server, the pinned key's fingerprint and a version skipped.
- **Risks:** a Client trusts whatever its Server signs (a Server taken over could update its Clients, as it can already change what they show); the pinned key stops anyone else on the network. A Client that updates itself can break a screen nobody is watching: verification, the kiosk's own restart, rollback and `reinstall-stable` are the answers. **Tests:** api (the four endpoints, the signature verifying with the public key, the version on main and on a branch, the key kept by Restore Defaults), installers (`noticeboard-client check` against a stand-in Server: same version, hash only, a new version, an older one, a bad signature refused, rollback, the skip; `trust-server`; `reinstall-stable` against the stand-in GitHub; the kiosk restarting on a new version).

**Phase 4 in detail** (existing installations and the documents; no new installer version):
- **What an existing installation sees:** a Server on main from before 0.9.0 installs the 0.9.0 Release as usual (its update.sh follows Releases since 0.8.0); root's system step isn't set up yet, so the installer notice asks for **one last run by hand** and says that, once it has run, a Server on main runs the installer by itself when a Release needs it (`installerVersion.status()` → `lastByHand`: on main, the system step not set up, and the version needing an installer that sets it up, `SYSTEM_STEP_FROM` = 6). On a branch the notice is as before.
- **Clients:** `installerNeeds` → `displays` only when a missed change is for the Clients **and** the Server's installer record is below `CLIENTS_FOLLOW_FROM` (7): Clients set up before then don't follow their Server, so each needs **one run as *Client only*** (the notice: "Run it once on each Client as well, choosing *Client only* and this Server's address; after that each Client follows this Server by itself"). From 7 on, a change for the Clients reaches every Client only by itself (`clientsFollow: true`: the notice says there's nothing to do on them). The screens' mark is unchanged.
- **Documents:** README (the roles, the one run on each device installed before, Client updates), the user guide (installing each role, Clients' updates and commands, when the installer needs running again), this document (the sections, §19's row for 0.9.0).
- **Then:** the full run (`node tests/snapshot.js` or Actions), the upgrade rehearsal from 0.7.1 and 0.8.0 (`NB_BASELINE`), and the 2do list's status line for this item, as agreed.
- **Tests:** unit (`installerNeeds`: `displays` and `clientsFollow` either side of 7), browser (`installer-notice.js`: the last-run line on main without the system step, the Client line before 7, the "follow by themselves" line from 7 on a branch).

**Tests:** installers (every role and platform, the saved answers, `--apply` asking nothing, golden files re-recorded on purpose with installer 5; the system step needed, not needed, failing and skipping the target, a request for a commit that isn't the Release or the branch tip refused; the Client updater against a stand-in Server: same version, different and older versions, a hash-only change, a bad signature refused, rollback after a kiosk failure, `reinstall-stable` against the stand-in GitHub); api and browser (the client endpoints and the signature, Full update with the password, the warnings on any schedule); the upgrade rehearsal from 0.7.1 and 0.8.0; on real hardware before merging: a Raspberry Pi as Client + Server with a desktop, a Debian VM as Server only, a minimal Debian (or an Orange Pi Zero 2W) as Client only, a Client following a branch switch and back, and a rollback.

**The owner's decisions (2026-09-29):**
1. The root system step only ever runs the installer of **main's latest published Release**, after checking with GitHub that the requested commit is that Release's. A Server on a development branch needs the installer run by hand when the branch changes what only the installer sets up, as today.
2. The server makes the Client signing key itself, the first time it needs one.
3. Headless Clients: `cage` on tty1, with the viewer's exit button hidden (`?kiosk=headless`); leaving the kiosk there is `sudo systemctl stop noticeboard-kiosk`.
4. Clients still follow whatever their Server runs, a branch included: they trust the Server's signature, not GitHub. Decision 1 is about the Server's own root step.

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
4. **Done:** the docs, the full run, the check on the owner's Pis (2026-09-28).

## 19. Versions

**Rules** (the owner, 2026-09-28)
- Versions are MAJOR.MINOR.PATCH. **1.0.0 is the version with Display Groups**; until then they are 0.x.
- A merge into main that brings new features raises MINOR (PATCH back to 0). One that only fixes bugs, or only tidies without changing what users see, raises PATCH.
- Work in progress names the version it will become (§18's table, and the line at the top of this document). The version of main changes only when that work is merged, in the merge commit, together with this section.
- A bug fixed on its own (§16, §18) is a patch release, listed here with what it fixed; a bug fixed inside a feature branch is listed with that version.
- **Merged together** (the owner, 2026-09-28): the words Server and Client (§18.4) and the Known Issues fixes (§18.5) are built on `feature/audio-support` and merge into main with audio as one item, after the check on a real Pi; each keeps its own version number here, and main moves from 0.5.0 to the last of them at that merge.
- **Each bug fix counts as its own patch number,** even when several are done together (the owner, 2026-09-28): e.g. §18.5's twelve items are 0.6.2 to 0.6.13, and wording or documentation work such as §18.4 is a patch too.
- `package.json` (the root, `client/admin` and `client/display`) still says 1.0.0, npm's default; nothing reads it. Setting it to the version here is for the owner to decide (by hand, with the matching top entries of `package-lock.json`, never with npm install on Windows).

**Publishing a Release** (once §18.6 is on main, a Server on main installs main's latest published Release, §15 22–23)
1. The work is merged into main, and main's version, this section's history row and the line at the top of this document are updated in the merge commit (the rules above).
2. The `version` of `package.json` (the root, `client/admin` and `client/display`) and the matching top entries of `package-lock.json` are set to the version, by hand (never with npm install on Windows), in a commit on main.
3. The full test run has passed on that commit.
4. On GitHub, a new Release from that commit of main: the tag `v` and the version (`v0.8.0`), the name `Noticeboard 0.8.0`, and the history row's "What it brought" and "Bugs fixed" as its notes. Not a draft or prerelease: those are never installed. Every Server on main installs it at its next scheduled install.
5. The first Release (0.8.0) is published straight after §18.6 reaches main: until then, Servers on main stay on the commit that brought it.

**Current:** main is **0.7.1**. The merge of `feature/audio-support` (2026-09-28, after the check on the owner's Pis) brought **0.6.0** "Audio" (§18.3), **0.6.1** (§18.4 the words Server and Client), **0.6.2–0.6.13** (§18.5 the Known Issues, one per item), **0.6.14** (the fix from the Pi test), **0.7.0** (§18.8 every screen in step) and **0.7.1** (the Branding card first on the Settings page). Planned, on `feature/releases-installer`: **0.8.0** (§18.6 Releases) and **0.9.0** (the installer and update redesign).

**History** (numbered after the fact for everything before 0.6.0)

| Version | Date | Reached main | What it brought | Bugs fixed |
|---|---|---|---|---|
| 0.1.0 | 2026-04-28 | direct commits | The prototype: the server foundation (config, MAC filter, routing), the admin panel, multiple file uploads | |
| 0.2.0 | 2026-09-26 | direct commits | Installable and unattended: one installer with auto-update and a sudo check, fast restart and display reload after updates, the device address button, the sample slideshow and "No slideshow published" screen, the user guide in the admin panel, displays that keep cycling for months, choosing the update branch in the admin panel and returning to main after a merge, the optional firewall check, the kiosk only for the viewer with an exit button, system-requirements.json | the kiosk on newer Raspberry Pi OS; slides stuck on processing when several were uploaded at once; the admin login page reloading itself endlessly |
| 0.3.0 | 2026-09-27 | PR #1 "QALife updates" (8c39d54), then fc4ba53 | The viewer's exit control, location pin setting, cursor hiding and logo; the password warning; the admin at /admin on one port; slideshow durations, hide and unhide, sample protection, previews and video thumbnails; the admin panel on phones; the MAC filtering warning; the software check before switching branch; "run the installer again" notices; the sidebar's "Last updated" | |
| 0.4.0 | 2026-09-27 | PR #2 "Reorganise the code…" (3b4f77c) | The refactor (12 stages, the test suite in the repository, the System Design); slides that always fit the screen on a background colour; the updater's warnings on every admin page and a warning mark on every screen | the location pin's pop-up pointing the public to the admin panel |
| 0.5.0 | 2026-09-28 | merge of QALife-updates (e2deb54) | Slide names; admin cards that fold to their title; Delete All; the update schedule; Restore Defaults; new videos in H.265 with a format setting, converting existing videos, and videos keeping to time; module comments brought up to date; MAC filtering's network requirements in the README and Help | the merged-notice test failing on a clean working tree |
| 0.6.0 | 2026-09-28 | merge of `feature/audio-support` | "Audio": audio shows with tracks, order, crossfades, volume and a preview; background audio for slideshows; video sound; event audio (§18.3). The README's new opening | |
| 0.6.1 | 2026-09-28 | merge of `feature/audio-support` | The words Server and Client everywhere, and the supported devices (§18.4) | |
| 0.6.2 | 2026-09-28 | merge of `feature/audio-support` | | the live connection (socket.io) wasn't MAC filtered |
| 0.6.3 | 2026-09-28 | merge of `feature/audio-support` | installer version 4 | the Server's own screen ignored a changed port (the kiosk had 3000 built in) |
| 0.6.4 | 2026-09-28 | merge of `feature/audio-support` | | an empty client address counted as the Server itself |
| 0.6.5 | 2026-09-28 | merge of `feature/audio-support` | a Port card in Settings, and "Restart the Server" | the port wasn't checked, and a change needed a restart by hand |
| 0.6.6 | 2026-09-28 | merge of `feature/audio-support` | | the unused npm packages item closed (the packages left in, the owner's choice) |
| 0.6.7 | 2026-09-28 | merge of `feature/audio-support` | | the media route's audio extensions reviewed: still an issue, reported (§16) |
| 0.6.8 | 2026-09-28 | merge of `feature/audio-support` | | reorder errors were ignored |
| 0.6.9 | 2026-09-28 | merge of `feature/audio-support` | | an unreadable config.json was overwritten with the defaults |
| 0.6.10 | 2026-09-28 | merge of `feature/audio-support` | | MAC filtering's settings were saved as sent, whole |
| 0.6.11 | 2026-09-28 | merge of `feature/audio-support` | | the default duration not resending the playlist: kept as it is (the owner's choice) |
| 0.6.12 | 2026-09-28 | merge of `feature/audio-support` | | a message's timer could clear a later message |
| 0.6.13 | 2026-09-28 | merge of `feature/audio-support` | the Display card warns about videos in the other format | |
| 0.6.14 | 2026-09-28 | merge of `feature/audio-support` | `?debug=audio` on the viewer | a video's sound silenced the background music on a Pi (every sound is now 48 kHz) |
| 0.7.0 | 2026-09-28 | merge of `feature/audio-support` | Every screen in step (§18.8): every screen keeps to the Server's clock, shows the same slide and plays the same music at the same moment; a playlist change reaches every screen together at the end of the slide on air; music like a radio (a show is joined where it is now); a video starts at the right point and is kept there | screens side by side changing slides at different times, and screens heard together echoing |
| 0.7.1 | 2026-09-28 | merge of `feature/audio-support` | The Branding card first on the Settings page (the owner, 2026-09-28) | |

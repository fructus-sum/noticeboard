# Noticeboard — System Design

**What this document is:** how the Noticeboard code works: its parts and how they talk to each other, the files and formats it keeps, the operating-system set-up, what installed Pis and open screens rely on, and what is shared or still written twice. It describes only what exists in the code. The README says how to install and develop it; the user guide (`noticeboard-guide.html`) is for the people running a noticeboard.

**Keeping it up to date:** change it in the same commit as the code it describes, like `system-requirements.json`. Code comments refer to it as `CURRENT_SYSTEM_DESIGN §<n>`, and to the shared behaviour in §14 by its D-number, so keep the section and D numbers; retire an entry rather than renumber.

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

**History:** the code was reorganised in September 2026 (the branch `refactor/architecture`) without changing what users see, apart from two changes asked for along the way (the location pin's message, and one version of the software instead of a separate development mode), and every installed Pi took it through its normal update. The commits say what changed at each step. Where this document says "the old …", it means the code before that.

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
16. [Defects, dead code and inconsistencies found](#16-defects-dead-code-and-inconsistencies-found)
17. [Existing tests](#17-existing-tests)

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
│ Server Pi   /opt/noticeboard  (git clone, owned by the desktop user)  │
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
│ Remote display Pi (0..n)    │           │ Any browser on the LAN │
│ /usr/local/bin/             │           │ /admin (password)      │
│   noticeboard-kiosk.sh      │           │ / (viewer)             │
│   ── chromium --kiosk URL   │           └────────────────────────┘
│ (no repo, no Node.js)       │
└─────────────────────────────┘
```

Two kinds of Pi are set up by the same installer:

- **Server + display.** The Pi runs the Node.js server, stores all content, hosts the admin panel, updates itself from GitHub, and shows the slideshow full screen on its own monitor.
- **Remote display.** The Pi only runs Chromium full screen, pointed at the server's URL. It has no copy of the repository and does not update itself: the viewer it shows is served by the server, so it gets new viewer code when the server updates.

---

## 2. Repository layout

```
noticeboard/
├── package.json               npm workspaces root (server, client/display, client/admin); build, start and test scripts
├── package-lock.json          lockfile for all three workspaces (contains linux-arm64 optional deps: never regenerate on Windows)
├── system-requirements.json   system software each branch needs, and the installer version (read by the server and tests)
├── noticeboard-guide.html     user guide (self-contained HTML; served at /admin/help, opened as file:// on the Pi)
├── README.md, LICENSE, .env.example
├── docs/design/CURRENT_SYSTEM_DESIGN.md   this document
├── sample-data/
│   ├── sample-logo.png        placeholder logo
│   └── sample-slideshow/      01-welcome.png … 05-help.png, 03-video.mp4, sample.json (settings)
├── installers/
│   ├── install.sh             the one installer: configuration, latest-installer switch, loading its parts, main()
│   ├── lib/                   its steps: ui, branch, json, system, sudo, server, display, kiosk, desktop, firewall
│   │                          (branch.sh and json.sh are also loaded by update.sh)
│   ├── kiosk/                 server.sh, display.sh: the kiosk scripts it installs, as they are installed
│   └── update.sh              the self-updater run by systemd on the server Pi
├── server/                    CommonJS, Express 4, socket.io 4
│   ├── index.js, app.js       the entry point (systemd runs server/index.js) and the Express app
│   ├── config/                defaults.js (a new config.json), passwordDefaults.js (the default password)
│   ├── middleware/            access.js (MAC filter, admin check), macFilter.js and adminAuth.js (their names),
│   │                          asyncRoute.js, uploads.js, errorHandler.js
│   ├── realtime/              displaySocket.js (socket.io: the live connection to the displays)
│   ├── routes/                index.js (mounting), spa.js (the apps' catch-all and "not built" page)
│   │   └── api/               index.js, auth.js, device.js, slideshows.js, slides.js
│   │       └── settings/      index.js, general.js, security.js, logo.js, updates.js (the Settings page)
│   ├── services/              configService, slideshowStore, slideshowRules, playlistService, displayEvents,
│   │                          schedulerService, settingsService, adminPassword, adminSession, macService,
│   │                          mediaService, mediaTypes, uploadQueue, brandingService, sampleSlideshow
│   │   └── updates/           index.js, git.js, branchName.js, updateFiles.js, installerVersion.js, switchTokens.js
│   ├── utils/                 pathHelpers, configIO, logger, macLookup, network, slugify, slideshowLock,
│   │                          displayBuildId, systemCheck
│   └── test/                  unit tests (node:test): foundations, installer version, Node.js version rule
├── shared/                    public values shared by the server and both web apps (alias @shared)
│   ├── contract.json          socket event names and limits (the server requires it; the apps import it)
│   └── index.js               SOCKET_EVENTS, LIMITS, PROJECT_URL, installerCommand(), mediaUrl() for the apps
├── client/                    ES modules, Vue 3, Vite 5
│   ├── display/               the viewer: src/ (App, components, composables, slideshowClock, recovery),
│   │                          test/slideshowClock.test.mjs
│   └── admin/                 the admin panel: src/ (views, components/{ui,slideshow,settings,updates},
│                              composables, router, styles/base.css)
└── tests/                     run.js (the runner: unit, api, browser, installers, upgrade, all), helpers/,
                               fixtures/, api/, browser/, installers/, upgrade/ (§17)
```

Files that exist only on the developer's PC and are not tracked: `*.md` files other than the README and this document (excluded via `.git/info/exclude`), `.gitattributes` (forces LF line endings for `*.sh`) and `.gitignore`.

Git ignores the runtime folders `data/`, `tmp/` and `logs/`, the built apps in `client/*/dist/`, `node_modules/` and `.env`.

---

## 3. Runtime architecture

### 3.1 Processes on a server Pi

| Process | Started by | Runs as | What it is |
|---|---|---|---|
| `node server/index.js` | `noticeboard.service` (`Restart=always`, `RestartSec=5`) | desktop user | The whole server: HTTP, socket.io, scheduler, upload queue |
| `bash installers/update.sh` | `noticeboard-update.timer` (boot+5 min, then every 15 min) or `noticeboard-update.path` (when `tmp/update-request` exists) | desktop user (`User=` in the unit; it re-execs itself as the owner if started as root) | Self-updater (oneshot) |
| `/opt/noticeboard/start-kiosk.sh` | XDG autostart `/etc/xdg/autostart/noticeboard-kiosk.desktop` at desktop login | desktop user | Bash loop that keeps Chromium in kiosk mode on `http://localhost:3000/` |
| Chromium | the kiosk script | desktop user | Shows the viewer (`/`) |

On a remote display Pi, `/usr/local/bin/noticeboard-kiosk.sh` is started by the same autostart entry. It shows a local waiting page until the server answers, then runs Chromium in kiosk mode on the server's URL.

### 3.2 Server start-up (`server/index.js`)

1. `configService.init()` creates `data/` and `data/slideshows/`, and reads `data/config.json` with JSON5.
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
| 2 | `GET /admin/help` | `macFilter` | `sendFile(noticeboard-guide.html)`, 404 text if missing |
| 3 | `GET /branding/logo` | `macFilter` | uploaded `data/branding/logo.png`, or the placeholder resized in memory. `?v=` makes it cacheable for a year |
| 4 | `/admin` | `macFilter` | `express.static(client/admin/dist)`, then `routes/spa.js` (`index.html` for every path, or an inline "not built" page) |
| 5 | `/api/*` | see the API table in §4.1 | `routes/api/index.js` |
| 6 | `/` | `macFilter` | `express.static(client/display/dist)`, then `routes/spa.js` (`index.html` for every path, or the "not built" page) |

socket.io attaches directly to the `http.Server`, so **`/socket.io` never passes through Express or `macFilter`** (see §16).

### 3.4 Real-time channel (socket.io, `server/realtime/displaySocket.js`)

| Event | Direction | When | Payload |
|---|---|---|---|
| `display:build` | server → one socket | on connect | 12-character SHA-1 of `client/display/dist/index.html`, or `null` |
| `display:settings` | server → one socket, and broadcast | on connect; broadcast when `configService` emits `'change'` and the settings differ from the last broadcast | `{ showDeviceInfo, logo: { url } \| null }` |
| `display:ready` | display → server | on every (re)connect | none |
| `playlist:update` | server → that socket (reply to `display:ready`), and broadcast | on `display:ready`; on `schedulerService 'update'`; on the explicit `broadcastPlaylist()` calls from routes and the upload queue | `{ slides: [{ type, url, duration, slideshow }] }` |

The event names are defined once, in `shared/contract.json`. `realtime/displaySocket.js` requires it, and the viewer imports it through `shared/index.js` (`SOCKET_EVENTS`).

`buildPlaylist(active)` (services/playlistService.js), for each active slideshow in priority order:
1. Take the current entry from the store (`store.find`), because the scheduler's cached copy may be stale.
2. Read the slides with `store.readSlides`: a missing or broken file, or one without a slides list, gives no slides (§16 #6).
3. Keep the `status === 'ready'` slides and map them to `{ type, url: /media/<folder>/slides/<filename>, duration, slideshow }`.
   - Images: `duration = slide.duration ?? slideshow.slideDurationSeconds ?? display.defaultSlideDurationSeconds ?? 10`.
   - Videos: `duration = null`.

### 3.5 The viewer (`client/display`)

`App.vue` wires everything together:
- `useSocket()` provides the playlist, connection state, whether a playlist has been received, and the display settings.
- `useActivity()` tracks mouse, keyboard and touch activity.
- It shows `SlideShow` when there are slides, otherwise `WaitingScreen`.
- `DeviceInfo` (the location pin) appears if `showDeviceInfo` is on.
- `ExitKiosk` appears unless `?kiosk=off`.
- The cursor is hidden while idle (`.app--idle`).
- `startDailyReload` runs unless `?kiosk=off`.

`SlideShow.vue` holds no timing logic of its own; `slideshowClock.js` makes every timing decision. It is plain JavaScript with deadlines, a watchdog, skipping of failed slides and deferred playlist changes, and it is tested over simulated weeks.

`SlideShow.vue` renders one or two `SlideFrame` layers for the cross-fade. It calls `clock.resume()` on page lifecycle events and on reconnect.

`recovery.js` provides safe reloads that first check that `GET /` answers:
- after a build change (`display:build` differs from the first value seen)
- when every slide keeps failing (at most once per 30 minutes, tracked in `sessionStorage`)
- once a day between 02:00 and 05:00 after 24 hours of running

### 3.6 The admin panel (`client/admin`)

A Vue Router SPA under `/admin/`:
- **Mounting:** `main.js` mounts only after `router.isReady()`. Mounting earlier caused a reload loop on the login page.
- **Login guard:** a global `beforeEach` calls `GET /api/auth/status` and sends the user to `/login` when they aren't logged in.
- **API calls:** go through `composables/useApi.js`, which sends the cookie with each request. A 401 response loads `/admin/login`, unless the browser is already on it.
- **Shared state:** module-level singletons shared between components: `useBranding` (logo), `useSecurity` (default-password flag) and `useNav` (sidebar collapsed, stored in `localStorage`).
- **Views:**
  - `LoginView`
  - `SlideshowsView` (home): notices, device banner, list, create, publish, hide, delete
  - `SlideshowDetailView`: loads the slideshow; `components/slideshow/` has its settings card (with the schedule editor) and its slide list (uploads, reorder, thumbnails, preview)
  - `SettingsView`: loads the settings; one component per card: display, MAC filtering, logo, password (`components/settings/`), software updates (`components/updates/`)

### 3.7 Background work in the server

| What | Where | Trigger |
|---|---|---|
| Recompute the active slideshows | `schedulerService.computeActive` | every 60 s, and on every `configService 'change'`. It emits `'update'` only when the ordered list of folders changes. |
| Media processing | `uploadQueue` (p-queue, concurrency 2) | after an upload. Images: sharp → PNG. Videos: ffmpeg → H.264/AAC MP4, then ffprobe for the duration, then a JPEG thumbnail. |
| Video thumbnails | `uploadQueue.enqueueThumbnail` | the sample slideshow's videos, and "Create thumbnails" in the admin panel |
| Sample slideshow sync | `sampleSlideshow.syncSampleSlideshow` | once at start-up |
| Branch-switch token expiry | `updates/switchTokens.take` | lazily, when tokens are used |
| Kiosk exit requests | `device.js` (in-memory `Map`) | expire after 60 s, cleaned up when claimed |

### 3.8 One version

There is no development mode. On a PC and on a Pi the server is started the same way (`npm start`, or systemd's `node server/index.js`) and serves the built apps from `client/*/dist` (`npm run build`). Changes are tried out on a GitHub branch that a Pi follows. The only environment switch left for the app itself is the log level, for troubleshooting (§5.2).

---

## 4. How the parts communicate

### 4.1 HTTP API (`/api`, all behind a rate limit of 120 requests per minute per IP)

| Method and path | Guard | Handler | Called by |
|---|---|---|---|
| `POST /api/auth/login` | macFilter, login limiter (5 per 15 min) | bcrypt compare → JWT cookie `nb_admin_token` (7 days) | `LoginView` (raw `fetch`) |
| `POST /api/auth/logout` | macFilter | clears the cookie | `NavBar` |
| `GET /api/auth/status` | macFilter | `{ authenticated }` by verifying the JWT | router guard (raw `fetch`); **update.sh health check**; test harnesses |
| `GET /api/device` | macFilter | server IPs (the one used first) and port | `DeviceInfo.vue` |
| `POST /api/device/kiosk-exit` | macFilter | stores an exit request for the caller's IP | `ExitKiosk.vue` |
| `POST /api/device/kiosk-exit/claim` | macFilter | `{"exit":true\|false}`, consuming the request | **kiosk scripts** (curl, exact string compare) |
| `GET/PUT /api/settings` | adminAuth | sanitised config / partial update of `port`, `macFiltering`, `display` | SettingsView, LogoSettings, SlideshowDetailView (and the cards: DisplaySettingsCard, MacFilterCard) |
| `GET /api/settings/device` | adminAuth | LAN interfaces with MACs | SlideshowsView banner |
| `GET /api/settings/my-device` | adminAuth | `{ local, mac }` of the caller | MacFilterWarning |
| `GET /api/settings/security` | adminAuth | `{ defaultPassword }` | useSecurity |
| `GET/POST/DELETE /api/settings/logo` | adminAuth | logo info / upload / reset | useBranding, LogoSettings |
| `PUT /api/settings/password` | adminAuth | change the password (403 when the current one is wrong) | PasswordCard |
| `GET /api/settings/updates` | adminAuth | update info (git, the status and check files, systemd unit presence) | useUpdateInfo |
| `GET/DELETE /api/settings/updates/notice` | adminAuth | read or dismiss `update-notice.json` | UpdateNotice |
| `GET /api/settings/updates/installer` | adminAuth | whether the installer needs running again | InstallerNotice |
| `GET /api/settings/version` | adminAuth | `{ commit, date, installedAt, branch }` | NavBar |
| `GET /api/settings/updates/branches` | adminAuth | `git ls-remote --heads` | useUpdateInfo |
| `POST /api/settings/updates/check` | adminAuth | fetch the branch, validate it, requirements and installer needs | BranchSwitcher |
| `POST /api/settings/updates/verify-password` | adminAuth, 5 wrong per 15 min | one-time token (5 min) | SwitchDialogs |
| `POST /api/settings/updates/switch` | adminAuth + token | writes the branch file, status and request | SwitchDialogs |
| `GET/POST /api/slideshows` | adminAuth | list (with `sample`, `slideCount`) / create | SlideshowsView |
| `GET/PUT/DELETE /api/slideshows/:folder` | adminAuth | read / update / delete (the sample gives 403) | both slideshow views |
| `GET/POST /api/slideshows/:folder/slides` | adminAuth (once per request) | list / upload (multer, max 50 files, 500 MB each) | SlideshowDetailView (list), SlideList |
| `DELETE /api/slideshows/:folder/slides/:id` | adminAuth | remove the slide and its files | SlideList |
| `PUT /api/slideshows/:folder/slides/reorder` | adminAuth | `{ order: [ids] }` | SlideList |
| `POST /api/slideshows/:folder/slides/thumbnails` | adminAuth | queue the missing thumbnails | SlideList |

Error conventions:
- `/api` errors are JSON `{ error }`.
- MAC denial is a **404 plain-text `Not Found`** everywhere, on purpose, so that denied devices learn nothing.
- The display kiosk script relies on it: a 404 on `/` means "waiting for approval".
- A wrong password inside the admin panel gives **403**, not 401, because a 401 makes the panel jump to the login page.

### 4.2 Files used as a channel between the server and `update.sh`

| File | Server side | update.sh side |
|---|---|---|
| `data/update-branch.env` | `requestSwitch` writes `NOTICEBOARD_BRANCH=<b>`; `configuredBranch()` reads it | reads `NOTICEBOARD_BRANCH` and `NOTICEBOARD_MAIN_AT_SWITCH`; `set_branch_setting` writes both |
| `tmp/update-request` | `requestSwitch` writes it | the systemd `.path` unit starts `update.sh`, which deletes the file at once |
| `data/update-status.json` | `requestSwitch` writes `state: requested`; `getInfo` and `versionInfo` read it | `write_status` for every other state |
| `data/update-check.json` | `getInfo` reads it | `write_check` |
| `data/update-notice.json` | `getNotice` reads it; `dismissNotice` deletes it | `returned_to_main` writes it |
| `tmp/noticeboard-uploads/*` | multer puts uploads here; the queue deletes them | a file younger than 60 min means "upload in progress, wait" |
| `tmp/update.lock` | none | `flock`, also held by `install.sh` |
| `data/installer.json` | `installedInstallerVersion` reads it | written by `install.sh` |

### 4.3 Kiosk scripts ↔ server

- **Readiness.** `curl -sf http://localhost:3000/` (server kiosk) or `curl … $SERVER_URL` (display kiosk; 200 = show the viewer, 404 = MAC not approved, anything else = server unreachable).
- **Exit.** `curl -s -X POST --max-time 3 <url>api/device/kiosk-exit/claim` every 3 s, compared with the exact string `{"exit":true}`.
- **Leaving kiosk mode.** Kill the kiosk browser, then run `<browser> --no-first-run <url>?kiosk=off`.

### 4.4 Server-internal events

- `configService` (EventEmitter) emits `'change'` only from its own `set()` and `update()`, i.e. when config.json really changed. Listeners: `schedulerService` (recompute) and displaySocket's display-settings broadcast (deduplicated).
- `schedulerService` emits `'update'` when the active slideshows change. Its only listener is displaySocket's playlist broadcast.
- **`services/displayEvents.js`** is the explicit channel to the displays. `playlistChanged()` is called by the slideshow PUT, the slide DELETE and reorder routes, and `uploadQueue` after processing. `displaySettingsChanged()` is called by the logo upload and reset. displaySocket is its only listener, so no route or service depends on socket.io.
- Found while recording the socket events: changing the default image duration (`PUT /settings` display) sends no playlist. Displays keep the old duration for slideshows that use the default until the playlist is next sent (§16 #18).

---

## 5. Configuration

### 5.1 `data/config.json`

Read with JSON5, so comments and `_comment` keys are allowed. Written as plain JSON, pretty-printed, via a temporary file and a rename. `configService` keeps it in memory and writes the whole object on every change.

| Key | Type | Default | Read by | Written by |
|---|---|---|---|---|
| `_comment` | string | yes | nobody | defaults |
| `port` | number | 3000 | index.js; update.sh and install.sh via `configIO.readConfig` | `PUT /settings` (no validation; takes effect after a restart) |
| `passwordHash` | bcrypt | hash of `Admin@12345` | adminPassword (login, password change, branch-switch check, usesDefault) | configService defaults, `PUT /settings/password` |
| `jwtSecret` | hex (96 characters) | random | adminAuth, auth login/status | defaults only |
| `macFiltering.enabled` | bool | false | macService | `PUT /settings` |
| `macFiltering.approved[]` | `{ mac, label, addedAt }` | `[{ mac:'localhost', label:'Server itself' }]` | macService, my-device (client side) | `PUT /settings` (the whole list, **not validated**) |
| `display.defaultSlideDurationSeconds` | int 1–3600 | 10 | socket.buildPlaylist; admin views | `PUT /settings` (validated in `mergeDisplay`) |
| `display.showDeviceInfo` | bool | true | brandingService.displaySettings | `PUT /settings` |
| `display.logo.enabled` | bool | true | brandingService | `PUT /settings` |
| `slideshows[]` | see below | `[]` | scheduler, socket, routes, sample | routes (slideshows), sample sync |
| `sampleSlideshow` | `{ folder, signature }` | absent | sampleSlideshow, the `isSample` route | sample sync |
| `sampleSlideshowAdded` | legacy bool | absent | sample sync (migration) | removed by setting it to `undefined` (dropped when serialised) |

A slideshow entry looks like `{ folder, name, priority, schedule: { type: 'always' | 'timed', days?: [0-6], startTime?: 'HH:MM', endTime?: 'HH:MM' }, enabled, hidden?, slideDurationSeconds?, addedAt }`.
- A missing `enabled` counts as enabled.
- `hidden` is stored only when true.
- `slideDurationSeconds: null` means "use the default".

### 5.2 Environment

| Variable | Source | Used by |
|---|---|---|
| `SECURE_COOKIES` | `.env`, loaded by systemd `EnvironmentFile=` (nothing reads `.env` in Node; there is no dotenv) | adminSession cookie `secure` flag |
| `NOTICEBOARD_LOG_LEVEL` | `.env` or the shell, for troubleshooting only | logger: `debug` adds the debug lines |
| `NODE_ENV` | still in an older Pi's `.env` (`production`) | **nothing** (older code read it; the upgrade rehearsal's baseline still does) |
| `NOTICEBOARD_SYSTEMD_DIR` | tests only | pathHelpers.systemdDir |
| `NOTICEBOARD_BRANCH` | the user (a one-off) | update.sh |
| `NOTICEBOARD_INSTALLER_SHA`, `NOTICEBOARD_INSTALLER_BRANCH`, `NOTICEBOARD_MODE`, `NOTICEBOARD_INSTALL_BRANCH` | install.sh, set when it re-runs itself | install.sh |
| `PORT` | mentioned in `.env.example` | **nothing** (dead) |

### 5.3 Hard-coded settings (not configurable)

- **Admin:** default password `Admin@12345` (`config/passwordDefaults.js`); JWT lifetime 7 days and cookie `nb_admin_token` (`services/adminSession.js`); new passwords at least 8 characters (`shared/contract.json` `limits.passwordMinLength`).
- **Rate limits:** API 120/min; login 5/15 min; branch-switch password 5 wrong/15 min.
- **Uploads:** 500 MB per file, 50 files; logo upload 20 MB; logo fits within 500×500.
- **Scheduler and viewer:** at most 5 active slideshows; scheduler interval 60 s; display clock constants in `slideshowClock.js`.
- **Updates:** a stale update counts after 60 min; switch token lasts 5 min; timer every 15 min; kiosk exit request expires after 60 s.
- **Kiosk:** the server kiosk URL is `http://localhost:3000/` regardless of `config.port` (see §16).

### 5.4 Browser storage

- `localStorage['noticeboard:navCollapsed']`, set by the admin panel: `'1'` or `'0'`.
- `sessionStorage['noticeboard:lastRecoveryReload']`, set by the viewer: a timestamp.

---

## 6. Persistent data

Under `/opt/noticeboard` on a server Pi. Every item below already exists on current installations, except where marked "if used".

| Item | Format | Created by | Read by | Changed by | Depended on by |
|---|---|---|---|---|---|
| `data/config.json` | JSON (JSON5 allowed) | configService.init / installer (via configService) | configService, update.sh and install.sh (port) | configService | everything |
| `data/slideshows/<folder>/slideshow.json` | JSON `{ slides: [...] }` | `slideshowStore.create` (atomic), sample sync | only `slideshowStore` (for the routes, uploadQueue, the playlist and the sample sync) | only `slideshowStore.modifySlides` (locked; written only when changed) | the viewer (through the playlist), the admin panel |
| `data/slideshows/<folder>/slides/<uuid>.png\|.mp4` | media | uploadQueue (processing), sample sync (copy, keeping the extension: `.png`, `.mp4`, and `.jpg/.gif/.webp/.webm` possible) | `/media` static | slide delete, slideshow delete, sample replace | viewer, admin |
| `data/slideshows/<folder>/slides/<uuid>-thumb.jpg` | JPEG | mediaService.createThumbnail | `/media` | slide delete, sample replace | admin list and preview |
| `data/branding/logo.png` | PNG within 500×500 | brandingService.saveLogo | `/branding/logo`, logoVersion (mtime) | removeLogo | viewer waiting screen, admin sidebar |
| `data/update-branch.env` | `KEY=value` lines | requestSwitch (via updates/updateFiles), update.sh, install.sh | update.sh, install.sh, updates/updateFiles | same | branch following |
| `data/update-status.json` | flat JSON, all values strings | install.sh (printf), update.sh (write_json), requestSwitch (JSON.stringify) | services/updates (getInfo, versionInfo) | same | Software updates card, sidebar "Last updated" |
| `data/update-check.json` | flat JSON | update.sh | updates/updateFiles | update.sh | Software updates card |
| `data/update-notice.json` | flat JSON | update.sh (branch merged) | updates/updateFiles | dismissNotice (deletes) | home page notice |
| `data/installer.json` | `{ version (number), branch, commit, time }` | install.sh (last step of a server install) | updates/installerVersion (`installedVersion`) | install.sh | home page installer box, switch check |
| `data/backups/<time>-from-<branch>/…` | copies of the `.json`/`.env` files in `data/` | update.sh before a branch switch | the admin (manually) | none | recovery |
| `tmp/noticeboard-uploads/upload-*`, `logo-*` | uploaded files | multer (slides, logo) | uploadQueue, brandingService | deleted after processing | **update.sh** (upload-in-progress check) |
| `tmp/update-request` | text | requestSwitch | the systemd path unit, update.sh | update.sh deletes it; install.sh deletes it | instant switches |
| `tmp/update.lock` | empty | update.sh / install.sh | flock | none | mutual exclusion |
| `tmp/update-failed-commit` | a SHA | update.sh | update.sh | update.sh | skipping a bad commit |
| `logs/app.log` (+ rotated `app1.log`, …) | winston JSON lines, 5 MB × 3 | logger | people | logger | troubleshooting |
| `/opt/noticeboard/.env` | env file (must exist: the unit's `EnvironmentFile=`) | install.sh (only if missing) | systemd | nobody | `SECURE_COOKIES`; an older install's `NODE_ENV` line is unused |
| `/opt/noticeboard/start-kiosk.sh` (untracked in git) | bash | install.sh | autostart; **updates/installerVersion** (installer version heuristic) | install.sh | server kiosk |
| `client/admin/dist/`, `client/display/dist/` | built SPAs | `npm run build` (install.sh, update.sh) | Express static; displayBuildId | every build | viewer and admin |

Outside the install folder:

| Item | Created by | Purpose |
|---|---|---|
| `/etc/systemd/system/noticeboard.service`, `noticeboard-update.{service,timer,path}` | install.sh | server and updater |
| `/etc/xdg/autostart/noticeboard-kiosk.desktop` | install.sh | starts the kiosk script at login |
| `/usr/local/bin/noticeboard-kiosk.sh` | install.sh (remote display) | display kiosk |
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
| Slides cycle with a fade; each image for its duration; videos to the end; unattended for months | `slideshowClock.js`, `SlideShow.vue`, `SlideFrame.vue`, `ImageSlide.vue`, `VideoSlide.vue` |
| A playlist change waits for the current slide to finish | `slideshowClock.setSlides` (pending) |
| "No slideshow published" with the logo; a pulsing dot while disconnected | `WaitingScreen.vue`, `brandingService.displaySettings` |
| Location pin with the server's address | `DeviceInfo.vue` → `GET /api/device` (`network.lanInterfaces`) |
| Exit button (kiosk only), cursor hides when idle | `ExitKiosk.vue`, `useActivity.js`, device.js exit requests, kiosk scripts |
| Screens reload after an update; nightly reload; recovery reload | `useSocket.js` (`display:build`), `recovery.js`, `displayBuildId.js` |
| Login, 7-day session, logout | `LoginView`, `auth.js`, `adminAuth.js`, router guard |
| Default-password warning on every page | `DefaultPasswordWarning`, `useSecurity`, `adminPassword.usesDefault` |
| Slideshow list: publish/disable, hide/unhide, delete (not the sample), create | `SlideshowsView`, `routes/api/slideshows.js` |
| Slideshow detail: name, priority, duration, schedule; publish, hide | `SlideshowDetailView`, `SlideshowSettingsCard`, `ScheduleEditor`, `slideshows.js` PUT |
| Upload images and videos; processing status; polling | `SlideList`, `slides.js`, `uploadQueue`, `mediaService` |
| Reorder and delete slides; preview; thumbnails; "Create thumbnails" | `SlideList`, `SlidePreview`, `slides.js` |
| Scheduling (always, or timed days/times), priority, maximum 5 active | `schedulerService` |
| Sample slideshow (updated by software updates, hideable, not deletable) | `sampleSlideshow.js`, `sample-data/` |
| Display settings (default duration, pin), logo upload/toggle/reset | `DisplaySettingsCard`, `LogoSettings`, `settings/general.js` and `settings/logo.js`, `settingsService`, `brandingService` |
| MAC filtering with the warning pop-up and "add this device" | `MacFilterCard`, `MacFilterWarning`, `macFilter`/`macService`/`macLookup`, `settings/general.js` my-device |
| Password change | `PasswordCard`, `settings/security.js`, `adminPassword` |
| Software updates: status, branch switch with two confirmations, software check, merged-branch notice, installer-needed box | `components/updates/` (SoftwareUpdates, UpdateStatus, BranchSwitcher, SwitchDialogs, UpdateNotice, InstallerNotice), `useUpdateInfo`, `services/updates`, `systemCheck`, update.sh |
| Sidebar: logo, By Fructus Sum, links, Last updated, collapse | `NavBar`, `NavIcon`, `useNav`, `useBranding` |
| User guide | `noticeboard-guide.html`, served at `/admin/help` |

---

## 8. Installation

Entry point: `curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash`, or `sudo bash installers/install.sh`.

`install.sh` (242 lines) holds the configuration, the switch to the latest installer, the loading of its parts and `main()`, which is called on the last line, so a half-downloaded script runs nothing. `set -euo pipefail`. The steps are in `installers/lib/*.sh` and the kiosk scripts in `installers/kiosk/` (§12.9).

1. **Root check** (`EUID`).
2. **`use_latest_installer`**. Unless `NOTICEBOARD_INSTALLER_SHA` is set:
   - Find the branch this Pi follows from `data/update-branch.env` (`followed_branch`), else `main`.
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
   7. `.env` if missing (`SECURE_COOKIES=false`; older installers also wrote `NODE_ENV=production`, which nothing reads now).
   8. `save_branch_setting`: writes `update-branch.env` only if the branch changed, and always writes `update-status.json` (`state: updated`).
   9. `write_service`, `daemon-reload`, `enable`, `restart noticeboard`.
   10. `write_server_kiosk` (`installers/kiosk/server.sh` as it is → `/opt/noticeboard/start-kiosk.sh`), `write_autostart`, `write_help_shortcut file://…/noticeboard-guide.html`.
   11. `chown -R <user> /opt/noticeboard`.
   12. `write_update_units` (service, path, timer), enable the timer and path units.
   13. `write_installer_record` → `data/installer.json` (`INSTALLER_VERSION=2`).
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
3. If `tmp/update-request` exists, delete it at once and set `requested` and `force`. `--force` also sets `force`.
4. `flock -n tmp/update.lock`. If it's busy, write `status: requested` (for a switch) and exit 0.
5. `PREVIOUS_BRANCH` = the current symbolic ref, `CURRENT` = `HEAD`. `valid_branch`, else cancel and restore the setting.
6. The service must be `active` or `activating`, else `check: waiting`.
7. Uploads in progress (a file younger than 60 min in `tmp/noticeboard-uploads`) → `check: waiting`.
8. **Merged-branch return**, when following a non-main branch and not switching: `branch_merged`.
   - Fetch main.
   - If the branch was deleted (`ls-remote` exit code 2), compare `CURRENT`.
   - Otherwise require main to have moved on from `MAIN_AT_SWITCH`.
   - Then `merge-base --is-ancestor`, or `merge-tree --write-tree` to detect a squash or rebase.
   - If merged: `write_branch_setting main`, `switching=1`, `RETURNED_FROM`.
9. `git fetch origin +refs/heads/B:refs/remotes/origin/B`. On failure: a switch is cancelled; a deleted branch gives `check: error`; otherwise `check: offline`.
10. `TARGET = origin/B`. If it equals `CURRENT`: when switching, check out the branch and write the notice or status. Always `check: up-to-date`.
11. A previously failed target (`tmp/update-failed-commit`) is skipped unless forced.
12. `refuse_reason`: the target has files in `data tmp logs .env`, or (when switching) its `update.sh` lacks the text `update-branch.env`.
13. On a switch, `backup_settings` → `data/backups/<time>-from-<prev>/`.
14. `status: updating`. `PORT = server_port` (node + configIO).
15. `install_commit`: `checkout --force -B`, `npm install --include=dev`, `npm run build`, `npm prune --omit=dev`. On failure: re-install `CURRENT` → `rolled-back`, or `failed`.
16. `wait_for_uploads` (at most 30 min), then `restart_server`:
    - `kill -TERM` the `MainPID`; systemd restarts the service.
    - Wait up to 90 s for a new PID that answers `GET http://localhost:$PORT/api/auth/status`.
    - On failure, roll back and restart again.
17. Success: remove the failed-commit file, write the status (`updated`, the switched message, or the merged notice), `remember_main` (records `NOTICEBOARD_MAIN_AT_SWITCH` after a switch to a non-main branch), `check: up-to-date`.

`write_json` (`lib/json.sh`, shared with the installer) builds flat JSON objects from strings in bash, stripping control characters and escaping `\` and `"`, and replaces the file atomically.

### 9.2 Server side (`services/updates/`)

- **`getInfo`:** git HEAD and branch, the configured branch, the status file, the check file, whether the timer and path units are enabled (from the `*.wants` symlinks), whether a request is pending, and `busy` (requested or updating less than 60 min ago).
- **`checkBranch`:** `ls-remote`, fetch, the same refusals as `update.sh`, the latest commit's subject and date, and `requirementsOf(commit)`. The latter reads `system-requirements.json` at that commit, runs `systemCheck.checkRequirements`, and calls `installerNeeds`.
- **The switch has three steps:** `checkBranch`, then `verify-password` issues a one-time token, then `switch` consumes it and calls `requestSwitch`.
  - `requestSwitch` rechecks the branch and refuses missing software unless `acceptMissing`.
  - `updateFiles.saveSwitch` writes the branch file, then `status: requested`, then the request file, and restores all three on failure.
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
- Chromium runs with flags that suppress error dialogs, the infobar, update checks and the first-run pages, with its own `--user-data-dir`.
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
| multer | middleware/uploads.js (and the error class in slides.js) | uploads |
| sharp (native) | mediaService, brandingService | images and the logo |
| fluent-ffmpeg | mediaService | video transcoding, duration, thumbnails (needs the `ffmpeg` and `ffprobe` binaries) |
| p-queue 7 (ESM only) | uploadQueue (`require('p-queue').default`) | processing queue. Needs Node's `require(esm)`, available from **Node 20.19** or **22.12** |
| node-arp | macLookup | MAC lookup |
| socket.io / socket.io-client | realtime/displaySocket.js / useSocket.js | real-time channel |
| winston | logger | logging |
| vue, vue-router | client apps | UI |
| **cors** | **nothing** | unused dependency |

Build only (npm's devDependencies, removed by `npm prune --omit=dev` after the build): `vite`, `@vitejs/plugin-vue` (the client builds). **Unused:** `nodemon` (server) and `concurrently` (root): to be removed when `package-lock.json` is next regenerated on Linux (§16 #7).

### 11.2 System programs

| Program | Used by | For |
|---|---|---|
| `node` 20.19+ or 22.12+, `npm` | server, installers | runtime and build |
| `git` 2.38+ (for `merge-tree --write-tree`) | installers, updates/git.js | install, update, branch info |
| `ffmpeg`, `ffprobe` | mediaService | video |
| `curl` | installers, kiosk scripts | downloads, health and exit checks |
| `chromium` / `chromium-browser` | kiosk scripts | display |
| `arp` (net-tools) | node-arp | MAC filter |
| `systemctl`, `systemd-run`, `flock`, `runuser`, `logger`, `xset`, `xdg-user-dir`, `getent`, `visudo`, `passwd`, `ss`, `ps`, `sshd`, `ufw`, `firewall-cmd`, `nft`, `iptables`, `apt-get`, `apt-cache`, `hostname`, `stat` | installers | OS set-up |

`system-requirements.json` lists Node.js, npm, Git, FFmpeg, FFprobe, curl and Chromium, with version ranges and install hints. It also holds `installer.version` and `installer.changes`.

---

## 12. File and module map

Layout of each entry: **purpose** · responsibilities · key functions · imported by → imports · configuration · data · external · relied on by.

### 12.1 Server entry and wiring

**`server/index.js`**
- **Purpose:** process entry point, and the systemd `ExecStart` target.
- **Responsibilities:** start-up order, listen, graceful shutdown.
- **Functions:** `main()`, `shutdown()`.
- **Imports:** configService, schedulerService, sampleSlideshow, app, realtime/displaySocket, logger.
- **Configuration and environment:** `port`.
- **Relied on by:** systemd (the path `server/index.js` is baked into the unit file), `npm start`, update.sh (restart), and the test harnesses.

**`server/app.js`**
- **Purpose:** the Express app factory, `createApp()`: helmet, json, cookies, `mountRoutes`, `errorHandler`.
- **Imported by:** index.js.

**`server/realtime/displaySocket.js`**
- **Purpose:** the only socket.io module. `initDisplaySocket(httpServer)`: on connect sends `display:build` and `display:settings`; answers `display:ready` with the playlist; broadcasts `playlist:update` on the scheduler's `'update'` and `displayEvents.playlistChanged`, and `display:settings` (only when changed) on a config `'change'` and `displayEvents.displaySettingsChanged`.
- **State:** inside the function: the io server and the last settings sent.
- **Imports:** socket.io, schedulerService, configService, displayEvents, playlistService, brandingService (`displaySettings`), displayBuildId, logger, `shared/contract.json`.
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
- **API:** `requireApprovedDevice(area)`: resolve the device; deny with a plain-text 404 `Not Found`; log `<area>: MAC denied` (or "MAC filter error" / "Admin auth error" when resolving fails, as before); set `req.clientMac`. `requireAdmin`: `requireApprovedDevice('Admin')`, then the session cookie: 401 `{error:'Not authenticated'}` without one, or 401 `{error:'Session expired'}` with the cookie cleared and "Admin: JWT invalid" logged; sets `req.admin`.
- **Imports:** macService, adminSession, logger.

**`middleware/macFilter.js`**, **`middleware/adminAuth.js`**
- **Purpose:** one-line names for `requireApprovedDevice('Display')` and `requireAdmin`, so the routes read as before.
- **Used by:** routes/index.js (media, help, logo, admin, display) and api/index.js (auth, device: macFilter; settings, slideshows and slides: adminAuth).

**`middleware/asyncRoute.js`**
- **Purpose:** `route(handler)`: an async handler whose rejection goes to `next(err)`.
- **API:** `route(handler)` (a rejection → `next(err)`) and `jsonRoute(handler)` (sends the returned value; an error marked `expose` → its status and `{ error }`).
- **Used by:** auth.js, slideshows.js, slides.js, and every settings route. No route has its own try/catch any more (D36 resolved).

**`middleware/uploads.js`**
- **Purpose:** `createUpload({ prefix, maxFileBytes, allowed, rejectMessage })`, the one multer set-up. Files wait in `tmp/noticeboard-uploads/` as `<prefix>-<time>-<random><ext>` (update.sh waits for that folder); a refused type is an Error with status 400.
- **Used by:** slides.js, settings/logo.js.

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
- **Purpose:** login, logout, status.
- **Owns:** the login rate limit (5 per 15 minutes).
- **Uses:** adminPassword (`verify`), adminSession (`issue`, `clear`, `isLoggedIn`), asyncRoute, logger.

**`routes/api/device.js`**
- **Purpose:** the server's addresses for the pin, and kiosk exit requests.
- **Functions:** `deviceOf` (loopback → `this-server`, else the plain address).
- **State:** the `exitRequests` Map.
- **Uses:** `network` (`lanInterfaces`, `plainAddress`, `isLoopback`).
- **Relied on by:** the kiosk scripts (exact JSON).

**`routes/api/settings/`**
- **`index.js`:** mounts the four parts under `/api/settings` (their paths don't overlap).
- **`general.js`:** `GET/PUT /` (settingsService), `/device` (network), `/my-device` (`req.clientMac`).
- **`security.js`:** `/security` and `/password` (adminPassword).
- **`logo.js`:** `/logo` GET/POST/DELETE (`logoInfo`, uploads with prefix `logo`, 20 MB, `LOGO_MIME`; brandingService; `displayEvents.displaySettingsChanged`).
- **`updates.js`:** the software-update routes and `/version` (services/updates, `jsonRoute`, the branch-switch password limiter: 5 wrong per 15 min).

**`routes/api/slideshows.js`**
- **Purpose:** slideshow CRUD, thin.
- **Functions:** `describe` (adds `sample` and `slideCount`).
- **Uses:** slideshowStore (list, find, create, replace, remove, slideCount), slideshowRules (duration, hide rule, `isSample`, the sample message), asyncRoute, displayEvents (`playlistChanged` after a change), logger.

**`routes/api/slides.js`**
- **Purpose:** slide upload, list, delete, reorder, thumbnails, thin.
- **Owns:** a slideshow-exists middleware and its multer error handler.
- **Uses:** slideshowStore (find, readSlides, modifySlides, slideFileExists, removeSlideFiles), uploads (`createUpload`: prefix `upload`, 500 MB, the media MIME types), mediaTypes, uploadQueue, asyncRoute, displayEvents, logger.
- **Side effects:** `displayEvents.playlistChanged()` after delete and reorder.

### 12.4 Services

**`services/configService.js`**
- **Purpose:** a singleton EventEmitter owning `data/config.json` in memory.
- **API:** `init()`, `get(key?)`, `set(key, value)` (emits `'change', key, value`), `update(partial)` (a shallow assign; emits `'change'`).
- **Defaults:** `_generateDefaults()` hashes `DEFAULT_PASSWORD` from `config/passwordDefaults.js`.
- **Output:** through the logger. The installer's first-install `node -e … init()` therefore prints the "Created default config.json" line in the logger's format, and creates `logs/` before the installer's `chown -R`.
- **Imported by:** nearly every server module, and **install.sh** (`init()`).

**`services/adminPassword.js`**
- **Purpose:** the admin password.
- **API:** `verify(password)` (bcrypt with `config.passwordHash`; throws for a non-string, like before), `change(current, next)` → `{ ok }` or `{ status, error }` (400 missing, 400 too short, 403 wrong current; then `configService.set('passwordHash')`), `usesDefault()` (cached per hash), `MIN_LENGTH`.
- **Used by:** auth.js, settings/security.js, settings/updates.js.

**`services/adminSession.js`**
- **Purpose:** the login session. `COOKIE_NAME` (`nb_admin_token`), `issue(res)` (JWT `{role:'admin'}`, 7 days, httpOnly, sameSite strict, `secure` from `SECURE_COOKIES`), `verifyToken`, `tokenOf(req)`, `isLoggedIn(req)`, `clear(res)`.
- **Used by:** auth.js, access.js.

**`services/schedulerService.js`**
- **Purpose:** a singleton EventEmitter giving the active slideshows (enabled, not hidden, schedule matches; sorted by `priority ?? 999`; top 5).
- **API:** `init()`, `stop()`, `getActive()`, `computeActive()`, `_matchesSchedule`.
- **Emits:** `'update'`.
- **Uses:** configService (its `'change'` event), slideshowStore (the list), logger.

**`services/macService.js`**
- **Purpose:** request → `{ mac, ip, approved }`; `isMacApproved(mac)` checks config.
- **API:** `resolveRequest`, `isMacApproved` (`getClientIp` is internal).
- **Uses:** macLookup, configService, logger.

**`services/mediaService.js`**
- **Purpose:** the media types and processing.
- **API:** `processImage` (sharp → PNG), `processVideo` (ffmpeg → H.264 MP4), `getVideoDuration` (ffprobe), `createThumbnail`.
- **Used by:** slides.js, uploadQueue.

**`services/mediaTypes.js`**
- **Purpose:** every media type list, in one place, each exactly as its caller had it.
- **API:** `IMAGE_MIME`, `VIDEO_MIME`, `typeFromMime`, `LOGO_MIME`, `SERVED_EXTENSIONS` (including the unused audio types), `SAMPLE_IMAGE_EXT`, `SAMPLE_VIDEO_EXT`.
- **Used by:** slides.js, settings/logo.js, routes/index.js (`/media`), uploadQueue, sampleSlideshow.

**`services/uploadQueue.js`**
- **Purpose:** p-queue (concurrency 2) for processing and thumbnails.
- **API:** `enqueueProcessing`, `enqueueThumbnail`, `queueSize`, `updateSlide` (internal: `store.modifySlides`; a slide deleted meanwhile stays deleted).
- **Side effects:** updates `slideshow.json` through the store, deletes the temporary upload, `displayEvents.playlistChanged()` once a slide is ready.
- **Used by:** slides.js, sampleSlideshow.

**`services/brandingService.js`**
- **Purpose:** the logo (fit 500×500, save, remove, placeholder cache, version = mtime) and `displaySettings()`.
- **Used by:** realtime/displaySocket.js (`displaySettings`), routes/index.js, settings/logo.js.

**`services/sampleSlideshow.js`**
- **Purpose:** `syncSampleSlideshow()`. It signs the sample files together with `sample.json`, and creates, restores (hidden) or replaces the sample's slides. It applies the `sample.json` settings and migrates the legacy `sampleSlideshowAdded` flag.
- **Replacing the slides:** `store.modifySlides` saves the new list first; the old files are deleted after, so `slideshow.json` never points at missing files. The config (entries + `sampleSlideshow` + removing the legacy flag) is written in one `store.commitEntries`.
- **Uses:** slideshowStore, mediaTypes (which sample files are slides), configService (`sampleSlideshow`), pathHelpers, slugify, uploadQueue, logger.

**`services/slideshowStore.js`**
- **Purpose:** the one owner of the slideshow entries (`config.slideshows`) and each `data/slideshows/<folder>/` (its `slideshow.json` and `slides/`).
- **API:** `list`, `find`, `create` (folder, `slides/`, an empty `slideshow.json`, an unpublished entry with the next priority), `replace`, `remove` (entry, then folder), `commitEntries(entries, other)`, `readSlides` (missing/broken → no slides; other keys kept; no slides list → no slides), `modifySlides(folder, fn)` (locked; written only if fn changed the data), `slideCount`, `slideFileExists`, `removeSlideFiles`.
- **Uses:** configService, configIO, slideshowLock, pathHelpers, slugify.
- **Used by:** slideshows and slides routes, uploadQueue, sampleSlideshow, schedulerService, playlistService.

**`services/playlistService.js`**
- **Purpose:** `buildPlaylist(active)` → `{ slides: [{ type, url, duration, slideshow }] }` (§3.4).
- **Uses:** slideshowStore, configService (the default duration), pathHelpers (`mediaUrl`).
- **Used by:** realtime/displaySocket.js.

**`services/displayEvents.js`**
- **Purpose:** the explicit channel to the displays: `playlistChanged()`, `displaySettingsChanged()`, and `onPlaylistChanged(fn)` / `onDisplaySettingsChanged(fn)` for displaySocket.
- **Used by:** slideshows.js, slides.js, settings/logo.js, uploadQueue; displaySocket listens.

**`services/slideshowRules.js`**
- **Purpose:** `parseSlideSeconds` (1–3600 from the contract, the same message), `applyHiddenRule(before, updated)` (409 with the same two messages; `hidden` stored only when true), `isSample(folder)`, `SAMPLE_DELETE_ERROR`.
- **Used by:** slideshows.js, settingsService (the default duration).

**`services/settingsService.js`**
- **Purpose:** `publicSettings()` (config without `passwordHash`, `jwtSecret` and `_comment`) and `applyPatch(body)`: only `port`, `macFiltering` and `display`; display merged and validated (`mergeDisplay`); `port` and `macFiltering` saved as sent (not validated, as before); one `configService.update`. It returns `{ settings, keys }` or `{ status: 400, error }` with the same messages.
- **Used by:** settings/general.js.

**`services/updates/`**
- **`index.js`:** `getInfo`, `versionInfo`, `getNotice`/`dismissNotice`, `installerStatus`, `listBranches`, `checkBranch` (+ `requirementsOf`), `requestSwitch`; re-exports `validBranchName`, `issueToken` and `takeToken`. Errors for the admin carry `expose`. Used by settings/updates.js.
- **`git.js`:** `git(args, timeout)` in ROOT, never prompting.
- **`branchName.js`:** `validBranchName`, the JS twin of `installers/lib/branch.sh` `valid_branch` (kept in step by `tests/installers/branch-names.sh`).
- **`updateFiles.js`:** the one owner of the files shared with update.sh: `readBranchSetting`, `readStatus`/`readCheck`/`readNotice`, `deleteNotice`, `requestPending`, `unitsEnabled`, `saveSwitch` (the three writes in order, restored on failure).
- **`installerVersion.js`:** `installedVersion` (record, else the kiosk-script heuristic), `installerNeeds`, `status`. Also used by server/test/installer.test.js.
- **`switchTokens.js`:** `issue`, `take` (5 minutes, one use, one branch).

### 12.5 Utilities

**`utils/pathHelpers.js`**
- **Purpose:** every path under ROOT (the repository folder).
- **Built apps:** `displayDistDir()` and `adminDistDir()` are the only definitions of those paths.
- **Used by:** almost every server module.

**`utils/configIO.js`**
- **Purpose:** `readConfig` (JSON5), `writeConfig` (atomic pretty JSON, temporary file `.tmp`), `writeFileAtomic` (any text, temporary file `.<pid>.tmp` by default), `readJsonFile` (plain JSON or null).
- **Used by:** configService, slideshowStore, updates/updateFiles, updates/installerVersion, and **install.sh and update.sh** (the port, via `node -e`).

**`utils/logger.js`**
- **Purpose:** the winston logger. Creates `logs/` when first required. JSON lines to the console (the journal on a Pi) and to `logs/app.log`; info and above, or debug too with `NOTICEBOARD_LOG_LEVEL=debug`.

**`utils/macLookup.js`**
- **Purpose:** `isLocalhost` ("this Pi itself" for MAC filtering: the set `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`, **empty string**, kept on purpose: §14 D6) and `lookupMac` (node-arp, lower-cased).
- **Uses:** `network.plainAddress`.

**`utils/network.js`**
- **Purpose:** `plainAddress` (strips `::ffff:`), `isLoopback` (127.0.0.0/8, `::1`, `::ffff:127.x`: the kiosk-exit rule), `lanInterfaces()` (non-internal IPv4 interfaces with their MACs).
- **Used by:** device.js, settings/general.js, macLookup, macService.

**`utils/slugify.js`**
- **Purpose:** `slugify`, and `uniqueSlug`, which checks folder existence under `data/slideshows`.

**`utils/slideshowLock.js`**
- **Purpose:** `withSlideshowLock(folder, fn)`, a per-folder promise chain. Only slideshowStore uses it.

**`utils/displayBuildId.js`**
- **Purpose:** a hash of the built display `index.html`.


**`utils/systemCheck.js`**
- **Purpose:** `checkRequirements`, `satisfies`, `describe`, `parseVersion`. Runs only safe commands and arguments.

### 12.6 Viewer (`client/display`)

| File | Purpose | Uses | Notes |
|---|---|---|---|
| `index.html`, `main.js` | mount | App.vue | inline base styles (duplicated in App.vue's `<style>`) |
| `App.vue` | composition, `?kiosk=off`, idle cursor | useSocket, useActivity, recovery, the four components | |
| `composables/useSocket.js` | socket.io client; playlist, settings, build reload | `@shared/constants` SOCKET_EVENTS, recovery | `'connect'`/`'disconnect'` are socket.io built-ins |
| `composables/useActivity.js` | activity with real mouse moves; idle after 3 s | none | |
| `recovery.js` | `reloadWhenServerUp`, `reloadSoon`, `recoverByReloading`, `startDailyReload` | sessionStorage | |
| `slideshowClock.js` | all slide timing (pure, injectable timers) | none | tested by `client/display/test/slideshowClock.test.mjs` |
| `composables/usePageWake.js` | `usePageWake(callback, { online })`: visibilitychange, resume, pageshow, focus (and online) | none | |
| `components/SlideShow.vue` | layers, fade, page lifecycle → `clock.resume` | SlideFrame, clock, recovery, usePageWake (with online) | |
| `components/SlideFrame.vue` | image or video with the generation tag | ImageSlide, VideoSlide | |
| `components/ImageSlide.vue` | `<img>` (`src` only; the clock decides how long it shows) | none | |
| `components/VideoSlide.vue` | `<video>` muted autoplay; plays again when the page wakes | usePageWake (without online) | |
| `components/WaitingScreen.vue` | dot or logo + "No slideshow published" | none | |
| `components/CornerButton.vue` | the faint round button in a top corner (`corner`, `opacity`, `hoverOpacity`; icon in the slot) | none | |
| `components/ScreenDialog.vue` | the dark centred card for pop-ups | none | |
| `components/DeviceInfo.vue` | pin (top left, 0.3 → 0.8) and pop-up: the server's addresses and port, and the viewer's URL (never the admin panel's); `GET /api/device` | CornerButton, ScreenDialog | its own 90 s auto-close timer |
| `components/ExitKiosk.vue` | exit button (top right, 0.5 → 0.9), confirm; `POST /api/device/kiosk-exit` | CornerButton, ScreenDialog | its own 60 s auto-close timer |

### 12.7 Admin (`client/admin`)

| File | Purpose | Uses | Notes |
|---|---|---|---|
| `main.js`, `router/index.js` | imports `styles/base.css`; mount after the router is ready; routes; login check (`api.get('/auth/status', { redirectOn401: false })`, never redirects by itself) | Vue Router, useApi | |
| `styles/base.css` | the global styles: CSS variables, layout, buttons, cards, fields, messages, badges (moved from App.vue unchanged) | none | |
| `App.vue` | the layout (sidebar + page) | NavBar, DefaultPasswordWarning, useNav | |
| `composables/useApi.js` | one `request` core behind `api.get/post/put/del/upload`; a 401 → the login page, unless `redirectOn401: false` (then thrown like any error); errors carry `status` and `serverMessage` | none | |
| `composables/useSlideshowActions.js` | `setEnabled`, `setHidden` (errors shown in an alert, as before) with `toggling` / `hiding` busy state | useApi | |
| `composables/useFlash.js` | a reactive `{ text, tone, ok(text, clearAfterMs), error(text), clear() }` for "Saved." and error messages | none | |
| `composables/useUpdateInfo.js` | the Software updates data: `GET /settings/updates` and `/branches`, polling every 3 s while an update runs or the server restarts, reloading the page when another version runs; helpers `short`, `when`, `runningName`, `canSwitch`, `missingSoftware` | useApi | |
| `composables/useBranding.js`, `useSecurity.js`, `useNav.js` | shared singleton state | useApi / localStorage | |
| `views/LoginView.vue` | login form: a wrong password or "too many tries" shown on the page, "Could not reach server" without an answer | useApi | |
| `views/SlideshowsView.vue` (256) | home: notices, device banner, list, create, publish, hide, delete | useApi, useSlideshowActions, StatusBadge, PublishToggle, TagPill, UpdateNotice, InstallerNotice | |
| `views/SlideshowDetailView.vue` (99) | loads the default duration, the slideshow (404 → the list) and its slides; the header with its tags; the disabled banner | useApi, SlideshowSettingsCard, SlideList, TagPill | |
| `views/SettingsView.vue` (34) | loads `GET /settings` once for the Display and MAC cards; the cards in order | useApi, the settings and updates cards | |
| `components/slideshow/SlideshowSettingsCard.vue` | the settings facts, publish/disable, hide/unhide, the edit form (name, priority, duration) | useApi, useSlideshowActions, useFlash, ScheduleEditor, StatusBadge, PublishToggle, FlashMessage, `@shared` LIMITS | |
| `components/slideshow/ScheduleEditor.vue` | always/timed, times, days (v-model; two fields, no wrapper) | none | |
| `components/slideshow/SlideList.vue` | upload, rows, reorder, delete, missing thumbnails, polling while processing, preview (hover or pinned) | useApi, SlidePreview, `@shared` mediaUrl | |
| `components/slideshow/SlidePreview.vue` | hover or pinned preview | `@shared` mediaUrl | |
| `components/settings/DisplaySettingsCard.vue`, `MacFilterCard.vue` (with `MacFilterWarning`), `PasswordCard.vue`, `LogoSettings.vue` | one Settings card each | useApi, useFlash, FlashMessage; `@shared` LIMITS (duration, password); useSecurity (password); useBranding (logo) | |
| `components/NavBar.vue` | sidebar | useApi, useBranding, useNav, NavIcon, `@shared` PROJECT_URL | |
| `components/NavIcon.vue` | inline SVG icons | none | |
| `components/DefaultPasswordWarning.vue` | red banner | useSecurity | |
| `components/updates/UpdateNotice.vue` | dismissable updater notice | useApi | |
| `components/updates/InstallerNotice.vue` | run-the-installer box | useApi, `@shared` installerCommand | |
| `components/updates/SoftwareUpdates.vue` (83) | the card: puts the parts together, shows the outcome of the last attempt | useUpdateInfo, UpdateStatus, BranchSwitcher, SwitchDialogs | |
| `components/updates/UpdateStatus.vue` | the facts (running, updates, last check, last update) and the progress box | useUpdateInfo helpers | |
| `components/updates/BranchSwitcher.vue` | branch name, Check branch, the result with the software and installer panels, "Switch to …" | useApi, useUpdateInfo helpers | |
| `components/updates/SwitchDialogs.vue` | Missing software → warnings and password → last chance, each a ModalDialog; focus, Esc, no cancelling while an answer is on its way | useApi, ModalDialog, useUpdateInfo helpers | |
| `components/settings/MacFilterWarning.vue` | warning and how-to pop-ups in one ModalDialog (Esc/outside: back from the how-to, else cancel); `GET /settings/my-device` | useApi, ModalDialog | |
| `components/ui/StatusBadge.vue`, `PublishToggle.vue` (`small`, `busy`), `TagPill.vue`, `ModalDialog.vue` (`role`, `labelledby`, `tag`; emits `close` on Esc or outside; attributes go to the card), `FlashMessage.vue` (`flash`, `tag`) | shared pieces | none | |

### 12.8 Shared client code

**`shared/contract.json`** and **`shared/index.js`**
- `contract.json`: `socketEvents`, required by the server (realtime/displaySocket.js) and imported by index.js.
- `contract.json` also has `limits` (`passwordMinLength`, `slideSeconds { min, max }`), read by adminPassword and slideshowRules.
- `index.js`: `SOCKET_EVENTS` (the viewer), `LIMITS` (the duration inputs, the password card), `PROJECT_URL` (NavBar), `installerCommand(branch)` (InstallerNotice), `mediaUrl(folder, file)` (SlideList, SlidePreview; the same as the server's `pathHelpers.mediaUrl`, checked by a unit test). The unused `API_BASE` is gone.
- **Rule:** public values only (they are built into the browsers' JavaScript).

### 12.9 Installers

**`installers/install.sh`** (see §8): the configuration (including `INSTALLER_VERSION` and the list of parts), `main()`, the switch to the latest installer (`use_latest_installer`, `run_installer_from`, `use_branch_installer`, `followed_branch`: they run before any part is loaded, so they stay here; `followed_branch` keeps its simple name check, which only chooses which installer to download) and the loader (`load_modules`, `download_modules`, `load_modules_from`). Each part has the module header described at the top of this document.

| Part | What it has | Used by |
|---|---|---|
| `lib/ui.sh` | `has_tty`, `ask`, `ask_yes_no`, `ask_choice` (the 1/2 questions), `ask_port`, `ask_yes_in_time`, `banner`; `choose_mode`, `choose_branch`, `offer_reboot` | main, sudo, display, server, firewall |
| `lib/branch.sh` | `valid_branch` (the full rule), `read_branch_setting`, `read_main_at_switch`, `write_branch_setting` (atomic) | ui, server, **update.sh** |
| `lib/json.sh` | `write_json`, `json_string` | server (`update-status.json`), **update.sh** |
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
| `package.json` (root) | workspaces; `build` (display, then admin); `test`; `dev`; **used by install.sh and update.sh** (`npm install`, `run build`, `prune`). |
| `server/package.json`, `client/*/package.json` | workspace dependencies; the server `dev` script. |
| `client/*/vite.config.js` | the `@shared` alias; `base` (`/` and `/admin/`). |
| `.env.example` | documentation only. Its `PORT` line is misleading. |

---

## 13. Important functions: relationships and change impact

| Function | Location | Callers | Calls | Reads | Writes / side effects | If it changes… |
|---|---|---|---|---|---|---|
| `configService.init` | services/configService.js | index.js, **install.sh** | configIO, bcrypt, crypto | config.json | creates `data/`, `data/slideshows/`, and config.json (or regenerates it on a parse error) | install.sh first run; every server start |
| `configService.set/update` | same | routes (slideshows, settings), sample sync | writeConfig | none | writes the whole config; emits `'change'` → scheduler recompute and display settings broadcast | playlists and display settings broadcasts; the persistence format |
| `schedulerService.computeActive` | services/schedulerService.js | interval, config change, init | `_matchesSchedule` | config.slideshows | emits `'update'` when the folder list changes | which slideshows air; playlist broadcasts |
| `buildPlaylist` | services/playlistService.js | displaySocket (broadcast, `display:ready`) | slideshowStore, pathHelpers | config, slideshow.json (via the store) | none | **the viewer contract** (`{ slides: [{ type, url, duration, slideshow }] }`); the clock's change detection (JSON signature) |
| `broadcastPlaylist` (inside displaySocket) | realtime/displaySocket.js | scheduler `'update'`, `displayEvents.playlistChanged` (slideshows PUT, slide DELETE/reorder, uploadQueue) | buildPlaylist, io.emit | as above | socket emit | every display |
| `broadcastDisplaySettings` (inside displaySocket) | realtime/displaySocket.js | config `'change'`, `displayEvents.displaySettingsChanged` (logo) | brandingService.displaySettings | config, logo mtime | socket emit (deduplicated) | pin and logo on the displays |
| `macService.resolveRequest` | services/macService.js | macFilter, adminAuth | macLookup, isMacApproved | config.macFiltering, ARP | none | who can reach anything; `/settings/my-device` via `req.clientMac` |
| `store.modifySlides` | services/slideshowStore.js | slides.js (4×), uploadQueue.updateSlide, sampleSlideshow.replaceSlides | withSlideshowLock, readSlides, writeConfig | slideshow.json | writes it only when changed | every change to a slideshow's slides; the lock prevents lost writes |
| `writeConfig` | utils/configIO.js | configService, slideshowStore | fs | none | atomic JSON write (`.tmp` + rename) | every persisted JSON written by Node |
| `enqueueProcessing` | services/uploadQueue.js | slides.js POST | mediaService, updateSlide, broadcastPlaylist | tmp upload | media file, slideshow.json, deletes tmp, emits `'change'` | upload pipeline; update.sh's upload-wait |
| `syncSampleSlideshow` | services/sampleSlideshow.js | index.js | uniqueSlug, replaceSlides (store.modifySlides), store.commitEntries, enqueueThumbnail | sample-data, config | copies files, writes slideshow.json and config | sample behaviour after every update |
| `requestSwitch` | services/updates/index.js | settings/updates.js | getInfo, checkBranch, updateFiles.saveSwitch | systemd dir, files | writes the branch file, status, request (→ systemd path unit → update.sh) | **the contract with update.sh** |
| `checkBranch` | same | settings/updates.js, requestSwitch | git, requirementsOf | git objects | fetches a remote-tracking branch | the switch checks shown to the admin |
| `installedInstallerVersion` / `installerNeeds` | same | installerStatus, requirementsOf, test | readJson, fs | installer.json, start-kiosk.sh, system-requirements.json | none | the home page installer box, switch warning |
| `versionInfo` | same | settings/updates.js `/version` | git, readJson | HEAD, update-status.json | none | sidebar "Last updated" |
| `adminPassword.usesDefault` | services/adminPassword.js | settings/security.js `/security` | bcrypt | config.passwordHash | cache | the default-password banner |
| `requireApprovedDevice` / `requireAdmin` | middleware/access.js | every route (via macFilter/adminAuth) | macService, adminSession | config.macFiltering, ARP, the cookie | 404 / 401 responses, logs | **who can reach anything**; the 404 and 401 conventions other programs rely on |
| `displaySettings` | services/brandingService.js | realtime/displaySocket.js | logoVersion, configService | config.display, logo mtime | none | the `display:settings` payload |
| `createSlideshowClock` | client/display/src/slideshowClock.js | SlideShow.vue, tests | injected timers | none | none | all viewer timing (tested) |
| `useApi.request` | client/admin/src/composables/useApi.js | every admin component | fetch | none | redirects to login on 401 | every admin call; the 401-vs-403 convention |
| `run_installer_from` / `use_latest_installer` | install.sh | main, use_branch_installer | curl, bash -n, exec | update-branch.env | exec replaces the process | which installer version runs (and what old installers accept: a line starting `INSTALLER_VERSION=`) |
| `install_server` | install.sh | main | many | several | the whole server set-up | installations |
| `install_commit` / `restart_server` | update.sh | main | git, npm, kill, curl | config port | the code on disk, restart | every automatic update |
| `branch_merged` | update.sh | main | git fetch, ls-remote, merge-base, merge-tree | update-branch.env | none | auto-return to main |

---

## 14. Shared and duplicated behaviour

Behaviour that exists, or existed, in more than one place. Where there is one owner now, the third column also names the copies it replaced, because their differences explain the owner's rules. Where copies remain, it says whether they're really equivalent.

| # | Behaviour | Copies | Differences |
|---|---|---|---|
| D1 | Read `slideshow.json` (**one owner:** `slideshowStore.readSlides` only, with the union of these behaviours, and a file without a slides list read as no slides) | `slideshows.js readSlideshowJson`, `slides.js readSlideshowJson`, `uploadQueue.js readSlideshowJson`, inline in `socket.buildPlaylist`, inline in `sampleSlideshow.replaceSlides` | The first three are equivalent: a missing or unparseable file gives `{ slides: [] }`. socket.js does no `existsSync` check; an error gives `{ slides: [] }`, and it assumes `data.slides` exists (a file without a `slides` key would throw inside the loop, which isn't caught). sampleSlideshow keeps the other keys (`...old`) and treats a missing `slides` as `[]`. |
| D2 | Write `slideshow.json` | **One owner:** `slideshowStore` only (`create` and `modifySlides`, both atomic) | none |
| D3 | Find a slideshow entry in the config | **One owner:** `slideshowStore.find` / `list` only | none |
| D4 | Slide duration rule (integer 1–3600) | Server: `slideshowRules.parseSlideSeconds` only (limits from the contract). The admin inputs use the same `LIMITS` | Same message and bounds. `null` is allowed only for a slideshow's own duration. |
| D5 | Image duration fallback | socket.buildPlaylist (`?? 10` default), slideshowClock `DEFAULT_IMAGE_SECONDS = 10`, SlideshowDetailView and SettingsView fall back to `?? 10` | The client's copies are only fallbacks. |
| D6 | Loopback detection | `macLookup.isLocalhost` (the exact set, **including the empty string**), `device.js LOOPBACK` (the whole 127.0.0.0/8 range, `::1`, `::ffff:127.*`; no empty string) | **Not equivalent.** 127.0.0.2 is "loopback" for kiosk exit but not for the MAC filter. An empty IP is local for the MAC filter. |
| D7 | Strip `::ffff:` | **One owner:** `network.plainAddress` only | none |
| D8 | MAC filter check and deny | **One owner:** `middleware/access.js` only (the area keeps the two log messages) | none |
| D9 | Verify the admin password (**one owner:** `adminPassword.verify`; each caller keeps its status code) | auth.js login, settings.js password, settings.js updates/verify-password | Different statuses on purpose: login gives 401; the others give 403. verify-password also rejects an empty or non-string password. |
| D10 | Default password literal | Server: `config/passwordDefaults.js` only. Still also in the install.sh summary, README and guide (text for people) | Same value. |
| D11 | JWT verify and cookie name | **One owner:** `services/adminSession.js` only | none |
| D12 | Password minimum length 8 | **One owner:** `shared/contract.json`, via adminPassword (server) and `LIMITS` (PasswordCard) | none |
| D13 | Multer disk storage in `tmp/noticeboard-uploads` (**one owner:** `middleware/uploads.js`, each caller keeping its limits and messages) | slides.js (`upload-…`), settings.js logo (`logo-…`) | Different limits (500 MB vs 20 MB), filters and field names. The same folder is required by update.sh. |
| D14 | Media type lists (**one owner:** all of them now live in `mediaTypes.js`, each unchanged) | mediaService `IMAGE_MIME`/`VIDEO_MIME`; the settings.js logo MIME list (the same four image types); the routes/index.js extension allowlist (adds audio types); sampleSlideshow `IMAGE_EXT`/`VIDEO_EXT`; the admin `accept="image/*,video/*"` and logo `accept` list | They overlap without being identical. |
| D15 | Media URL `/media/<folder>/slides/<file>` | **One owner:** pathHelpers.mediaUrl (server) and `shared` mediaUrl (admin panel), kept equal by a unit test | none |
| D16 | Dist paths | **One owner:** `pathHelpers.displayDistDir` and `adminDistDir` only | none |
| D17 | SPA fallback router | **One owner:** `routes/spa.js` | none |
| D18 | Socket event names | **One owner:** `shared/contract.json` only | none |
| D19 | Page lifecycle events | **One owner:** `usePageWake` (SlideShow with `online`, VideoSlide without, as before) | none |
| D20 | Corner button and pop-up styling (**one owner:** CornerButton and ScreenDialog), auto-close timers (still one each; different lengths) | DeviceInfo.vue, ExitKiosk.vue | Opacity differs (0.3 vs 0.5); timeouts 90 s vs 60 s. |
| D21 | Publish/Disable badge and toggle; toggleEnabled; setHidden; `.tag` | **One owner:** StatusBadge, PublishToggle (`small` on the slideshow page), TagPill, useSlideshowActions, used by SlideshowsView and SlideshowSettingsCard | none |
| D22 | Modal overlay and dialog CSS, Esc handling | **One owner:** ModalDialog, used by MacFilterWarning and SwitchDialogs. SlidePreview keeps its own lighter overlay (hover preview, no Esc-to-cancel meaning) | none |
| D23 | Flash message with auto-clear | **One owner:** useFlash + FlashMessage (the settings card, the four Settings cards); the tone is set by the caller | none |
| D24 | 401 handling | **One owner:** one `request` in useApi; the router guard and LoginView use it with `redirectOn401: false` | none |
| D25 | Read the branch setting | **One owner:** `lib/branch.sh` `read_branch_setting` for install.sh and update.sh; install.sh's `followed_branch` keeps its own read (it runs before the parts are loaded); the server's updateFiles.readBranchSetting | Equivalent reads. |
| D26 | Branch-name validation | **One owner:** `lib/branch.sh` `valid_branch` (install.sh's choose_branch and update.sh) and updates/branchName.validBranchName, kept equal by `tests/installers/branch-names.sh`. Only `followed_branch` keeps a simple check: it only chooses which installer to download, and a bad name falls back to main's | none |
| D27 | Write the update status JSON | **One owner:** `lib/json.sh` `write_json` (install.sh and update.sh, escaped and atomic), services/updates `JSON.stringify`. `installer.json` keeps its own `printf` (its version is a number) | Same keys, apart from install.sh's shorter set. |
| D28 | Read the port from config | install.sh `slideshow_port` (lib/system.sh), update.sh `server_port`, index.js | Equivalent: each is a small wrapper around `node -e` + configIO.readConfig, the one definition. Kept: update.sh loads only branch.sh and json.sh, so the update path depends on as little as possible. |
| D29 | Node version rule | the installer's `node_new_enough` (lib/system.sh), system-requirements.json (`>=20.19.0 <21.0.0 \|\| >=22.12.0`) | Equivalent: the installer accepts `20.x ≥ 19`, `22.x ≥ 12` or `≥ 23`. Checked on 20.18, 20.19, 21.7, 22.11, 22.12, 23.1 and 24.0, where both accept and reject the same versions. There are two copies because the installer runs before the repository exists. |
| D30 | Kiosk scripts | Two whole-script templates, `installers/kiosk/server.sh` and `display.sh`, no heredoc escaping | Their shared parts (browser detection, FLAGS, xset, the exit handling, the restart loop) are still written twice: sharing them would change the installed scripts, which this refactor keeps byte-for-byte (a later, reviewed change with `INSTALLER_VERSION`). |
| D31 | Yes/no and 1/2 prompts | **One owner:** `lib/ui.sh` `ask_yes_no` and `ask_choice` (check_sudo_password, choose_mode, choose_branch) | none |
| D32 | "Installation complete" banner | **One owner:** `lib/ui.sh` `banner` (both summaries and the opening heading) | none |
| D33 | `readJson` / atomic write helpers | **One owner:** `configIO.readJsonFile` and `writeFileAtomic` (the old `.<pid>.tmp` name by default; `writeConfig` keeps `.tmp`) | none |
| D34 | The staleness rule for an update (60 min) | updates/index.js inProgress (`busy`), UpdateStatus statusView ("Didn't finish") | The client relies on the server's `busy`. |
| D35 | `configService.emit('change')` as a general "refresh displays" signal | **One owner:** `displayEvents` says what changed; config `'change'` means config.json changed | none |
| D36 | Async route boilerplate | **One owner:** `asyncRoute.route` and `jsonRoute` (the old `updateRoute`) | none |

---

## 15. External contracts an installed system relies on

An installed Pi receives new code through the `update.sh` that is **already on disk**. The installer, the kiosk scripts and the systemd units change only when the installer is run again. The new code must therefore keep every one of these working:

**Run by systemd and the old updater**
1. **`installers/update.sh`** must stay at that path: the update service runs it.
2. **`server/index.js`** must stay the entry point, run from `/opt/noticeboard` with `/usr/bin/node`. The root `package.json` must keep the scripts `npm install`, `npm run build` and `npm prune --omit=dev`, run from the repository root, and `build` must produce `client/display/dist` and `client/admin/dist`.
3. **`GET /api/auth/status`** must answer 2xx on `localhost:<config.port>` within 90 s of a restart. This is the old updater's health check; failing it causes a rollback.
4. **`server/utils/configIO.js`** must keep exporting `readConfig(path)` returning a promise of the parsed config. `update.sh` and `install.sh` load it with `node -e` to read the port.
5. **`server/services/configService.js`** must keep exporting `init()`: `install.sh` calls it on the first install.
6. The **new update.sh must still contain the text `update-branch.env`**. Otherwise older Pis refuse to switch to the branch.
7. **Nothing may be tracked under `data/`, `tmp/`, `logs/` or `.env`.** Otherwise every updater refuses the commit.
8. The **`tmp/noticeboard-uploads/`** folder must stay the place where uploads wait, because update.sh waits for it.
9. **`tmp/update-request`** starts an update; the server writes it, and the systemd path unit watches for it.

**Kiosk scripts** (not updated by sync)
10. `GET /` answers 200 when the device is allowed and 404 when MAC filtering blocks it.
11. `POST /api/device/kiosk-exit/claim` returns **exactly** `{"exit":true}` when an exit was requested, with no spaces.
12. `?kiosk=off` turns off the kiosk behaviours in the viewer.

**Help shortcuts and links**
13. `/opt/noticeboard/noticeboard-guide.html` (the server's `file://` shortcut) and `/admin/help` (the display shortcut) must stay where they are.
14. The guide anchors the admin panel links to must stay.

**Files in `data/`** (formats and paths unchanged)
15. `config.json` (JSON5-readable, with every key in §5.1), `slideshows/<folder>/slideshow.json` (slide fields in §5.1 and §6), media names, `branding/logo.png`, `update-branch.env`, `update-status.json`, `update-check.json`, `update-notice.json`, `installer.json` and `backups/`.

**Viewer and admin pages already open in browsers**
16. They keep running old code until they reload, so:
    - socket.io must stay at `/socket.io`, with the event names `display:build`, `display:ready`, `playlist:update` and `display:settings` and their payloads.
    - The viewer reloads when `display:build` changes, after fetching `/` successfully.
    - The admin panel polls `GET /api/settings/updates` and reloads when `commit` changes.

**Sessions and URLs**
17. The session cookie `nb_admin_token`, signed with `config.jwtSecret`, must be accepted, so admins stay logged in across the update.
18. These URLs must stay: `/`, `/admin`, `/admin/*`, `/admin/help`, `/media/<folder>/slides/<file>`, `/branding/logo?v=`, and every `/api` path in §4.1 (the admin panel is rebuilt with the code, but the kiosk scripts and open tabs are not).

**Browser storage**
19. The keys `noticeboard:navCollapsed` and `noticeboard:lastRecoveryReload` (merely nice to keep).

**The installer and the kiosk**
20. What older installers look for when they hand over: `installers/install.sh` must exist at every commit. It must pass `bash -n`, and for non-main branches contain a line starting with `INSTALLER_VERSION=`. **Old installers download only this one file.**
21. The installer version heuristic reads `/opt/noticeboard/start-kiosk.sh`.

---

## 16. Defects, dead code and inconsistencies found

Known issues, kept on purpose until someone decides to change the behaviour: fixing one is a behaviour change, made and reviewed on its own. Fixed ones are struck through and keep their number (code comments refer to them).

1. **socket.io is not MAC filtered.** An unapproved device can connect and receive playlists: file names and slideshow folders, but not the media, which `/media` blocks.
2. **The server kiosk URL is hard-coded to port 3000.** Changing `config.port` would break the server Pi's own screen until the kiosk script is edited.
3. **An empty client IP counts as localhost** in the MAC filter (`LOCALHOST_IPS` contains `''`).
4. **`PUT /api/settings` does not validate `port` or the `macFiltering` shape.** A bad value is saved as it is. A port change takes effect only after a restart.
5. ~~adminAuth ran twice for every slide route.~~ Fixed (one check per request; `tests/api/admin-check-once.js`).
6. ~~`buildPlaylist` assumed `data.slides` exists.~~ Fixed: the store reads such a file as no slides.
7. **Unused npm packages:** `cors`, `concurrently` and `nodemon`. Removing them changes `package-lock.json`, which must be regenerated on Linux (never with `npm install` on Windows, which drops the Pi's platform packages from it).
8. The media route allows audio extensions (`.mp3 .wav .ogg`) that nothing produces.
9. ~~`.env.example` documented a `PORT` override that nothing reads.~~ Fixed.
10. ~~configService avoided the logger over a circular dependency that doesn't exist.~~ Fixed: it uses the logger.
11. ~~The README said the installer always runs main's installer.~~ Fixed: it says the followed branch's.
12. ~~`npm test` fails on Node 20.~~ Fixed: `tests/run.js` lists the test files itself.
13. The admin panel ignores reorder errors (`.catch(() => {})`), so the order shown can differ from what was saved.
14. ~~install.sh's branch-name check was looser than update.sh's.~~ Fixed (D26); only `followed_branch`, which picks the installer to download, keeps a simple check.
15. ~~install.sh wrote `update-status.json` with `printf` and no JSON escaping.~~ Fixed: it uses `write_json`.
16. `configService.init` **regenerates the defaults when `config.json` doesn't parse**. The admin password, the MAC list and the slideshow list are then lost from the config, although their folders remain.
17. `configService.update` merges only the top level. `PUT /settings` therefore replaces the whole `macFiltering` object, which is intended (the admin panel sends everything).
18. **Changing the default image duration doesn't resend the playlist** (found by `tests/api/socket-events.js`; it has always been so). Slideshows without their own duration keep the old one on screen until the playlist is next sent: a publish, upload, reorder or delete, a scheduler change, or a display reconnecting. The behaviour is unchanged; fixing it would be a behaviour change for its own decision.
19. **A message's clear timer can clear a later message** (it has always been so): "Saved." clears itself after 2 seconds (3 for "Password changed."), whatever the card shows by then. Saving twice within 2 seconds, the second failing, shows its error only briefly. `useFlash` keeps this; not cancelling the earlier timer would be a small behaviour change for its own decision.

---

## 17. Tests

Run them with `node tests/run.js <group> [filter]` or the npm scripts. `npm run build` must come first for api, browser and upgrade.

| Group (npm script) | Where | What it covers | Needs |
|---|---|---|---|
| unit (`npm test`) | `server/test/`, `client/display/test/` | the slide clock (15 tests, including 30 simulated days); installer version ↔ system requirements (5); the Node.js version rule in installers/lib/system.sh ↔ system-requirements.json (1); the shared foundations: address helpers, both loopback rules, media type lists, contract event names, and `shared/index.js` ↔ the server (mediaUrl, LIMITS) (7) | Node 20+ |
| api (`test:api`) | `tests/api/` | **contract.js**: 78 entries recorded in `tests/fixtures/api-contract.json`. They cover every route's status, content type and JSON shape, the exact MAC-denied page (seen from the PC's network address), the kiosk-exit answer, the cookie attributes, the socket events and a playlist. Also: branch switching end to end with the real update.sh (31 checks), the slideshow lifecycle, upload errors and stress, graceful shutdown, one admin check per request (`admin-check-once.js`, from the debug log), **the data files byte-for-byte** for a fixed script of actions (`data-files.js` ↔ `tests/fixtures/data-files.json`), the store's edge cases (`slideshow-store.js`), and **what a display receives for 15 admin actions** (`socket-events.js` ↔ `tests/fixtures/socket-events.json`), and the "app not built" pages (`spa-fallback.js`) | Node 22+; ffmpeg for video |
| browser (`test:browser`) | `tests/browser/` | branch-switching UI, installer notice, Last updated, login loop, MAC warning, mobile layout, sidebar, merged notice, viewer and admin (QALife batch 1), slideshows and media (batch 2, with video), viewer reliability A–E, and the viewer controls' computed styles (`viewer-look.js` ↔ `tests/fixtures/viewer-look.json`), the admin panel's computed styles (`admin-look.js` ↔ `tests/fixtures/admin-look.json`, 82 elements on desktop and phone), the larger pages' computed styles and texts (`admin-pages-look.js` ↔ `tests/fixtures/admin-pages-look.json`: the slideshow page with its edit form, schedule and preview, the Settings cards, the branch check and the Missing software dialog; 57 elements and 6 texts), and the login page (`login-page.js`) | Chrome (the runner starts a headless one) |
| installers (`test:installers`) | `tests/installers/` | install flow, branch choice, handover, self-update (the real-GitHub check only with `NB_TEST_NETWORK=1`), sudo, firewall, kiosk scripts, update.sh (updates, branches, merged return), **the module loader** (`module-loader.sh`: local, at a commit, the followed branch, missing or broken parts, the baseline installer handing over). They load the installer through `tests/helpers/installer.sh` (`load_installer`), as a real run loads its parts. Plus two comparisons: **golden files** (the 10 generated files ↔ `tests/fixtures/installer-golden/`) and **branch names** (`lib/branch.sh` ↔ the server, `tests/fixtures/branch-names.txt`) | bash (Git Bash on Windows) |
| upgrade (`test:upgrade`) | `tests/upgrade/` | **the upgrade rehearsal**, in three steps. Nothing about the data, API, playlist, login or kiosk answer may change at any step. | bash, Node |

The upgrade rehearsal works like this:
1. An installed baseline (`NB_BASELINE`, default `fc4ba53`), with data seeded through its own API, takes the working tree through **its own** update.sh.
2. The new update.sh installs a following commit.
3. It goes back to the baseline.

Helpers:
- `tests/run.js` is the runner. It lists the files itself, so it works on Node 20, and it finds Chrome and Git Bash.
- `tests/helpers/app.js` makes throwaway app copies and servers.
- `tests/helpers/cdp.js` is the Chrome client.
- `tests/upgrade/state.js` seeds and takes the snapshots for the rehearsal.

The snapshot files are recorded from the baseline. They are recorded again (`NB_UPDATE_SNAPSHOT=1`) only for a deliberate, reviewed change.

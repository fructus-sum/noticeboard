# Noticeboard

A self-hosted digital notice board and slideshow system designed to run on a Raspberry Pi 4. Displays images and videos on a local-network screen, managed through a browser-based admin panel. Screens are built to run unattended for months: they recover from outages, sleep and crashes by themselves, and pick up new versions without anyone touching them.

## Features

- **Slideshow display** — full-screen, looped playback of images and videos; says "No slideshow published" when there's nothing to show
- **Runs unattended** — the slideshow never stops cycling: it survives server restarts and outages, hidden or sleeping screens, slides that won't load and browser crashes, with no clicks or keyboard needed ([details](#running-unattended))
- **Sample slideshow** — every install includes an unpublished five-slide sample (four images at 3 seconds each, and a short video) to try the display with
- **Multiple slideshows** — create named series, each with its own schedule and priority (max 5 active simultaneously)
- **Scheduling** — set slideshows to run always, or only on specific days and times
- **Media processing** — upload images and videos in any standard format; automatically converted to PNG and H.264 MP4 via Sharp and FFmpeg
- **Admin panel** — browser-based control panel for managing content and settings; after login, the home page shows the Pi's IP and MAC address, and the sidebar shows when the installed version was last updated (the date of its commit on GitHub; click it to open the project)
- **Device address button** — a faint pin in the top-left corner of every display shows the noticeboard's IP address and port
- **MAC address filtering** — optionally restrict display access to approved devices
- **Automatic updates** — the server Pi installs new versions from GitHub by itself, and every screen reloads to show them
- **Branch selection** — choose which GitHub branch updates come from (`main`, or one with work in progress) in the admin panel; the branch is checked first, the switch needs the admin password and a final confirmation, and a switch that fails is rolled back by itself
- **Raspberry Pi installer** — one setup script for both server and remote display Pis

## Access

Both served on port `3000`:

| Path | Purpose | Auth |
|---|---|---|
| `/` | Slideshow display | MAC filter (optional) |
| `/admin` | Admin panel | MAC filter + password |

**Default admin password: `Admin@12345` — change this immediately after first login.**

## Installation

One installer sets up either kind of Pi, running Raspberry Pi OS with the desktop (the current release, Trixie, or Bookworm). Run it on the Pi, from a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
```

or, from a copy of this repository:

```bash
sudo bash installers/install.sh
```

It asks:

1. **What the Pi is for:** *Server + display* or *Remote display* (see below).
2. **The server URL** (remote displays only), e.g. `http://192.168.1.10:3000`. The pin in the top-left corner of the server's screen shows its address.
3. **Whether to keep the branch** (server Pis that [follow a branch other than `main`](#switching-branch) only): keep it, or go back to `main`.
4. **Whether `sudo` should ask for a password.** Raspberry Pi OS lets the desktop user run `sudo` without one. If you answer yes, the installer backs up the rule in `/etc/sudoers.d`, turns it off, and has you type your password once to prove it works before keeping the change. If the password doesn't work, the rule goes straight back, so you can't be locked out.
5. **Firewall (optional):** at the end it offers to check or set up a firewall, and changes nothing unless you say yes. See the user guide for details.

Running it again is safe: it offers your previous answers, so Enter keeps them. It never touches your slideshows, slides or settings.

It always runs its newest version: whichever copy you start, it first downloads the installer from the latest commit on GitHub `main` and runs that. When it's done, it offers to reboot (Enter = yes). To run a local copy exactly as it is, e.g. to test changes to it: `sudo NOTICEBOARD_INSTALLER_SHA=local bash installers/install.sh`.

### Server + display (hosts content, runs the server, acts as primary display)

- Updates the Pi's software first (`apt-get update`, then a full upgrade), which can take a while on a Pi that hasn't been updated recently
- Installs Node.js 20, FFmpeg, and Chromium
- Clones the repo to `/opt/noticeboard` (or updates it, on the branch it follows) and builds the display and admin SPAs
- Creates a `noticeboard` systemd service (starts on boot, restarts on crash)
- Sets up [automatic updates](#updates)
- Creates an XDG autostart entry that opens Chromium in kiosk mode at `http://localhost:3000/` once the server answers, and opens it again if it ever closes or crashes (works with `chromium` or `chromium-browser`; to see what it did since boot: `journalctl -t noticeboard-kiosk -b`)

After the installer's reboot, the display appears automatically.

### Remote display (connects to an existing server)

- Updates the Pi's software first, the same way
- Installs Chromium
- Creates a kiosk start script at `/usr/local/bin/noticeboard-kiosk.sh`, started at login. It checks the server every 10 seconds and, until the server answers, shows a local waiting page with this Pi's MAC address and the reason it's waiting: the server can't be reached, or the server's MAC filter hasn't approved this display yet. As soon as the server lets it in, the slideshow replaces the waiting page by itself. If the browser ever closes or crashes, it opens again.

After the installer's reboot, the kiosk starts automatically.

## Running unattended

A display needs nobody to touch it, and nothing on it depends on clicks, keyboard focus or the page being visible. The display page and the kiosk scripts handle these cases:

| When… | The display… |
|---|---|
| A slide is due to change | moves on at its deadline: images after their duration, videos when they end. A watchdog checks every 2 seconds, so a missed timer (a hidden, frozen or throttled page) can't hold it up. |
| A slide won't appear (a download that never finishes, a video that won't start) | skips it after 30 seconds |
| A video stops playing | skips it after 30 seconds without progress; a video the browser paused (e.g. while the screen was asleep) is started again |
| The screen sleeps and wakes, or the page is hidden or frozen | catches up as soon as it runs again |
| The server restarts, loses power or drops off the network | keeps what it has on screen, reconnects by itself, and carries on within seconds of the server coming back. While nothing can load, it tries again every 30 seconds instead of spinning through slides. |
| A new version is installed on the server | reloads itself onto it once the server answers again (the server tells every display which version it runs) |
| Every slide keeps failing (three whole rounds) | reloads the page, at most once every 30 minutes |
| It has been running for a day | reloads once between 2 and 5 am, while connected, clearing anything the browser has built up |
| The browser closes or crashes | the kiosk script opens it again after 5 seconds, once the server answers |

Every reload first checks that the server answers, so a screen is never left on a browser error page.

The slide timing is covered by automated tests (`npm test`), including a simulated 30 days (over 600,000 slide changes, with outages, sleep and missed timers). The display was also tested in a real browser with pages frozen, downloads that never finish, server crashes, the network dropping and the CPU slowed down 20 times.

**Leaving full screen.** Moving the mouse over a screen shows an exit button in its top-right corner. After a confirmation, that screen's full-screen browser closes and the slideshow opens in a normal browser window, so you can use the browser or get to the desktop; nothing else changes, and the screen goes back to full screen at its next start-up. Kiosk mode only ever applies to the slideshow: the kiosk browser has a profile of its own, so a browser opened from the Pi's desktop, e.g. for the admin panel, is an ordinary window. (Pis installed before this need the installer run again once.)

To see what a display is doing: `journalctl -t noticeboard-kiosk -b` on its Pi shows the kiosk script's log, and `noticeboard.slideshow()` in the browser's DevTools console shows the slideshow's current state.

## Updates

The server Pi keeps itself up to date with a branch on GitHub: `main`, unless another branch was chosen in the admin panel.

- Every 15 minutes, `noticeboard-update.timer` checks GitHub. If nothing is new, nothing happens.
- When the branch has a new commit, `installers/update.sh` installs it, rebuilds, and restarts the server. Screens, including remote display Pis, reload themselves a few seconds later to show the new version.
- It waits while an upload is being processed. If the new version fails to build or doesn't answer after the restart, it puts the previous version back and skips that commit until a newer one arrives.
- It never changes or deletes your slideshows, slides or settings (everything in `data/`), and refuses any commit that would put files there.
- It runs as the Pi's desktop user, not root, so it never needs `sudo`.

**Admin panel → Settings → Software updates** shows the branch and version running, when updates were last checked and what that check found, and the result of the last update or switch.

### Switching branch

`main` is the stable version. Other branches hold work in progress, and a Pi can follow one to try it out.

1. In **Settings → Software updates**, type or pick a branch and click **Check branch**. The noticeboard checks the branch exists on GitHub and can be used, then shows the change, current → proposed (branch and version), with the branch's latest commit. Nothing has changed yet.
2. **Switch to *branch*…** opens a warning: the branch is experimental, may not work with this setup, may be unstable, and may change how it stores your data. Enter the admin password to continue. A wrong password cancels the switch and changes nothing (after 5 wrong passwords, wait 15 minutes).
3. A final pop-up, **"Last chance to avoid doing something stupid!"**, says your password was accepted and this is the last chance to back out. **Cancel** leaves everything as it is; **Confirm** starts the switch straight away.
4. The branch is saved as the one to update from, and the normal update process starts at once, from that branch. The card follows it: installing and building (the noticeboard keeps running), then the restart. Screens reload themselves onto the new version. Every later check, every 15 minutes, uses the new branch until you switch again.

A switch starts within seconds because the installer sets up `noticeboard-update.path`, which runs the updater as soon as the admin panel asks. On a Pi whose installer ran before branch switching existed, a switch starts at the next check instead (within 15 minutes); the card says which. Run the installer once to fix that.

**When the branch is merged into `main`, the Pi goes back to `main` by itself.** Once all of the branch's work is in `main` (merged, squashed or rebased in) and `main` has moved on since the switch, the next check switches back to `main`. The same happens if the branch is deleted after being merged. A branch deleted without being merged is left alone, because its features aren't in `main`. Going back uses the normal switch, including the rollback if it fails. When it's done, a notice on the admin home page says so and stays until someone closes it.

Some branches can't be chosen, and the check says why:

- branches that don't exist on GitHub, or names that aren't valid branch names
- branches older than branch switching: their updater would ignore the setting, so the Pi couldn't be switched back from the admin panel
- branches with files in `data/`, `tmp/`, `logs/` or `.env`, which would overwrite this noticeboard's content or settings

**If a switch fails, it's undone by itself.** The Software updates card says what happened:

- If the branch can't be downloaded or turns out unusable, the switch is cancelled and nothing changes.
- If it fails to install or build, the previous branch and version are put back. The server kept running the old version the whole time.
- If it installs but doesn't start, the previous branch and version are put back and restarted.
- In every case, updates go back to following the previous branch.

Nothing is deleted. Before a switch, the settings (`data/config.json` and each slideshow's `slideshow.json`) are copied to `data/backups/<time>-from-<branch>/`, in case the other branch changes them. Slides and media are never touched. `data/update-status.json` records the previous branch and commit.

In the unlikely case that putting the previous version back fails too, the card says so, and the noticeboard keeps running for the time being. Run the installer on the Pi to put things right. It installs the branch in the settings, or offers to go back to `main`:

```bash
curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
```

### Commands

| To… | Run on the server Pi |
|---|---|
| See what the updater did | `sudo journalctl -u noticeboard-update` (or look at Settings → Software updates) |
| Check for an update now | `bash /opt/noticeboard/installers/update.sh` |
| Retry a commit it skipped | `bash /opt/noticeboard/installers/update.sh --force` |
| Switch branch | Settings → Software updates in the admin panel |
| Try a branch once, without changing the setting | `NOTICEBOARD_BRANCH=my-branch bash /opt/noticeboard/installers/update.sh` (the next check goes back to the branch chosen in Settings) |
| Go back to `main` from the Pi | run the installer and choose *Go back to main* |
| Turn automatic updates off / on | `sudo systemctl disable --now noticeboard-update.timer` / `enable --now` |

Automatic updates cover the app itself. The kiosk start scripts, the systemd units and system settings are written by the installer, so changes to those need the installer run again (it offers to reboot at the end).

**Installed before automatic updates existed?** Run the installer once; it updates everything and sets up automatic updates. Let it reboot so the display loads the new page. After that, updates are automatic.

**Remote display Pis** only need the installer run again when the kiosk script itself changes. Run it once on each Pi installed before the kiosk restarted its browser and switched off the waiting page by itself. Over SSH is fine. After that, remote displays never need a visit.

## Status

- **On `main`:** everything described in this README.
- **Tested:** the slide timing by automated tests (`npm test`, including the 30-day simulation), the display in a real browser under the disruptions above, the admin panel's branch switching end to end, and the installer and updater against stand-ins for systemd, apt and npm. The installer is in use on Raspberry Pi OS Trixie (labwc desktop).
- **Limitations:**
  - Only the server Pi updates itself; remote display Pis load the new version from it.
  - Kiosk scripts and systemd units only change when the installer runs.
  - Whatever is pushed to the followed branch on GitHub is installed within 15 minutes.
  - A display can't wake a monitor that is switched off, and screen blanking is up to Raspberry Pi OS. To keep the screen on: `sudo raspi-config` → *Display Options* → *Screen Blanking* → *No*.
  - Branch switching needs the automatic updates the installer sets up. Anywhere else, such as a development machine, the Software updates card only shows the version.

## Development

Requirements: Node.js 20.19+ (or 22.12+), FFmpeg (for video processing). `system-requirements.json` lists all the software a branch needs on the Pi; keep it up to date on every branch, in the same commit as the change that needs the software.

```bash
npm install
npm run dev        # starts server + both Vite dev servers concurrently
npm test           # the display's slide timing tests
```

| Service | URL |
|---|---|
| Server | `http://localhost:3000` |
| Display SPA (Vite) | `http://localhost:5173` |
| Admin SPA (Vite) | `http://localhost:5174/admin/` |

To build production assets:

```bash
npm run build      # outputs to client/display/dist/ and client/admin/dist/
```

## Configuration

All runtime config lives in `data/config.json` (created on first run). Edit via the admin panel or directly. Restart the server after manual edits.

Environment variables (optional, set in `.env`):

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` on the Pi |
| `SECURE_COOKIES` | `false` | Set to `true` only if serving over HTTPS |

Update files (written by the admin panel, `installers/update.sh` and the installer):

| File | Holds |
|---|---|
| `data/update-branch.env` | the branch updates come from (`NOTICEBOARD_BRANCH=…`); absent means `main` |
| `data/update-status.json` | the last update or branch switch: result, message, branch and commit before and after |
| `data/update-check.json` | the last check for updates |
| `data/backups/` | settings copied before each branch switch |
| `tmp/update-request` | the admin panel's request to update now (picked up by `noticeboard-update.path`) |

## Architecture

```
/                          ← display SPA (Vue 3)
/admin/                    ← admin SPA (Vue 3 + Vue Router)
/api/                      ← REST API (Express)
/media/:folder/slides/:f   ← media files (MAC filtered)
```

- **No database** — config in `data/config.json`, slides in `data/slideshows/<folder>/`
- **Sample slideshow** — built by the server from `sample-data/sample-slideshow/` (file names set the order: `01-…`, `02-…`; images show for 3 seconds, videos play to the end). When those files change in a new version, the sample's slides are replaced with them, since it's a demo. Once deleted, it stays deleted. `config.json` remembers it as `sampleSlideshow`.
- **Socket.io** — server pushes `playlist:update` to all connected displays when content or schedule changes, and sends `display:build` on connect so screens reload after an update
- **Slide timing** — `client/display/src/slideshowClock.js` decides when to move on (deadlines and a watchdog, independent of the page's visibility); `recovery.js` handles the safe reloads
- **Media processing** — uploads go to `tmp/`, converted by Sharp (images) or FFmpeg (videos), then moved to `data/slideshows/<folder>/slides/`
- **Updates** — `installers/update.sh`, run by `noticeboard-update.timer` (every 15 minutes) and `noticeboard-update.path` (when the admin panel asks); the admin panel's side is `server/services/updateService.js`

## Tech Stack

- **Server** — Node.js, Express, Socket.io, Winston
- **Frontend** — Vue 3, Vite
- **Media processing** — FFmpeg, Sharp
- **Storage** — JSON files + media on disk (no database)

## Documentation

A full user guide covering installation, managing slideshows, scheduling, MAC filtering, updates, branch switching and troubleshooting is included as `noticeboard-guide.html` in the project root. Open it in any browser — no server required — or click **Help** in the admin panel's sidebar, which opens it from the Pi at `/admin/help`.

## License

MIT — see [LICENSE](LICENSE)

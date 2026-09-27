# Noticeboard

A self-hosted digital notice board and slideshow system for the Raspberry Pi. It shows images and videos on screens across a local network, managed from a browser-based admin panel, and is built to run unattended for months.

**Full details are in the user guide**, [`noticeboard-guide.html`](noticeboard-guide.html): open it in any browser, click **Help** in the admin panel, use the **Noticeboard Help** shortcut the installer puts on the Pi's desktop, or go to `http://<server-ip>:3000/admin/help`. Reading it needs no login.

## Features

- **Slideshows on any screen** — images and videos, full screen, on the server Pi's own screen and on any number of remote display Pis or browsers
- **Runs unattended** — keeps cycling for months: survives outages, sleeping screens, slides that won't load and browser crashes, and reloads itself after updates
- **Kiosk with an exit** — screens run full screen; moving the mouse shows an exit button that takes just that screen back to a normal browser window. Kiosk mode never applies to the admin pages, and the cursor hides when the mouse is still
- **Several slideshows** — with schedules, priorities, and a default image duration (10 seconds) that each slideshow can override; switching slideshows never cuts a slide short
- **Hide and unhide** unpublished slideshows to tidy the list without deleting them
- **A sample slideshow** that updates bring new examples to; it can be hidden but not deleted
- **Uploads processed for you** — images to PNG, videos to H.264 MP4 (large videos take a while; carry on meanwhile), with automatic video thumbnails and a larger preview of any slide
- **Your logo** above "No slideshow published" and in the admin sidebar, or none
- **The server's address on every screen** — a faint location pin shows the Noticeboard server's IP address and port; it can be turned off
- **Admin panel** at `/admin`, usable on a phone, with a sidebar that collapses to icons, a link to open the viewer, a warning until the default password is changed, and the installed version's date
- **MAC filtering** to restrict which devices can show the slideshow
- **Automatic updates** from GitHub, with branch switching in the admin panel and automatic rollback
- **One installer** for server and remote display Pis, with an optional firewall set-up

## Access

Everything is on one port, `3000`:

| Path | Purpose | Auth |
|---|---|---|
| `/` | Slideshow viewer | MAC filter (optional) |
| `/admin` | Admin panel | MAC filter + password |
| `/admin/help` | User guide | MAC filter (optional) |

There's no separate admin port. **Default admin password: `Admin@12345`** — change it after the first login; the admin panel warns you until you do.

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
2. **The server URL** (remote displays only), e.g. `http://192.168.1.10:3000`. The pin in the top-left corner of the server's screen shows it.
3. **Whether to keep the branch** (only on server Pis that follow a branch other than `main`): keep it, or go back to `main`.
4. **Whether `sudo` should ask for a password.** Raspberry Pi OS lets the desktop user run `sudo` without one. If you answer yes, the installer backs up the rule in `/etc/sudoers.d`, turns it off, and has you type your password once to prove it works before keeping the change. If the password doesn't work, the rule goes straight back, so you can't be locked out.
5. **Firewall (optional):** at the end it offers to check or set up a firewall, and changes nothing unless you say yes. See the user guide for details.

Running it again is safe: it offers your previous answers, so Enter keeps them, and it never touches your slideshows, slides or settings. It always runs its newest version: whichever copy you start, it first downloads the installer from the latest commit of the branch the Pi follows on GitHub (`main`, unless it has been switched to another branch) and runs that. When it's done, it offers to reboot (Enter = yes). To run a local copy exactly as it is, e.g. to test changes to it: `sudo NOTICEBOARD_INSTALLER_SHA=local bash installers/install.sh`.

### Server + display (hosts content, runs the server, acts as primary display)

- Updates the Pi's software first (`apt-get update`, then a full upgrade), which can take a while on a Pi that hasn't been updated recently
- Installs Node.js 20, FFmpeg, and Chromium
- Clones the repo to `/opt/noticeboard` (or updates it, on the branch it follows) and builds the web apps
- Creates a `noticeboard` systemd service (starts on boot, restarts on crash) and sets up automatic updates
- Starts the viewer full screen (kiosk mode) at login once the server answers, in a browser profile of its own, and opens it again if it closes or crashes
- Puts a **Noticeboard Help** shortcut on the desktop

After the installer's reboot, the slideshow appears automatically.

### Remote display (connects to an existing server)

- Updates the Pi's software first, the same way, and installs Chromium
- Starts the viewer full screen at login. Until the server answers, it shows a waiting page with this Pi's MAC address and the reason it's waiting (server unreachable, or not yet approved by MAC filtering), and switches to the slideshow by itself as soon as it can
- Puts a **Noticeboard Help** shortcut on the desktop

After the installer's reboot, the kiosk starts automatically.

**Using remote displays? Give the server Pi a fixed IP address** (a reservation in your router, or a static address in Raspberry Pi OS), since the displays find it by its address. The user guide explains both.

**Installed before?** Run the installer again once on each Pi (over SSH is fine) to get the latest kiosk set-up, including the exit button. After that, the server Pi keeps itself up to date.

## Updates

The server Pi checks GitHub every 15 minutes and installs new versions by itself; every screen then reloads onto the new version. A version that fails to build or start is rolled back automatically. **Settings → Software updates** shows what's running and how updates went, and can switch the Pi to another branch (with checks, the admin password and a final confirmation); a Pi whose branch is merged into `main` goes back to `main` by itself. Your slideshows, slides and settings are never changed by an update. Before a switch, the Pi checks its software against the branch's list of what it needs (`system-requirements.json`) and warns about anything missing, with an extra confirmation to switch anyway. When a version needs something only the installer sets up (such as the kiosk), the admin panel's Slideshows page says to run the installer again and shows the command. The user guide has the details and the commands.

## Status

- **Current:** everything listed above is implemented and described in the user guide.
- **Tested:** the display's slide timing (`npm test`, including a simulated 30 days), the viewer in a real browser under outages, freezes, crashes and updates, the admin panel end to end, and the installer, kiosk scripts and updater against stand-ins for systemd, apt and the browser. The installer is in use on Raspberry Pi OS Trixie (labwc desktop).
- **Limitations:** only the server Pi updates itself (remote displays load new versions from it); kiosk scripts and system settings only change when the installer runs; a screen can't wake a monitor that is switched off (screen blanking is set in Raspberry Pi OS).

## Development

Requirements: Node.js 20.19+ (or 22.12+), FFmpeg (for video processing and thumbnails). `system-requirements.json` lists all the software a branch needs on the Pi; keep it up to date on every branch, in the same commit as the change that needs the software. The admin panel checks it before switching branch. Its `installer.version` must match `INSTALLER_VERSION` in `installers/install.sh`: raise both (and add a line to `installer.changes`) whenever the installer changes what updates can't, such as the kiosk scripts or system services.

```bash
npm install
npm run build      # both web apps, into client/display/dist and client/admin/dist
npm start          # the server: the viewer at http://localhost:3000/, the admin panel at /admin
npm test           # unit tests: slide timing, installer versions, the Node.js version rule
npm run test:all   # everything below, in turn (build first)
```

The other test groups each run a throwaway copy of the app, never this folder's `data/`:

- **`test:api`:** the HTTP and socket contract (compared with `tests/fixtures/api-contract.json`), uploads, branch switching and shutdown.
- **`test:browser`:** the admin panel and viewer in a real Chrome, including the reliability scenarios. It starts a headless Chrome itself (`CHROME_PATH` to choose one).
- **`test:installers`:** the installer and `update.sh` with stand-ins for systemd, apt and GitHub, including the files the installer writes (compared with `tests/fixtures/installer-golden/`).
- **`test:upgrade`:** an installed baseline takes the current code through its own `update.sh`, and nothing may change.

Video tests need ffmpeg: on the `PATH`, or set `FFMPEG_PATH` and `FFPROBE_PATH`. The installer tests need bash (Git Bash on Windows).

There is one version of the software: run on a PC, it works exactly as on a Pi. After changing the viewer or the admin panel, run `npm run build` again; after changing the server, restart it. Changes are tried out on a GitHub branch, which a Pi can follow (Settings → Software updates).

Runtime settings live in `data/config.json` (created on first run); slideshows and their slides in `data/slideshows/`. On a Pi, systemd loads `/opt/noticeboard/.env`: `SECURE_COOKIES=true` only when serving over HTTPS, and `NOTICEBOARD_LOG_LEVEL=debug` for more detail in the log when troubleshooting.

## License

MIT — see [LICENSE](LICENSE)

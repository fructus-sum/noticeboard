# Noticeboard

A self-hosted digital notice board and slideshow system designed to run on a Raspberry Pi 4. Displays images and videos on a local-network screen, managed through a browser-based admin panel.

## Features

- **Slideshow display** — full-screen, looped playback of images and videos
- **Multiple slideshows** — create named series, each with its own schedule and priority (max 5 active simultaneously)
- **Scheduling** — set slideshows to run always, or only on specific days and times
- **Media processing** — upload images and videos in any standard format; automatically converted to PNG and H.264 MP4 via Sharp and FFmpeg
- **Admin panel** — browser-based control panel for managing content and settings; after login, the home page shows the Pi's IP and MAC address
- **Device address button** — a faint pin in the top-left corner of every display shows the noticeboard's IP address and port
- **MAC address filtering** — optionally restrict display access to approved devices
- **Automatic updates** — the server Pi installs new versions from GitHub `main` by itself, and screens reload to show them
- **Raspberry Pi installer** — one setup script for both server and remote display Pis

## Access

Both served on port `3000`:

| Path | Purpose | Auth |
|---|---|---|
| `/` | Slideshow display | MAC filter (optional) |
| `/admin` | Admin panel | MAC filter + password |

**Default admin password: `Admin@12345` — change this immediately after first login.**

## Installation

One installer sets up either kind of Pi. Run it on the Pi, from a terminal:

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
3. **Whether `sudo` should ask for a password.** Raspberry Pi OS lets the desktop user run `sudo` without one. If you answer yes, the installer backs up the rule in `/etc/sudoers.d`, turns it off, and has you type your password once to prove it works before keeping the change. If the password doesn't work, the rule goes straight back, so you can't be locked out.

Running it again is safe: it offers your previous answers, so Enter keeps them.

It always runs its newest version: whichever copy you start, it first downloads the installer from the latest commit on GitHub `main` and runs that. When it's done, it offers to reboot (Enter = yes). To run a local copy exactly as it is, e.g. to test changes to it: `sudo NOTICEBOARD_INSTALLER_SHA=local bash installers/install.sh`.

### Server + display (hosts content, runs the server, acts as primary display)

- Updates the Pi's software first (`apt-get update`, then a full upgrade), which can take a while on a Pi that hasn't been updated recently
- Installs Node.js 20, FFmpeg, and Chromium
- Clones the repo to `/opt/noticeboard` (or updates it) and builds the display and admin SPAs
- Creates a `noticeboard` systemd service (starts on boot, restarts on crash)
- Sets up [automatic updates](#updates)
- Creates an XDG autostart entry to open Chromium in kiosk mode pointing to `http://localhost:3000/` (works with `chromium` or `chromium-browser`; to see what it did at boot: `journalctl -t noticeboard-kiosk -b`)

After the installer's reboot, the display appears automatically.

### Remote display (connects to an existing server)

- Updates the Pi's software first, the same way
- Installs Chromium
- Creates a kiosk start script at `/usr/local/bin/noticeboard-kiosk.sh`
- If the server's MAC filter is enabled and this device is not yet approved, the kiosk shows the device's MAC address on screen until an admin approves it — the page then redirects automatically

After the installer's reboot, the kiosk starts automatically.

## Updates

The server Pi keeps itself up to date with the `main` branch on GitHub:

- Every 15 minutes, `noticeboard-update.timer` checks GitHub. If nothing is new, nothing happens.
- When `main` has a new commit, `installers/update.sh` installs it, rebuilds, and restarts the server. Screens, including remote display Pis, reload themselves a few seconds later to show the new version.
- It waits while an upload is being processed. If the new version fails to build or doesn't answer after the restart, it puts the previous version back and skips that commit until a newer one arrives.
- It runs as the Pi's desktop user, not root, so it never needs `sudo`.

| To… | Run on the server Pi |
|---|---|
| See what it did | `sudo journalctl -u noticeboard-update` |
| Check for an update now | `bash /opt/noticeboard/installers/update.sh` |
| Retry a commit it skipped | `bash /opt/noticeboard/installers/update.sh --force` |
| Try a branch before merging it | `NOTICEBOARD_BRANCH=my-branch bash /opt/noticeboard/installers/update.sh` (stop the timer first, or the next check goes back to `main`) |
| Turn automatic updates off / on | `sudo systemctl disable --now noticeboard-update.timer` / `enable --now` |

Automatic updates cover the app itself. The kiosk start scripts and system settings are written by the installer, so a fix to those (like the switch to newer Raspberry Pi OS's `chromium`) needs the installer run again (it offers to reboot at the end).

**Installed before automatic updates existed?** Run the installer once; it updates everything and sets up automatic updates. Let it reboot so the display loads the new page. After that, updates are automatic:

```bash
curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
```

Do the same on remote display Pis (or just reboot them once).

## Development

Requirements: Node.js 18+, FFmpeg (for video processing)

```bash
npm install
npm run dev        # starts server + both Vite dev servers concurrently
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

## Architecture

```
/                          ← display SPA (Vue 3)
/admin/                    ← admin SPA (Vue 3 + Vue Router)
/api/                      ← REST API (Express)
/media/:folder/slides/:f   ← media files (MAC filtered)
```

- **No database** — config in `data/config.json`, slides in `data/slideshows/<folder>/`
- **Socket.io** — server pushes `playlist:update` to all connected displays when content or schedule changes, and sends `display:build` on connect so screens reload after an update
- **Media processing** — uploads go to `tmp/`, converted by Sharp (images) or FFmpeg (videos), then moved to `data/slideshows/<folder>/slides/`

## Tech Stack

- **Server** — Node.js, Express, Socket.io, Winston
- **Frontend** — Vue 3, Vite
- **Media processing** — FFmpeg, Sharp
- **Storage** — JSON files + media on disk (no database)

## Documentation

A full user guide covering installation, managing slideshows, scheduling, MAC filtering, and troubleshooting is included as `noticeboard-guide.html` in the project root. Open it in any browser — no server required.

## License

MIT — see [LICENSE](LICENSE)

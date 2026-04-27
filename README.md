# Noticeboard

A self-hosted digital notice board and slideshow system designed to run on a Raspberry Pi 4. Displays images and videos on a local-network screen, managed through a browser-based admin panel.

## Features

- **Slideshow display** — full-screen, looped playback of images and videos
- **Multiple slideshows** — create named series, each with its own schedule and priority (max 5 active simultaneously)
- **Scheduling** — set slideshows to run always, or only on specific days and times
- **Media processing** — upload images and videos in any standard format; automatically converted to PNG and H.264 MP4 via Sharp and FFmpeg
- **Admin panel** — browser-based control panel for managing content and settings
- **MAC address filtering** — optionally restrict display access to approved devices
- **Raspberry Pi installers** — automated setup scripts for both server and remote display Pis

## Access

Both served on port `3000`:

| Path | Purpose | Auth |
|---|---|---|
| `/` | Slideshow display | MAC filter (optional) |
| `/admin` | Admin panel | MAC filter + password |

**Default admin password: `Admin@12345` — change this immediately after first login.**

## Installation

### Server Pi (hosts content, runs the server, acts as primary display)

```bash
sudo bash installers/installer-server-local.sh
```

What it does:
- Installs Node.js 20, FFmpeg, and Chromium
- Clones the repo to `/opt/noticeboard`
- Builds the display and admin SPAs
- Creates a `noticeboard` systemd service (starts on boot, restarts on crash)
- Creates an XDG autostart entry to open Chromium in kiosk mode pointing to `http://localhost:3000/`

After installation, reboot the Pi. The display will appear automatically.

### Remote display Pi (connects to an existing server)

```bash
sudo bash installers/installer-remote-client.sh
```

Prompts for the server URL (e.g. `http://192.168.1.10:3000`), then:
- Installs Chromium
- Creates a kiosk start script at `/usr/local/bin/noticeboard-kiosk.sh`
- If the server's MAC filter is enabled and this device is not yet approved, the kiosk shows the device's MAC address on screen until an admin approves it — the page then redirects automatically

After installation, reboot the Pi.

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
- **Socket.io** — server pushes `playlist:update` to all connected displays when content or schedule changes
- **Media processing** — uploads go to `tmp/`, converted by Sharp (images) or FFmpeg (videos), then moved to `data/slideshows/<folder>/slides/`

## Tech Stack

- **Server** — Node.js, Express, Socket.io, Winston
- **Frontend** — Vue 3, Vite
- **Media processing** — FFmpeg, Sharp
- **Storage** — JSON files + media on disk (no database)

## License

MIT — see [LICENSE](LICENSE)

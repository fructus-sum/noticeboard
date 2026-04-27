# Noticeboard

A self-hosted digital notice board and slideshow system designed to run on a Raspberry Pi 4. Displays images, videos, and text slides on a local network screen, managed through a browser-based control panel.

## Features

- **Slideshow display** — full-screen, auto-scaling with letterboxing, looped playback
- **Multiple slideshows** — create named slideshow series, each with its own schedule and priority
- **Scheduling** — set slideshows to run always, or only on specific days and times
- **Media support** — upload images and videos in any standard format; automatically converted to PNG and MP4
- **Audio tracks** — attach a background music track to any slideshow
- **Text overlays** — add positioned text over images or videos
- **Text-only slides** — create slides with custom text, fonts, colours, and backgrounds
- **Admin panel** — full browser-based control panel for managing content and settings
- **MAC address filtering** — restrict display access to approved devices
- **Raspberry Pi installers** — automated setup scripts for both server and remote client Pis

## Access Points

Both served on port `3000`:

| Path | Purpose | Access |
|---|---|---|
| `/` | Slideshow display | MAC address filtered |
| `/admin` | Control panel | MAC filter + password |

Default admin password: `Admin@12345` — change this after first login.

## Tech Stack

- **Server** — Node.js, Express, Socket.io
- **Frontend** — Vue 3, Vite, Pinia
- **Media processing** — FFmpeg, Sharp
- **Storage** — JSON files and media folders (no database)

## Installation

### Server Pi (hosts the content and serves the display)

```bash
bash installers/installer-server-local.sh
```

### Remote display Pi (connects to an existing server)

```bash
bash installers/installer-remote-client.sh
```

## Development

```bash
npm install
npm run dev
```

Requires Node.js 18+ and FFmpeg installed locally.

## License

MIT — see [LICENSE](LICENSE)

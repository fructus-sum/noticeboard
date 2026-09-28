# Noticeboard

**Noticeboard** is a self-hosted digital signage system designed around one central Server and one or more Clients connected to TVs or displays across the same local network. Content is managed through a web-based Admin interface, with support for different slideshows, schedules, display groups, images, video, audio, event audio, visitor logging, and device-specific content. Clients automatically receive and display the content assigned to them, allowing inexpensive, low-power hardware to be used for individual screens, and the whole system is built to run unattended for months.

It would work well anywhere that needs centrally managed information or media across one or more displays, including **schools, colleges, community centres, scout halls, cafés, restaurants, offices, event centres, sports clubs, churches, hotels, reception areas, waiting rooms, shops, conference venues, and exhibition spaces**. For example, an event centre could run different schedules on reception, conference-room and public-area screens; a school could separate student, staff and reception displays; while a café could use it for menus, promotions, events and general information.

> **Note:** Support for multiple Display Groups is currently under construction. At present, the system supports one Display Group only.

**Server** means the device running the Noticeboard server; **Client** means a device showing the Noticeboard viewer on its screen. A Raspberry Pi can be either, depending on how it is installed, and a Server also shows the slideshow on its own screen.

### Supported devices

| Device | Server | Client | Video | Status |
|---|---|---|---|---|
| Raspberry Pi 3 | yes | yes | H.264 only, 1080p only | Supported (choose H.264 in Settings) |
| Raspberry Pi 4 | yes | yes | H.264 and H.265 | Supported |
| Raspberry Pi 5 | yes | yes | H.264 and H.265 | Supported |
| Orange Pi Zero 2W | no | yes, headless | H.264 and H.265 | Planned: needs a headless Client installer |

New videos are converted to H.265 (HEVC) by default; H.264 is the fallback for older hardware such as the Raspberry Pi 3 (Settings → Display).

**Full details are in the user guide**, [`noticeboard-guide.html`](noticeboard-guide.html): open it in any browser, click **Help** in the admin panel, use the **Noticeboard Help** shortcut the installer puts on the desktop of each Server and Client, or go to `http://<server-ip>:3000/admin/help`. Reading it needs no login.

## Features

- **Slideshows on any screen** — images and videos, full screen, on the Server's own screen and on any number of Clients or browsers
- **Every screen in step** — all screens show the same slide and play the same music at the same moment, kept to the Server's clock, so screens side by side match and screens heard together don't echo (within about a tenth of a second; each TV may add its own sound delay)
- **Runs unattended** — keeps cycling for months: survives outages, sleeping screens, slides that won't load and browser crashes, and reloads itself after updates
- **Kiosk with an exit** — screens run full screen; moving the mouse shows an exit button that takes just that screen back to a normal browser window. Kiosk mode never applies to the admin pages, and the cursor hides when the mouse is still
- **Several slideshows** — with schedules, priorities, and a default image duration (10 seconds) that each slideshow can override; switching slideshows never cuts a slide short
- **Hide and unhide** unpublished slideshows to tidy the list without deleting them
- **A sample slideshow** that updates bring new examples to; it can be hidden but not deleted
- **Background audio** — audio shows (music or sound, in order or shuffled, with crossfades and their own volume) play behind the slideshows that choose them, on every screen; a video can play its own sound (the background lowered or paused meanwhile), and an audio show can take over every screen as **event audio** (now, once, or every week)
- **Uploads processed for you** — images to PNG, videos to H.265 MP4 (large videos take a while; carry on meanwhile), with automatic video thumbnails and a larger preview of any slide
- **Your logo** above "No slideshow published" and in the admin sidebar, or none
- **The server's address on every screen** — a faint location pin shows the Noticeboard server's IP address and port; it can be turned off
- **Admin panel** at `/admin`, usable on a phone, with a sidebar that collapses to icons, a link to open the viewer, a warning until the default password is changed, and the installed version's date
- **MAC filtering** to restrict which devices can show the slideshow
- **Automatic updates** from GitHub, with branch switching in the admin panel and automatic rollback
- **One installer** for Servers and Clients, with an optional firewall set-up

## Access

Everything is on one port, `3000`:

| Path | Purpose | Auth |
|---|---|---|
| `/` | Slideshow viewer | MAC filter (optional) |
| `/admin` | Admin panel | MAC filter + password |
| `/admin/help` | User guide | MAC filter (optional) |

There's no separate admin port. **Default admin password: `Admin@12345`** — change it after the first login; the admin panel warns you until you do.

## MAC Address Filtering

MAC address filtering requires the Server and the Clients to be on the same local network.

The Server identifies Clients by resolving their IP address to a MAC address using the local network.

For example:

`Server → 192.168.1.10`

`Client 1 → 192.168.1.20`

`Client 2 → 192.168.1.21`

If these devices are on the same local network, the Server can identify the Clients by their MAC addresses and apply the filtering.

**Limitations while MAC filtering is on** (it's off by default, and none of this applies then):

- **A device on another network is blocked.** A device behind another router, on a different VLAN or subnet, or connected over a VPN reaches the Server through a router, so the Server can't see its MAC address and treats it as not approved: it gets "Not Found" for the slideshow and the admin panel. Adding the MAC address the device shows doesn't help, because the server never sees it.
- **Behind a router that shares one address (NAT), every device looks the same.** The Server sees only that router's MAC address, so approving it approves every device behind that router.
- **Some Wi-Fi range extenders (repeaters) do the same:** they replace each device's MAC address with their own. Mesh Wi-Fi systems normally don't.
- **This includes the devices you manage it from.** Filtering also guards the admin panel, so a computer or phone on another network is locked out too. The Server itself is always allowed.

**Recommendation:** when using MAC filtering, put the Server, every Client and the devices you manage it from on the same local network: the same subnet, or the same VLAN if your network uses VLANs. Devices on different VLANs are routed between them, so they have the same limitations as separate networks.

## Installation

One installer sets up a Server or a Client. It runs on a Raspberry Pi with Raspberry Pi OS with the desktop (the current release, Trixie, or Bookworm; see [Supported devices](#supported-devices)). Run it on the device, from a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/fructus-sum/noticeboard/main/installers/install.sh | sudo bash
```

or, from a copy of this repository:

```bash
sudo bash installers/install.sh
```

It asks:

1. **What this device is:** a *Server* or a *Client* (see below).
2. **The Server's address** (Clients only), e.g. `http://192.168.1.10:3000`. The pin in the top-left corner of the Server's screen shows it.
3. **Whether to keep the branch** (only on a Server that follows a branch other than `main`): keep it, or go back to `main`.
4. **Whether `sudo` should ask for a password.** Raspberry Pi OS lets the desktop user run `sudo` without one. If you answer yes, the installer backs up the rule in `/etc/sudoers.d`, turns it off, and has you type your password once to prove it works before keeping the change. If the password doesn't work, the rule goes straight back, so you can't be locked out.
5. **Firewall (optional):** at the end it offers to check or set up a firewall, and changes nothing unless you say yes. See the user guide for details.

Running it again is safe: it offers your previous answers, so Enter keeps them, and it never touches your slideshows, slides or settings. It always runs its newest version: whichever copy you start, it first downloads the installer from the latest commit of the branch the Server follows on GitHub (`main`, unless it has been switched to another branch) and runs that; on `main`, once you've answered, it hands over to the installer of `main`'s latest Release, and installs that Release. When it's done, it offers to reboot (Enter = yes). To run a local copy exactly as it is, e.g. to test changes to it: `sudo NOTICEBOARD_INSTALLER_SHA=local bash installers/install.sh`.

### Server (stores the content, runs the admin panel, and shows the slideshow on its own screen)

- Updates the device's software first (`apt-get update`, then a full upgrade), which can take a while if it hasn't been updated recently
- Installs Node.js 20, FFmpeg, and Chromium
- Clones the repo to `/opt/noticeboard` (or updates it, on the branch it follows: on `main`, its latest Release) and builds the web apps
- Creates a `noticeboard` systemd service (starts on boot, restarts on crash) and sets up automatic updates
- Starts the viewer full screen (kiosk mode) at login once the server answers, in a browser profile of its own, and opens it again if it closes or crashes
- Puts a **Noticeboard Help** shortcut on the desktop

After the installer's reboot, the slideshow appears automatically.

### Client (shows the slideshow from a Server)

- Updates the device's software first, the same way, and installs Chromium
- Starts the viewer full screen at login. Until the Server answers, it shows a waiting page with this Client's MAC address and the reason it's waiting (Server unreachable, or not yet approved by MAC filtering), and switches to the slideshow by itself as soon as it can
- Puts a **Noticeboard Help** shortcut on the desktop

After the installer's reboot, the kiosk starts automatically.

**Using Clients? Give the Server a fixed IP address** (a reservation in your router, or a static address on the Server itself), since the Clients find it by its address. The user guide explains both.

**Installed before?** Run the installer again once on each Server and Client (over SSH is fine) to get the latest kiosk set-up. After that, the Server keeps itself up to date.

## Updates

The Server checks GitHub every 15 minutes and installs new versions by itself: on `main`, each published [Release](https://github.com/fructus-sum/noticeboard/releases) (never work in progress, and never an older version by itself); on another branch, each new commit. It installs them on the schedule you choose in **Settings → Software updates** (straight away, every 2 hours, daily, weekly, or only when you say); every screen then reloads onto the new version. A version that fails to build or start is rolled back automatically. **Settings → Software updates** shows what's running and how updates went, and can switch the Server to another branch (with checks, the admin password and a final confirmation); a Server whose branch's work is in a Release of `main` goes back to `main` by itself. Your slideshows, slides and settings are never changed by an update. Before a switch, the Server checks its software against the branch's list of what it needs (`system-requirements.json`) and warns about anything missing, with an extra confirmation to switch anyway. When a version needs something only the installer sets up (such as the kiosk), the admin panel's Slideshows page says to run the installer again and shows the command. The user guide has the details and the commands.

## Status

- **Current:** everything listed above is implemented and described in the user guide.
- **Tested:** the slide timing (`npm test`, including a simulated 30 days), the viewer in a real browser under outages, freezes, crashes and updates, the admin panel end to end, and the installer, kiosk scripts and updater against stand-ins for systemd, apt and the browser. The installer is in use on Raspberry Pi OS Trixie (labwc desktop).
- **Limitations:** only the Server updates itself (Clients load new versions from it); kiosk scripts and system settings only change when the installer runs; a screen can't wake a monitor that is switched off (screen blanking is set in the operating system).

## Development

Requirements: Node.js 20.19+ (or 22.12+), FFmpeg (for video processing and thumbnails). `system-requirements.json` lists all the software a branch needs on the Server; keep it up to date on every branch, in the same commit as the change that needs the software. The admin panel checks it before switching branch. Its `installer.version` must match `INSTALLER_VERSION` in `installers/install.sh`: raise both (and add a line to `installer.changes`) whenever the installer changes what updates can't, such as the kiosk scripts (`installers/kiosk/`) or system services.

**How the code fits together** is in [`docs/design/SYSTEM_DESIGN.md`](docs/design/SYSTEM_DESIGN.md): the parts and what each owns, the files they share, and what installed Servers and Clients and open screens rely on, which must not change. Update it in the same commit as the code it describes.

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
- **`test:installers`:** the installer (with its parts in `installers/lib/`) and `update.sh` with stand-ins for systemd, apt and GitHub, including the files the installer writes (compared with `tests/fixtures/installer-golden/`).
- **`test:upgrade`:** an installed baseline takes the current code through its own `update.sh`, and nothing may change.

Video tests need ffmpeg: on the `PATH`, or set `FFMPEG_PATH` and `FFPROBE_PATH`. The installer tests need bash (Git Bash on Windows).

Every push runs the whole suite on GitHub Actions (Linux, Node.js 20: `.github/workflows/tests.yml`). To run it locally without holding up work, `node tests/snapshot.js` tests the last commit in a separate worktree, so this folder can change meanwhile (`node tests/snapshot.js <commit> <group> [filter]` for part of it).

There is one version of the software: run on a PC, it works exactly as on a Server. After changing the viewer or the admin panel, run `npm run build` again; after changing the server, restart it. Changes are tried out on a GitHub branch, which a Server can follow (Settings → Software updates).

Runtime settings live in `data/config.json` (created on first run); slideshows and their slides in `data/slideshows/`. On an installed Server, systemd loads `/opt/noticeboard/.env`: `SECURE_COOKIES=true` only when serving over HTTPS, and `NOTICEBOARD_LOG_LEVEL=debug` for more detail in the log when troubleshooting.

## License

MIT — see [LICENSE](LICENSE)

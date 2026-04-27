#!/usr/bin/env bash
# installer-server-local.sh
# Full Noticeboard setup on a Raspberry Pi that acts as both server and display.
# Run with: sudo bash installer-server-local.sh
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
REPO_URL="https://github.com/PLACEHOLDER/noticeboard.git"
INSTALL_DIR="/opt/noticeboard"
SERVICE_NAME="noticeboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
AUTOSTART_FILE="/etc/xdg/autostart/noticeboard-kiosk.desktop"

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: Run this script with sudo."
  exit 1
fi

# Identify the desktop user (the one who invoked sudo)
DESKTOP_USER="${SUDO_USER:-pi}"
DESKTOP_HOME=$(getent passwd "$DESKTOP_USER" | cut -d: -f6)

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    Noticeboard — server + display installer  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Install directory : $INSTALL_DIR"
echo "Service user      : $DESKTOP_USER"
echo ""

# ── System packages ───────────────────────────────────────────────────────────
echo "▸ Installing system packages..."
apt-get update -qq
apt-get install -y -qq git ffmpeg chromium-browser curl

# ── Node.js 20 LTS via NodeSource ─────────────────────────────────────────────
NODE_MAJOR=0
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
fi

if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "▸ Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

echo "  Node.js $(node -v)  npm $(npm -v)"

# ── Clone or update the repo ──────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "▸ Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "▸ Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── Install dependencies + build SPAs ─────────────────────────────────────────
echo "▸ Installing Node dependencies..."
cd "$INSTALL_DIR"
npm install --silent

echo "▸ Building display and admin SPAs..."
npm run build --silent

echo "▸ Removing dev dependencies..."
npm prune --omit=dev --silent

# ── First-run: generate data/config.json ──────────────────────────────────────
mkdir -p "$INSTALL_DIR/data"
if [ ! -f "$INSTALL_DIR/data/config.json" ]; then
  echo "▸ Generating initial config.json..."
  cd "$INSTALL_DIR"
  node -e "
    require('./server/services/configService').init()
      .then(() => { console.log('  config.json created'); process.exit(0); })
      .catch(e => { console.error(e.message); process.exit(1); })
  "
fi

# ── Production .env ───────────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<ENV
NODE_ENV=production
SECURE_COOKIES=false
ENV
fi

# ── Systemd service ────────────────────────────────────────────────────────────
echo "▸ Installing systemd service..."
cat > "$SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard server
After=network.target

[Service]
Type=simple
User=$DESKTOP_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" --quiet
systemctl restart "$SERVICE_NAME"
echo "  Service started."

# ── Kiosk start script ────────────────────────────────────────────────────────
echo "▸ Installing kiosk autostart..."

cat > "$INSTALL_DIR/start-kiosk.sh" <<'KIOSK'
#!/usr/bin/env bash
# Wait for the noticeboard server to accept connections
until curl -sf http://localhost:3000/ >/dev/null 2>&1; do
  sleep 2
done

# Disable display blanking and power management
xset s off    2>/dev/null || true
xset -dpms    2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide the mouse cursor after 1 second of inactivity (requires unclutter)
command -v unclutter >/dev/null 2>&1 && unclutter -idle 1 -root &

exec chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --check-for-update-interval=31536000 \
  --kiosk \
  http://localhost:3000/
KIOSK
chmod +x "$INSTALL_DIR/start-kiosk.sh"

# XDG autostart entry (works with LXDE, GNOME, and most Pi OS desktop environments)
cat > "$AUTOSTART_FILE" <<DESK
[Desktop Entry]
Name=Noticeboard Kiosk
Exec=$INSTALL_DIR/start-kiosk.sh
Type=Application
X-GNOME-Autostart-enabled=true
DESK

# Fix ownership
chown -R "$DESKTOP_USER:$DESKTOP_USER" "$INSTALL_DIR"

# ── Optional: hide mouse cursor ──────────────────────────────────────────────��
apt-get install -y -qq unclutter 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║            Installation complete             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Admin panel  :  http://${LOCAL_IP}:3000/admin"
echo "  Display      :  http://${LOCAL_IP}:3000/"
echo ""
echo "  Default password: Admin@12345"
echo "  ⚠  Change this immediately after first login."
echo ""
echo "  Service logs : sudo journalctl -u noticeboard -f"
echo ""
echo "Reboot this Pi to start the kiosk display automatically."
echo ""

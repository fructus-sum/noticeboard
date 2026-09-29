# shellcheck shell=bash
# installers/lib/server.sh — setting up a Server (a Client + Server's screen is the Client's: client.sh)
#
# Responsibilities
#   System packages and Node.js; the install folder (a clone, or the chosen branch fetched; then
#   checked out, on main at its latest Release), dependencies and the build, the first
#   config.json, .env, the branch setting and update status; the services: the server's, the
#   updater's timer and path units, and the system step (its units, and root's own files: the
#   system step and the noticeboard command, SYSTEM_DESIGN §18.7 phase 2). The installer record
#   (written last, by install.sh), and the summary.
#
# Provides
#   install_server                      all three parts below, as an interactive run does
#   install_server_packages             the system update, git, ffmpeg, curl, Node.js
#   install_server_code                 the install folder at the version to install, built, with its
#                                       config.json, .env and branch setting
#   install_server_services [--no-restart]   the units and root's files (--apply: no restart)
#   write_service, write_update_units, write_system_units   the systemd units (compared with
#                                       tests/fixtures/installer-golden)
#   write_root_files                    /usr/local/sbin/noticeboard-system, /usr/local/bin/noticeboard
#                                       and (write_root_libs, also used by client.sh)
#                                       /usr/local/lib/noticeboard/{branch,json,release}.sh
#   save_branch_setting                 data/update-branch.env (only if the branch changed) and
#                                       data/update-status.json
#   write_installer_record              data/installer.json, written last by install.sh (after the
#                                       Client too): a run that stopped part way doesn't count
#   fetch_branch <owner> <branch>
#   main_ref <owner>                    main's latest Release fetched (MAIN_REF, MAIN_RELEASE), else
#                                       main's latest commit
#   summary_server
#
# Used by
#   install.sh run_installer and apply_saved_installation (--apply)
#
# Uses
#   system.sh, branch.sh, json.sh, release.sh (latest_release), ui.sh (banner); the root files
#   read in by install.sh (ROOT_FILE_<name>, ROOT_LIB_<name>); the configuration in install.sh
#   (INSTALL_DIR, INSTALL_BRANCH, the unit file paths, SYSTEM_STEP, SERVER_COMMAND, ROOT_LIB_DIR, ...)
#
# Change impact
#   The units, .env, installer.json and update-status.json are read by systemd, update.sh and
#   the server on every Server: their names and formats must not change (SYSTEM_DESIGN §6).
#   Changing what's written here that updates can't change means raising INSTALLER_VERSION.

install_server() {
  install_server_packages
  install_server_code
  install_server_services
}

# The system packages and Node.js (also what the system step, install.sh --apply, runs)
install_server_packages() {
  echo "Install directory : $INSTALL_DIR"
  echo "Service user      : $DESKTOP_USER"
  echo ""

  # ── System packages ─────────────────────────────────────────────────────────
  update_system
  echo "▸ Installing system packages..."
  apt-get install -y -qq git ffmpeg curl

  # ── Node.js 20 LTS via NodeSource, when the installed one is missing or too old ──────
  if ! node_new_enough; then
    echo "▸ Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs
  fi
  if ! node_new_enough; then
    echo "ERROR: Node.js $(node -v 2>/dev/null || echo "isn't installed") is too old for Noticeboard,"
    echo "which needs 20.19 or newer (see system-requirements.json). Update Node.js, then run the installer again."
    exit 1
  fi

  echo "  Node.js $(node -v)  npm $(npm -v)"
}

# The install folder at the version to install, built, with its first config.json, .env and the
# branch setting (an interactive run only: with --apply, update.sh installs the code afterwards)
install_server_code() {
  # ── Clone or update the repo ────────────────────────────────────────────────
  local owner ref
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "▸ Updating existing installation ($INSTALL_BRANCH)..."
    lock_install_dir
    # This installs the branch the admin panel asked for, so its pending request is done
    rm -f "$INSTALL_DIR/tmp/update-request"
    # Run git as the folder's owner (git refuses repos owned by someone else), and
    # force the checkout (below) so npm's edits to package-lock.json can't block the update
    owner=$(stat -c %U "$INSTALL_DIR")
    if ! fetch_branch "$owner" "$INSTALL_BRANCH"; then
      if [ "$INSTALL_BRANCH" = main ]; then
        echo "ERROR: Couldn't download main from GitHub. Check the internet connection and run the installer again."
        exit 1
      fi
      echo "  Couldn't download $INSTALL_BRANCH from GitHub, so this installs main instead."
      INSTALL_BRANCH=main
      if ! fetch_branch "$owner" main; then
        echo "ERROR: Couldn't download main from GitHub. Check the internet connection and run the installer again."
        exit 1
      fi
    fi
  else
    echo "▸ Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    lock_install_dir
  fi
  ref="origin/$INSTALL_BRANCH"
  owner=$(stat -c %U "$INSTALL_DIR")
  if [ "$INSTALL_BRANCH" = main ]; then
    main_ref "$owner"
    ref=$MAIN_REF
  fi
  runuser -u "$owner" -- git -C "$INSTALL_DIR" checkout --quiet --force -B "$INSTALL_BRANCH" "$ref"

  # ── Install dependencies + build SPAs ───────────────────────────────────────
  echo "▸ Installing Node dependencies..."
  cd "$INSTALL_DIR" || exit 1
  npm install --silent

  echo "▸ Building display and admin SPAs..."
  npm run build --silent

  echo "▸ Removing dev dependencies..."
  npm prune --omit=dev --silent

  # ── First-run: generate data/config.json ────────────────────────────────────
  mkdir -p "$INSTALL_DIR/data"
  if [ ! -f "$INSTALL_DIR/data/config.json" ]; then
    echo "▸ Generating initial config.json..."
    cd "$INSTALL_DIR" || exit 1
    node -e "
      require('./server/services/configService').init()
        .then(() => { console.log('  config.json created'); process.exit(0); })
        .catch(e => { console.error(e.message); process.exit(1); })
    "
  fi

  # ── .env (the service's environment; noticeboard.service needs the file) ───────
  # An older install's file keeps its NODE_ENV=production line, which nothing reads any more
  if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" <<ENV
SECURE_COOKIES=false
ENV
  fi

  save_branch_setting
}

# The services: the server's, the updater's, and the system step with root's files. The server is
# started (again) unless --no-restart (--apply: update.sh restarts it once the code is installed).
install_server_services() {   # install_server_services [--no-restart]
  # ── Systemd service ─────────────────────────────────────────────────────────
  echo "▸ Installing systemd service..."
  write_service

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" --quiet
  if [ "${1:-}" != --no-restart ]; then
    systemctl restart "$SERVICE_NAME"
    echo "  Service started."
  fi

  # Fix ownership
  chown -R "$DESKTOP_USER:$DESKTOP_USER" "$INSTALL_DIR"

  # ── Auto-update ─────────────────────────────────────────────────────────────
  echo "▸ Installing auto-update timer..."
  write_update_units
  write_system_units
  write_root_files
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}-update.timer" --quiet
  systemctl enable --now "${SERVICE_NAME}-update.path" --quiet
  systemctl enable --now "${SERVICE_NAME}-system.path" --quiet
  echo "  Checks GitHub for updates every 15 minutes, and straight away after a branch switch."
  echo "  On main, a Release that needs the installer runs it by itself (noticeboard-system)."
}

# The system step (SYSTEM_DESIGN §18.7 phase 2): root runs /usr/local/sbin/noticeboard-system when
# update.sh (or a Full update) writes tmp/system-request
write_system_units() {
  cat > "$SYSTEM_SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard system step (the installer of main's latest Release, when it needs it)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$SYSTEM_STEP
TimeoutStartSec=45min
SVC

  cat > "$SYSTEM_PATH_FILE" <<PATHUNIT
[Unit]
Description=Run the Noticeboard system step when an update asks for it

[Path]
PathExists=$INSTALL_DIR/tmp/system-request
Unit=${SERVICE_NAME}-system.service

[Install]
WantedBy=paths.target
PATHUNIT
}

# Root's own files: the system step and the noticeboard command, with the installer's parts they
# load, root-owned and outside the app's folder (root never runs code from there)
write_root_files() {
  write_root_libs
  printf '%s' "$ROOT_FILE_noticeboard_system" > "$SYSTEM_STEP"
  printf '%s' "$ROOT_FILE_noticeboard" > "$SERVER_COMMAND"
  chmod 755 "$SYSTEM_STEP" "$SERVER_COMMAND"
}

# The installer's parts root's files load (ROOT_LIBS), root's, in ROOT_LIB_DIR (also on a Client
# only: noticeboard-client reinstall-stable loads release.sh)
write_root_libs() {
  local name var
  mkdir -p "$ROOT_LIB_DIR"
  chmod 755 "$ROOT_LIB_DIR"
  for name in "${ROOT_LIBS[@]}"; do
    var="ROOT_LIB_$name"
    printf '%s' "${!var}" > "$ROOT_LIB_DIR/$name.sh"
    chmod 644 "$ROOT_LIB_DIR/$name.sh"
  done
}

# What this installer run set up, so the admin panel can tell when a newer version needs the
# installer run again (see "installer" in system-requirements.json). Written last: a run that
# stopped part way doesn't count.
write_installer_record() {
  local commit
  commit=$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)
  printf '{"version":%s,"branch":"%s","commit":"%s","time":"%s"}\n' \
    "$INSTALLER_VERSION" "$INSTALL_BRANCH" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$INSTALL_DIR/data/installer.json"
  chown "$DESKTOP_USER:$DESKTOP_USER" "$INSTALL_DIR/data/installer.json" 2>/dev/null || true
}

# Download a branch from GitHub, as the install folder's owner
fetch_branch() {   # fetch_branch <owner> <branch>
  runuser -u "$1" -- git -C "$INSTALL_DIR" fetch --quiet --no-tags origin "+refs/heads/$2:refs/remotes/origin/$2"
}

# What installing main means: its latest published Release (SYSTEM_DESIGN §18.6), fetched as the
# folder's owner, in MAIN_REF (and its tag in MAIN_RELEASE). Main's latest commit when none is
# published yet or GitHub can't be asked; update.sh then installs the next Release once there is one.
MAIN_REF="origin/main"
MAIN_RELEASE=""
main_ref() {   # main_ref <owner>
  local tag code=0
  MAIN_REF="origin/main"
  MAIN_RELEASE=""
  tag=$(latest_release) || code=$?
  if [ "$code" -eq 0 ] \
     && runuser -u "$1" -- git -C "$INSTALL_DIR" fetch --quiet --no-tags origin "$(release_tag_ref "$tag")"; then
    MAIN_REF="refs/tags/$tag"
    MAIN_RELEASE=$tag
    echo "  main's latest Release: $tag"
  elif [ "$code" -eq 3 ]; then
    echo "  No Release has been published yet, so this installs main's latest commit."
  else
    echo "  Couldn't ask GitHub for main's latest Release, so this installs main's latest commit."
  fi
}

# Record the branch this installed, for update.sh and the admin panel's Software updates card
save_branch_setting() {
  # Only when the branch changed: the file also remembers where main was at the switch (update.sh)
  local current
  current=$(read_branch_setting)
  if [ "$INSTALL_BRANCH" != "${current:-main}" ]; then
    write_branch_setting "$INSTALL_BRANCH"
  fi
  local commit installed
  commit=$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" rev-parse HEAD)
  installed="${commit:0:7} from $INSTALL_BRANCH"
  if [ "$INSTALL_BRANCH" = main ] && [ -n "$MAIN_RELEASE" ]; then installed="Release $MAIN_RELEASE (${commit:0:7})"; fi
  write_json "$INSTALL_DIR/data/update-status.json" state updated branch "$INSTALL_BRANCH" commit "$commit" \
    message "Installed $installed with the installer." time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

write_service() {
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
}

# Runs installers/update.sh every 15 minutes as the app's user (no root needed), and
# straight away when the admin panel asks for a branch switch (it writes tmp/update-request)
write_update_units() {
  cat > "$UPDATE_SERVICE_FILE" <<SVC
[Unit]
Description=Noticeboard auto-update
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$DESKTOP_USER
ExecStart=/bin/bash $INSTALL_DIR/installers/update.sh
TimeoutStartSec=60min
SVC

  cat > "$UPDATE_PATH_FILE" <<PATHUNIT
[Unit]
Description=Start a Noticeboard update when the admin panel asks for one

[Path]
PathExists=$INSTALL_DIR/tmp/update-request
Unit=${SERVICE_NAME}-update.service

[Install]
WantedBy=paths.target
PATHUNIT

  cat > "$UPDATE_TIMER_FILE" <<TIMER
[Unit]
Description=Check GitHub for Noticeboard updates every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
TIMER
}

summary_server() {
  local local_ip port
  local_ip=$(hostname -I | awk '{print $1}')
  port=$(slideshow_port)
  echo ""
  banner "Installation complete"
  echo ""
  echo "  Admin panel  :  http://${local_ip}:${port}/admin"
  echo "  Display      :  http://${local_ip}:${port}/"
  echo ""
  echo "  Default password: Admin@12345"
  echo "  ⚠  Change this immediately after first login."
  if [ -n "$SUDO_STATUS" ]; then
    echo "  $SUDO_STATUS"
  fi
  echo ""
  echo "  Service logs : sudo journalctl -u noticeboard -f"
  echo "  Auto-update  : every 15 minutes (logs: journalctl -u noticeboard-update)"
  echo "  Branch       : $INSTALL_BRANCH${MAIN_RELEASE:+, Release $MAIN_RELEASE} (change it in the admin panel: Settings → Software updates)"
}

// server/services/configService.js — data/config.json, kept in memory
//
// Responsibilities
//   Loading config.json (JSON5, so an admin may add comments), creating it with defaults on the
//   first start, and saving every change as a whole. An existing config.json that can't be read is
//   never overwritten (SYSTEM_DESIGN §18.5 item 8): it's moved aside as config.json.broken-<time>
//   (kept), and the last good copy (data/config.last-good.json, written after every load and save)
//   is restored; without one, the Server starts from the defaults (a new config.json is written as
//   soon as anything is saved, e.g. the sample slideshow; the unreadable one stays kept). Either way
//   data/config-recovery.json says what happened, for the admin panel's warning, until it's dismissed.
//
// Provides (a singleton EventEmitter)
//   init()               creates data/ and data/slideshows/, then loads or creates config.json
//                        (recovering an unreadable one, as above)
//   recovery()           → the note about an unreadable config.json ({ time, brokenFile, restored:
//                        'last-good' | 'defaults' }), or null
//   dismissRecovery()    removes that note (the admin has dealt with it)
//   get(key?)            the whole config, or one top-level key
//   set(key, value)      saves one key; emits 'change' (key, value)
//   update(partial)      saves several top-level keys in one write; emits 'change'
//   'change' event       config.json changed: the scheduler recomputes, the displays get new
//                        display settings if they differ
//
// Used by
//   nearly every server module, and the installer (installers/lib/server.sh), which runs
//   `node -e "require('./server/services/configService').init()"` on a first install. That path
//   and init() must not change (SYSTEM_DESIGN §15).
//
// Uses
//   utils/configIO, utils/pathHelpers, config/defaults, config/passwordDefaults, bcrypt, logger
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const EventEmitter = require('events');
const { readConfig, writeConfig } = require('../utils/configIO');
const { configPath, lastGoodConfigPath, configRecoveryPath, dataDir, slideshowsDir } = require('../utils/pathHelpers');
const defaults = require('../config/defaults');
const logger = require('../utils/logger');
const { DEFAULT_PASSWORD, HASH_ROUNDS } = require('../config/passwordDefaults');

class ConfigService extends EventEmitter {
  constructor() {
    super();
    this._config = null;
  }

  async init() {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.mkdirSync(slideshowsDir(), { recursive: true });

    const cfgPath = configPath();

    if (!fs.existsSync(cfgPath)) {
      this._config = await this._generateDefaults();
      await writeConfig(cfgPath, this._config);
      await this._keepLastGood();
      logger.info(`[config] Created default config.json with password ${DEFAULT_PASSWORD}`);
    } else {
      try {
        this._config = await readConfig(cfgPath);
        await this._keepLastGood();
      } catch (err) {
        await this._recover(cfgPath, err);
      }
    }
  }

  // config.json exists but can't be read: keep it (moved aside), then restore the last good copy,
  // else start from the defaults
  async _recover(cfgPath, err) {
    const time = new Date().toISOString();
    const brokenFile = `config.json.broken-${time.replace(/[:.]/g, '-')}`;
    fs.renameSync(cfgPath, `${dataDir()}/${brokenFile}`);
    let restored = 'defaults';
    try {
      this._config = await readConfig(lastGoodConfigPath());
      await writeConfig(cfgPath, this._config);
      restored = 'last-good';
    } catch {
      this._config = await this._generateDefaults();
    }
    fs.writeFileSync(configRecoveryPath(), `${JSON.stringify({ time, brokenFile, restored, error: err.message }, null, 2)}\n`);
    logger.error('[config] config.json could not be read: it was kept and the settings recovered', { err: err.message, brokenFile, restored });
  }

  // The last config that loaded or was saved: what an unreadable config.json is restored from
  async _keepLastGood() {
    try {
      await writeConfig(lastGoodConfigPath(), this._config);
    } catch (err) {
      logger.warn('[config] Could not keep a copy of config.json', { err: err.message });
    }
  }

  recovery() {
    try {
      return JSON.parse(fs.readFileSync(configRecoveryPath(), 'utf8'));
    } catch {
      return null;
    }
  }

  dismissRecovery() {
    fs.rmSync(configRecoveryPath(), { force: true });
  }

  async _generateDefaults() {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, HASH_ROUNDS);
    const jwtSecret = crypto.randomBytes(48).toString('hex');

    return {
      ...defaults,
      passwordHash,
      jwtSecret,
      macFiltering: {
        ...defaults.macFiltering,
        approved: [
          { mac: 'localhost', label: 'Server itself', addedAt: new Date().toISOString() },
        ],
      },
    };
  }

  get(key) {
    if (!this._config) throw new Error('ConfigService not initialised — call init() first');
    return key === undefined ? this._config : this._config[key];
  }

  async set(key, value) {
    if (!this._config) throw new Error('ConfigService not initialised');
    this._config[key] = value;
    await writeConfig(configPath(), this._config);
    await this._keepLastGood();
    this.emit('change', key, value);
  }

  async update(partial) {
    if (!this._config) throw new Error('ConfigService not initialised');
    Object.assign(this._config, partial);
    await writeConfig(configPath(), this._config);
    await this._keepLastGood();
    this.emit('change');
  }
}

module.exports = new ConfigService();

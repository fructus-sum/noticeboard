// server/services/configService.js — data/config.json, kept in memory
//
// Responsibilities
//   Loading config.json (JSON5, so an admin may add comments), creating it with defaults on the
//   first start, and saving every change as a whole. If it can't be parsed, the defaults are
//   written in its place (as always: see CURRENT_SYSTEM_DESIGN §16 #16).
//
// Provides (a singleton EventEmitter)
//   init()               creates data/ and data/slideshows/, then loads or creates config.json
//   get(key?)            the whole config, or one top-level key
//   set(key, value)      saves one key; emits 'change' (key, value)
//   update(partial)      saves several top-level keys in one write; emits 'change'
//   'change' event       config.json changed: the scheduler recomputes, the displays get new
//                        display settings if they differ
//
// Used by
//   nearly every server module, and the installer (installers/lib/server.sh), which runs
//   `node -e "require('./server/services/configService').init()"` on a first install. That path
//   and init() must not change (OLD_SYSTEM_DESIGN §15).
//
// Uses
//   utils/configIO, utils/pathHelpers, config/defaults, config/passwordDefaults, bcrypt, logger
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const EventEmitter = require('events');
const { readConfig, writeConfig } = require('../utils/configIO');
const { configPath, dataDir, slideshowsDir } = require('../utils/pathHelpers');
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
      logger.info(`[config] Created default config.json with password ${DEFAULT_PASSWORD}`);
    } else {
      try {
        this._config = await readConfig(cfgPath);
      } catch (err) {
        logger.error('[config] Failed to parse config.json, regenerating defaults', { err: err.message });
        this._config = await this._generateDefaults();
        await writeConfig(cfgPath, this._config);
      }
    }
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
    this.emit('change', key, value);
  }

  async update(partial) {
    if (!this._config) throw new Error('ConfigService not initialised');
    Object.assign(this._config, partial);
    await writeConfig(configPath(), this._config);
    this.emit('change');
  }
}

module.exports = new ConfigService();

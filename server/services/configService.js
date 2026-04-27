const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const EventEmitter = require('events');
const { readConfig, writeConfig } = require('../utils/configIO');
const { configPath, dataDir, slideshowsDir } = require('../utils/pathHelpers');
const defaults = require('../config/defaults');

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
      // logger not used here to avoid circular dep at init time
      console.info('[config] Created default config.json with password Admin@12345');
    } else {
      try {
        this._config = await readConfig(cfgPath);
      } catch (err) {
        console.error('[config] Failed to parse config.json, regenerating defaults:', err.message);
        this._config = await this._generateDefaults();
        await writeConfig(cfgPath, this._config);
      }
    }
  }

  async _generateDefaults() {
    const passwordHash = await bcrypt.hash('Admin@12345', 10);
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

  async save() {
    if (!this._config) throw new Error('ConfigService not initialised');
    await writeConfig(configPath(), this._config);
  }
}

module.exports = new ConfigService();

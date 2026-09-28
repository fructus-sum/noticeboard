// server/services/audioEventClock.js — which event audio is playing now (SYSTEM_DESIGN §18.3)
//
// Responsibilities
//   Like the scheduler for slideshows: works out the active event (services/audioEvents) when the
//   config changes and when the next event starts or ends (a timer, never more than a minute away,
//   so a changed clock is caught up with), and announces a change.
//
// Provides (a singleton EventEmitter)
//   init()        starts it (after the display socket exists)
//   getActive()   the folder of the audio show whose event is playing, or null
//   'update'      emitted when that changes
//   stop()
//
// Used by
//   server/index.js; realtime/displaySocket (sends the audio again on 'update')
//
// Uses
//   services/audioEvents (activeEvent, nextChange), services/audioShowStore (list),
//   services/configService ('change'), utils/logger
const EventEmitter = require('events');
const configService = require('./configService');
const store = require('./audioShowStore');
const { activeEvent, nextChange } = require('./audioEvents');
const logger = require('../utils/logger');

const MAX_WAIT_MS = 60 * 1000;

class AudioEventClock extends EventEmitter {
  constructor() {
    super();
    this._active = null;
    this._timer = null;
  }

  init() {
    configService.on('change', () => this.compute());
    this.compute();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  getActive() {
    return this._active;
  }

  compute() {
    const shows = store.list();
    const now = new Date();
    const active = activeEvent(shows, now);
    if (active !== this._active) {
      this._active = active;
      logger.info('Event audio: now playing', { event: active });
      this.emit('update', active);
    }
    // Look again when the next event starts or ends, and at least every minute
    const next = nextChange(shows, now);
    const wait = next ? Math.min(MAX_WAIT_MS, next - now + 50) : MAX_WAIT_MS;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.compute(), Math.max(1000, wait));
    this._timer.unref?.();
  }
}

module.exports = new AudioEventClock();

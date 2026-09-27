// server/services/schedulerService.js — which slideshows are on the screens now
//
// Provides
//   init()        recomputes on every config change and every 60 s
//   getActive()   the active slideshows: published, not hidden, in their schedule, by priority,
//                 at most 5
//   'update'      emitted with the new list when the active set changes
//   stop()
//
// Used by
//   server/index.js, realtime/displaySocket (sends a new playlist on 'update')
//
// Uses
//   services/slideshowStore (list), services/configService ('change'), utils/logger
const EventEmitter = require('events');
const configService = require('./configService');
const store = require('./slideshowStore');
const logger = require('../utils/logger');

class SchedulerService extends EventEmitter {
  constructor() {
    super();
    this._active = [];
    this._timer = null;
  }

  init() {
    configService.on('change', () => this.computeActive());
    this._timer = setInterval(() => this.computeActive(), 60 * 1000);
    this.computeActive();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  getActive() {
    return this._active;
  }

  computeActive() {
    const slideshows = store.list();
    const now = new Date();

    const candidates = slideshows
      .filter(ss => ss.enabled !== false && !ss.hidden)
      .filter(ss => this._matchesSchedule(ss.schedule, now))
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .slice(0, 5);

    const prevKey = this._active.map(s => s.folder).join(',');
    const nextKey = candidates.map(s => s.folder).join(',');

    if (prevKey !== nextKey) {
      this._active = candidates;
      logger.info('Scheduler: active set changed', { active: candidates.map(s => s.folder) });
      this.emit('update', this._active);
    }
  }

  _matchesSchedule(schedule, now) {
    if (!schedule || schedule.type === 'always') return true;

    if (schedule.type === 'timed') {
      const day = now.getDay();
      if (Array.isArray(schedule.days) && !schedule.days.includes(day)) return false;

      const currentMins = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = (schedule.startTime || '00:00').split(':').map(Number);
      const [eh, em] = (schedule.endTime || '23:59').split(':').map(Number);
      return currentMins >= sh * 60 + sm && currentMins < eh * 60 + em;
    }

    // Unknown schedule type — show by default
    return true;
  }
}

module.exports = new SchedulerService();

const EventEmitter = require('events');
const configService = require('./configService');
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
    const slideshows = configService.get('slideshows') || [];
    const now = new Date();

    const candidates = slideshows
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

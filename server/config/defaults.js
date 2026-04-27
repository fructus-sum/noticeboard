// Default values used when generating a fresh config.json on first run.
// passwordHash and jwtSecret are added by configService.init() using bcrypt + crypto.
module.exports = {
  _comment: 'Noticeboard configuration. Restart server after manual edits.',
  port: 3000,
  macFiltering: {
    _comment: 'Set enabled=true to restrict access to the approved MAC list below',
    enabled: false,
    approved: [],
  },
  display: {
    _comment: 'Default duration in seconds for image slides (videos play their full length)',
    defaultSlideDurationSeconds: 10,
  },
  slideshows: [],
};

// server/config/defaults.js — the settings a new config.json starts with
//
// configService.init writes these, with a bcrypt hash of the default password and a random
// jwtSecret, when data/config.json doesn't exist. The object is written as it is (its _comment
// keys too), so only settings belong here; the default password is in passwordDefaults.js.
//
// Used by
//   services/configService
//
// Change impact
//   Only new installs get a changed default: existing config.json files keep their values.
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
    // The location pin in the display's top-left corner, showing the server's address
    showDeviceInfo: true,
    // The logo above "No slideshow published" and in the admin sidebar
    logo: { enabled: true },
  },
  slideshows: [],
};

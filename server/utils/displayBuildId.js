const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { displayDistDir } = require('./pathHelpers');

// Short hash of the built display page. It changes whenever `npm run build` produces a
// new display bundle, so open screens can tell they are running old code. null if not built.
function displayBuildId() {
  try {
    const html = fs.readFileSync(path.join(displayDistDir(), 'index.html'));
    return crypto.createHash('sha1').update(html).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

module.exports = { displayBuildId };

// Zvýši patch číslo verzie vo version.js (1.0.1 -> 1.0.2). Spúšťa sa z git hooku pre-commit.
const fs = require('fs');
const f = __dirname + '/version.js';
const s = fs.readFileSync(f, 'utf8');
const m = s.match(/APP_VERSION = '(\d+)\.(\d+)\.(\d+)'/);
if (!m) { console.error('version.js: nenašiel som APP_VERSION'); process.exit(1); }
const v = `${m[1]}.${m[2]}.${+m[3] + 1}`;
fs.writeFileSync(f, s.replace(m[0], `APP_VERSION = '${v}'`));
console.log('verzia ->', v);

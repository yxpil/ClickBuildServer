const fs = require('fs');
const path = require('path');
const seeds = require('./case-seeds');
const dir = path.join(__dirname, '..', 'app', 'iface', 'cases');
let n = 0;
for (const [key, seed] of Object.entries(seeds)) {
  const file = path.join(dir, key + '.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  p.seed = { enabled: true, guard: seed.guard, sql: seed.sql.trim(), note: seed.note };
  fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
  n += 1;
  console.log('seed ->', key, seed.sql.length);
}
console.log('cases', n, '/', Object.keys(seeds).length);

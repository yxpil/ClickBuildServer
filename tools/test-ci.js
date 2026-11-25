// 作者：yxpil
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tests = [
  ['tools/test-new-iface.js'],
  ['tools/test-task-types.js'],
  ['tools/test-dark-grid.js'],
  ['tools/test-guide-templates.js'],
  ['tools/test-kits.js'],
  ['tools/test-script-dsl.js'],
  ['tools/test-table-import.js'],
  ['tools/test-table-data.js'],
  ['tools/test-db-ui.js'],
  ['tools/test-cross-table.js'],
  ['tools/test-shell-new.js'],
  ['tools/test-formtable.js'],
  ['tools/test-templates.js', '--gen'],
  ['tools/test-pack.js'],
  ['tools/test-deploy.js'],
  ['tools/test-history.js'],
  ['tools/test-ai.js'],
  ['tools/test-kernel.js'],
  ['tools/test-kernel-sqlgen.js'],
  ['tools/test-stop-server.js'],
  ['tools/test-i18n.js'],
];

const results = [];
let failed = 0;

for (const [file, ...args] of tests) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error(`\n[test:ci] missing test file: ${file}`);
    results.push({ file, code: 'missing', seconds: 0 });
    failed += 1;
    continue;
  }

  const name = args.length ? `${file} ${args.join(' ')}` : file;
  console.log(`\n===== ${name} =====`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [full, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  const seconds = (Date.now() - started) / 1000;
  const code = run.status === null ? `signal ${run.signal}` : run.status;
  results.push({ file: name, code, seconds });

  if (run.status !== 0) {
    failed += 1;
    console.error(`\n[test:ci] FAILED: ${name} (${code}, ${seconds.toFixed(1)}s)`);
    break;
  }
  console.log(`[test:ci] PASS: ${name} (${seconds.toFixed(1)}s)`);
}

const passed = results.filter((r) => r.code === 0).length;
const summary = [
  '### CI regression',
  '',
  '| Test | Result | Time |',
  '| --- | --- | --- |',
  ...results.map((r) => `| \`${r.file}\` | ${r.code === 0 ? 'pass' : 'fail'} | ${r.seconds.toFixed(1)}s |`),
  '',
  `Total: ${passed}/${tests.length} passed`,
  '',
].join('\n');

console.log(`\n[test:ci] ${passed}/${tests.length} passed`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

process.exit(failed ? 1 : 0);

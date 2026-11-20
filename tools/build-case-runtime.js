'use strict';

// 把 tools/case-app 下的业务页面运行时拼成 app/iface/runtime 下的独立文件。
// .yxpp 的 app 模式会直接读取这两个文件，导出后的服务也使用同一份运行时。

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'case-app');
const OUT = path.join(__dirname, '..', 'app', 'iface', 'runtime');

const order = ['00-core.js', '01-content.js', '02-commerce.js', '03-catalog.js', '04-desk.js', '05-chat.js', '06-social.js', '99-boot.js'];
const js = order.map((f) => `// ---- ${f} ----\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const css = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'app-runtime.js'), js, 'utf8');
fs.writeFileSync(path.join(OUT, 'app.css'), css, 'utf8');
console.log(`runtime ${Math.round(js.length / 1024)}KB js / ${Math.round(css.length / 1024)}KB css`);

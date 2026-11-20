'use strict';

// 语言包与安装器语言配置验收：不启动 Electron，直接校验离线词表、模式覆盖和内置数据。
// 用法：node tools\test-i18n.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const i18n = require(path.join(root, 'app/i18n'));
const templates = require(path.join(root, 'app/iface/templates'));
const library = require(path.join(root, 'app/iface/iface-library'));
const pack = JSON.parse(fs.readFileSync(path.join(root, 'app/i18n/locales/en-US.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let ok = 0;
let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✓ ' + name); } else { bad++; console.log('  ✗ ' + name + ' → ' + String(JSON.stringify(extra)).slice(0, 200)); }
};

const compile = (src) => {
  const s = String(src);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      out += '(.+?)';
      i = j;
    } else {
      out += s[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + out + '$');
};

const patterns = pack.patterns.map((p) => ({ re: compile(p.src), dst: String(p.dst || '') })).filter((p) => p.dst);
const translate = (value) => {
  const text = String(value == null ? '' : value);
  if (Object.prototype.hasOwnProperty.call(pack.dict, text)) return pack.dict[text];
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) {
      return p.dst.replace(/\$(\d+)/g, (all, n) => {
        const v = m[Number(n)];
        if (v == null) return '';
        return Object.prototype.hasOwnProperty.call(pack.dict, v) ? pack.dict[v] : v;
      });
    }
  }
  return text;
};

console.log('语言包验收');
t('zh_CN / zh-Hans / en_US 归一化', i18n.normalize('zh_CN') === 'zh-CN' && i18n.normalize('zh-Hans') === 'zh-CN' && i18n.normalize('en_US') === 'en-US');
t('语言菜单包含中英两种', i18n.localeList().map((x) => x.id).join(',') === 'zh-CN,en-US', i18n.localeList());
t('英文词典至少 800 条', Object.keys(pack.dict).length >= 800, Object.keys(pack.dict).length);
t('英文模式至少 90 条', pack.patterns.length >= 90, pack.patterns.length);
t('词典没有空值', Object.values(pack.dict).every((v) => typeof v === 'string' && v.trim()));
t('模式没有空值', pack.patterns.every((p) => p.src && p.dst));
t('不存在过宽的双占位模式', !pack.patterns.some((p) => compile(p.src).source === '^(.+?) (.+?)$'));

const HAN = /[\u3400-\u9fff]/;
t('精确词条：创建引导确认', translate('确认') === 'Confirm', translate('确认'));
t('精确词条：内置商城模版', translate('商城') === 'Mall', translate('商城'));
t('模式：接口重名', /demo/.test(translate('接口名「demo」已存在')) && /already exists/i.test(translate('接口名「demo」已存在')) && !HAN.test(translate('接口名「demo」已存在')), translate('接口名「demo」已存在'));
t('模式：生成文件与警告', /^\s*Generated 5 file/.test(translate('已生成 5 个文件，3 个警告')) && /3 warning/.test(translate('已生成 5 个文件，3 个警告')) && !HAN.test(translate('已生成 5 个文件，3 个警告')), translate('已生成 5 个文件，3 个警告'));
t('模式：路由数量与公开', /^\s*5 /.test(translate('5 条 · 公开')) && /Public$/.test(translate('5 条 · 公开')) && !HAN.test(translate('5 条 · 公开')), translate('5 条 · 公开'));
t('模式：组合统计', /^\s*9 /.test(translate('9 接口 · 46 tables · 86 routes')) && /46 tables/.test(translate('9 接口 · 46 tables · 86 routes')) && /86 routes/.test(translate('9 接口 · 46 tables · 86 routes')) && !HAN.test(translate('9 接口 · 46 tables · 86 routes')), translate('9 接口 · 46 tables · 86 routes'));
t('模式：自定义函数示例', translate('例：MASK_PHONE(v) → CONCAT(SUBSTR(v,0,3),"****",SUBSTR(v,7,4))').startsWith('Example: MASK_PHONE(v)'));

const missingTpl = templates.BUILTINS.filter((x) => !pack.dict[x.name] || !pack.dict[x.description]).map((x) => x.name);
t('26 套内置模版名称与说明都有英文', templates.BUILTINS.length === 26 && missingTpl.length === 0, missingTpl);
const missingTags = [...new Set(templates.BUILTINS.flatMap((x) => x.tags))].filter((x) => /[\u4e00-\u9fff]/.test(x) && !pack.dict[x]);
t('内置模版中文标签都有英文', missingTags.length === 0, missingTags);

const builtinIfaces = library.list().filter((x) => String(x.id).startsWith('builtin:'));
const missingIface = builtinIfaces.filter((x) => !pack.dict[x.name] || !pack.dict[x.description]).map((x) => x.name);
t('75 个内置接口名称与说明都有英文', builtinIfaces.length === 75 && missingIface.length === 0, missingIface);

const meta = pkg.build && pkg.build.nsis ? pkg.build.nsis : {};
const nsh = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
t('安装器包含中文与英文', Array.isArray(meta.installerLanguages) && meta.installerLanguages.join(',') === 'zh_CN,en_US', meta.installerLanguages);
t('安装器可自选语言并写入应用首次语言', meta.multiLanguageInstaller === true && meta.displayLanguageSelector === true && /install-language\.txt/.test(nsh));

const extra = JSON.parse(fs.readFileSync(path.join(root, 'tools/i18n-extra-zh.json'), 'utf8'));
t('补充界面词条都有英文', extra.dict.every((k) => pack.dict[k] && !HAN.test(pack.dict[k])), extra.dict.filter((k) => !pack.dict[k] || HAN.test(pack.dict[k])));
t('补充界面句式都有英文', extra.patterns.every((s) => { const p = pack.patterns.find((x) => x.src === s); return p && p.dst && !HAN.test(p.dst); }));

const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-i18n-'));
const dataRoot = path.join(tmp, 'click-build-server', 'clickbuild');
fs.mkdirSync(dataRoot, { recursive: true });
fs.writeFileSync(path.join(dataRoot, 'settings.json'), JSON.stringify({ language: 'zh-CN' }));
fs.writeFileSync(path.join(dataRoot, 'install-language.txt'), 'en-US');
process.env.APPDATA = tmp;
const fakeApp = { getPreferredSystemLanguages: () => ['zh-CN'], getLocale: () => 'zh-CN' };
t('安装期语言优先于旧设置', i18n.requestedLocale(fakeApp) === 'en-US', i18n.requestedLocale(fakeApp));
t('安装期标记读取后删除', !fs.existsSync(path.join(dataRoot, 'install-language.txt')));
t('版本号为语义化 x.y.z', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);

console.log(`\n结果：${ok} 通过，${bad} 失败`);
process.exit(bad ? 1 : 0);

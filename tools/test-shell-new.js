// 作者：yxpil
'use strict';

// 右键新建：只测命令构造，不写真实注册表；真实写入留给安装版设置页验收。
const path = require('path');
const fs = require('fs');
const os = require('os');
const shellNew = require(path.join(__dirname, '..', 'app/iface/shell-new'));
const pkg = require(path.join(__dirname, '..', 'app/iface/package'));

let ok = 0;
let bad = 0;
const t = (name, cond, extra) => {
  if (cond) { ok++; console.log('  ✓ ' + name); }
  else { bad++; console.log('  ✗ ' + name + ' → ' + JSON.stringify(extra)); }
};

t('右键新建只注册 .yxpn', shellNew.EXT === '.yxpn' && shellNew.PROG_ID === 'ClickBuild.Yxpn', [shellNew.EXT, shellNew.PROG_ID]);
t('类型名说明是服务器创建配置文件', /服务器创建配置文件/.test(shellNew.LABEL), shellNew.LABEL);
t('模板落在 shell-new 目录', /shell-new[\\/]ClickBuildServer-ServerProject\.yxpn$/.test(shellNew.templatePath('C:\\data\\clickbuild')), shellNew.templatePath('C:\\data\\clickbuild'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clickbuild-shellnew-'));
const tpl = shellNew.ensureTemplate({ root: tmp, port: 18100 });
const packed = pkg.readYxpn(tpl);
t('右键新建模板是可直接打开的 .yxpn', /\.yxpn$/.test(tpl) && packed.project && packed.project.name === '新建服务器工程' && (packed.project.interfaces || []).length === 1, packed.project && packed.project.name);
t('模板不夹带 Java 原生库', fs.statSync(tpl).size < 1024 * 1024, fs.statSync(tpl).size);
t('模板自带账号权限起步接口', packed.project && (packed.project.interfaces || []).some((i) => i.name === '账号权限'), packed.project && (packed.project.interfaces || []).map((i) => i.name));
fs.rmSync(tmp, { recursive: true, force: true });

const packaged = shellNew.openCommand({ exe: 'C:\\Program Files\\ClickBuildServer\\ClickBuildServer.exe', appDir: 'C:\\Program Files\\ClickBuildServer', packaged: true });
const source = shellNew.openCommand({ exe: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe', appDir: 'C:\\repo', packaged: false });
t('安装版用 exe 直接打开 %1', packaged === '"C:\\Program Files\\ClickBuildServer\\ClickBuildServer.exe" "%1"', packaged);
t('源码版带上 app 目录与 %1', /electron\.exe" "C:\\repo" "%1"/.test(source), source);

const cmds = shellNew.registerCommands({
  exe: 'C:\\Apps\\ClickBuildServer.exe',
  appDir: 'C:\\Apps',
  packaged: true,
  icon: 'C:\\Apps\\ClickBuildServer.exe',
  template: 'C:\\Users\\me\\clickbuild\\shell-new\\ClickBuildServer-ServerProject.yxpn',
});
t('注册命令共 8 步', cmds.length === 8, cmds.length);
t('全部写 HKCU，不碰 HKLM', cmds.every((c) => c.some((x) => String(x).startsWith('HKCU\\'))), cmds);
t('扩展名指向 ClickBuild.Yxpn', cmds.some((c) => c[1] === 'HKCU\\Software\\Classes\\.yxpn' && c.includes('ClickBuild.Yxpn')), cmds);
t('ShellNew 使用 FileName 模板', cmds.some((c) => c[1] === 'HKCU\\Software\\Classes\\.yxpn\\ShellNew' && c.includes('FileName') && c.some((x) => String(x).toLowerCase().endsWith('.yxpn'))), cmds);
t('ShellNew 菜单项写明服务器创建配置文件', cmds.some((c) => c[1].endsWith('\\ShellNew') && c.includes('ItemName') && c.includes(shellNew.LABEL)), cmds);
t('打开命令包含引号包好的 exe 与 %1', cmds.some((c) => c[1].endsWith('\\shell\\open\\command') && /"C:\\Apps\\ClickBuildServer\.exe" "%1"/.test(c[c.length - 2])), cmds);
t('移除只删 ShellNew，不动默认打开方式', shellNew.unregisterCommands().length === 1 && /ShellNew$/.test(shellNew.unregisterCommands()[0][1]), shellNew.unregisterCommands());

t('解析 reg query 的 FileName', shellNew.parseQueryValue('    FileName    REG_SZ    C:\\x\\a.yxpn\n', 'FileName') === 'C:\\x\\a.yxpn');
t('解析默认值', shellNew.parseQueryValue('HKEY_CURRENT_USER\\Software\\Classes\\.yxpn\n    (Default)    REG_SZ    ClickBuild.Yxpn\n\n', '') === 'ClickBuild.Yxpn');
t('没有值返回空字符串', shellNew.parseQueryValue('错误: 找不到', 'FileName') === '');

(async () => {
  const noTemplate = await shellNew.register({ exe: process.execPath, template: 'C:\\definitely-missing\\x.yxpn' });
  if (process.platform === 'win32') t('模板不存在时拒绝写注册表', noTemplate.ok === false && /模板不存在/.test(noTemplate.error), noTemplate);
  else t('非 Windows 返回不支持', noTemplate.ok === false && noTemplate.supported === false, noTemplate);

  const st = await shellNew.status({ template: shellNew.templatePath('C:\\data\\clickbuild') });
  t('状态查询返回结构化字段', st && st.ok === true && typeof st.registered === 'boolean' && typeof st.supported === 'boolean', st);
  console.log(`\n通过 ${ok} / ${ok + bad}${bad ? '，失败 ' + bad : '，全部通过'}`);
  process.exit(bad ? 1 : 0);
})();

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let electronApp = null;
try {
  const electron = require('electron');
  electronApp = electron && electron.app ? electron.app : null;
} catch (e) { electronApp = null; }

// 在 Electron 里用 userData；命令行生成时没有 app，就落到同一个 APPDATA 目录
function userDataDir() {
  if (electronApp && typeof electronApp.getPath === 'function') return electronApp.getPath('userData');
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(roaming, 'click-build-server');
}

const slug = (s) => String(s || 'project')
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'project';

const APP_ROOT = path.resolve(__dirname, '..');

// 源码运行 / 安装包运行：asar 里的 __dirname 含 app.asar，资源根换成 resources。
function isPackaged() {
  return __dirname.includes('app.asar');
}

function resourceRoot() {
  return isPackaged() && process.resourcesPath ? process.resourcesPath : APP_ROOT;
}

function nodeModulesRoot() {
  if (isPackaged() && process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
    if (fs.existsSync(unpacked)) return unpacked;
    const deps = path.join(process.resourcesPath, 'node_modules');
    if (fs.existsSync(deps)) return deps;
  }
  return path.join(APP_ROOT, 'node_modules');
}

function defaultGeneratedRoot() {
  return isPackaged() ? path.join(root(), 'generated') : path.join(APP_ROOT, 'generated');
}

function bundledNode() {
  const p = path.join(resourceRoot(), 'runtime', 'node', 'node.exe');
  return fs.existsSync(p) ? p : '';
}

function root() {
  const dir = path.join(userDataDir(), 'clickbuild');
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  return dir;
}

function projectPath(name) {
  return path.join(root(), 'projects', `${slug(name)}.json`);
}

function listProjects() {
  const dir = path.join(root(), 'projects');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = path.join(dir, f);
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
          file,
          name: data.name || f.replace(/\.json$/, ''),
          lang: data.lang || 'java',
          packageType: data.packageType || 'jar',
          modules: Array.isArray(data.modules) ? data.modules.length : 0,
          updatedAt: fs.statSync(file).mtimeMs,
        };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveProject(project) {
  const file = projectPath(project.name);
  fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf8');
  return file;
}

function loadProject(name) {
  const file = projectPath(name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deleteProject(name) {
  const file = projectPath(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

function defaultOutDir() {
  const docs = (electronApp && typeof electronApp.getPath === 'function')
    ? electronApp.getPath('documents')
    : path.join(os.homedir(), 'Documents');
  return path.join(docs, 'ClickBuildServer');
}

function readSettings() {
  const file = path.join(root(), 'settings.json');
  if (!fs.existsSync(file)) return { outDir: defaultOutDir(), lastProject: '' };
  try {
    return { outDir: defaultOutDir(), lastProject: '', ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { outDir: defaultOutDir(), lastProject: '' };
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(path.join(root(), 'settings.json'), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function home() {
  return os.homedir();
}

module.exports = { root, listProjects, saveProject, loadProject, deleteProject, readSettings, writeSettings, defaultOutDir, slug, home, APP_ROOT, isPackaged, resourceRoot, nodeModulesRoot, defaultGeneratedRoot, bundledNode };

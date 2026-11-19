'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const slug = (s) => String(s || 'project')
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'project';

function root() {
  const dir = path.join(app.getPath('userData'), 'clickbuild');
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
  const docs = app.getPath('documents');
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

module.exports = { root, listProjects, saveProject, loadProject, deleteProject, readSettings, writeSettings, defaultOutDir, slug, home };

'use strict';

// 问卷案例真实端到端验收：生成服务 -> 启动 -> 登录 -> 建问卷 -> 公开填写 -> 统计 -> 删除保护。
// 前置：MariaDB / Redis / RustFS 已启动。用法：node tools/smoke-survey.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const templates = require('../app/iface/templates');
const codegen = require('../app/iface/codegen');

const NODE = path.join(__dirname, '..', 'runtime', 'node', 'node.exe');
const NODE_PATH = path.join(__dirname, '..', 'node_modules');
const PORT = 18993;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = path.join(os.tmpdir(), 'clickbuild-survey-smoke');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}
function unwrap(json) {
  if (json && json.data !== undefined) return json.data;
  return json;
}
async function req(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: r.status, text, json, data: unwrap(json) };
}
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}

(async () => {
  const project = templates.get('builtin:survey').project;
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const g = codegen.writeTo(project, DIR, { port: PORT });
  console.log(`生成 ${g.files.length} 个文件 -> ${DIR}`);

  const child = spawn(NODE, ['server.js'], {
    cwd: DIR,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_PATH,
      PORT: String(PORT),
      MYSQL_DB: 'clickbuild_survey_smoke',
      RESET_DB: '1',
      CACHE_PREFIX: `icb:cache:survey-smoke:${Date.now()}`,
    },
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        const h = await req('GET', '/_health');
        if (h.status === 200) { ready = true; break; }
      } catch (e) { /* retry */ }
    }
    check('问卷服务启动', ready, ready ? '' : log.join('').slice(-900));
    if (!ready) return;

    const home = await req('GET', '/');
    check('GET / 返回问卷前端', home.status === 200 && home.text.includes('问卷系统') && home.text.includes('const CASE ='), `${home.status} ${home.text.length} B`);
    const yxpp = await req('GET', '/frontend/index.yxpp');
    check('GET /frontend/index.yxpp 可读', yxpp.status === 200 && yxpp.json && Array.isArray(yxpp.json.project.elements), `${yxpp.status} ${yxpp.text.length} B`);

    const noAuth = await req('GET', '/api/admin/surveys');
    check('管理接口未登录返回 401', noAuth.status === 401, String(noAuth.status));

    const login = await req('POST', '/api/admin/login', { username: 'admin', password: 'Admin@123456' });
    const token = login.data && (login.data.token || login.data.accessToken);
    check('默认管理员可登录', login.status === 200 && !!token, `${login.status} token=${token ? 'yes' : 'no'}`);
    if (!token) return;

    const questions = [
      { id: 'q1', type: 'single', title: '你使用产品的频率？', required: true, options: ['每天', '每周', '偶尔'] },
      { id: 'q2', type: 'multi', title: '你最看重什么？', required: false, options: ['速度', '稳定', '界面'] },
      { id: 'q3', type: 'rating', title: '整体满意度', required: true, options: [] },
      { id: 'q4', type: 'text', title: '还有什么建议？', required: false, options: [] },
    ];
    const create = await req('POST', '/api/admin/surveys', {
      title: '产品体验问卷',
      description: '端到端验收创建的问卷。',
      questions: JSON.stringify(questions),
      status: 1,
    }, token);
    check('创建并发布问卷', create.status === 201, `${create.status} ${create.text.slice(0, 120)}`);

    const list = await req('GET', '/api/surveys');
    const pub = rowsOf(list.data);
    check('公开列表出现新问卷', list.status === 200 && pub.length === 1, `${list.status} rows=${pub.length}`);
    const sid = pub[0] && pub[0].id;

    const detail = await req('GET', `/api/surveys/${sid}`);
    const qs = detail.data && JSON.parse(detail.data.questions || '[]');
    check('公开详情返回 4 道题', detail.status === 200 && qs.length === 4, `${detail.status} q=${qs.length}`);

    const answers = { q1: '每天', q2: ['速度', '稳定'], q3: '5', q4: '希望增加导出' };
    const submit = await req('POST', `/api/surveys/${sid}/responses`, {
      respondent: '验收用户',
      answers: JSON.stringify(answers),
    });
    check('公开提交答卷', submit.status === 201, `${submit.status} ${submit.text.slice(0, 120)}`);

    const detail2 = await req('GET', `/api/surveys/${sid}`);
    check('答卷计数 +1', detail2.data && Number(detail2.data.response_count) === 1, `count=${detail2.data && detail2.data.response_count}`);

    const responses = await req('GET', `/api/admin/surveys/${sid}/responses`, undefined, token);
    const rrows = rowsOf(responses.data);
    let answerOk = false;
    try { answerOk = JSON.parse(rrows[0].answers).q1 === '每天'; } catch (e) { /* ignore */ }
    check('后台读到答卷与答案', responses.status === 200 && rrows.length === 1 && answerOk, `${responses.status} rows=${rrows.length}`);

    const submit2 = await req('POST', `/api/surveys/${sid}/responses`, { respondent: '', answers: JSON.stringify({ q1: '偶尔', q3: '4' }) });
    check('匿名第二次提交', submit2.status === 201, String(submit2.status));
    const detail3 = await req('GET', `/api/surveys/${sid}`);
    check('计数累加到 2', Number(detail3.data.response_count) === 2, `count=${detail3.data.response_count}`);

    const del = await req('DELETE', `/api/admin/surveys/${sid}`, undefined, token);
    check('有答卷时拒绝删除', del.status === 409 && del.text.includes('HAS_RESPONSES'), `${del.status} ${del.text.slice(0, 120)}`);

    const close = await req('POST', `/api/admin/surveys/${sid}/status`, { status: 2 }, token);
    check('结束问卷', close.status === 200, String(close.status));
    const afterClose = await req('GET', '/api/surveys');
    check('结束后公开列表为空', rowsOf(afterClose.data).length === 0, `rows=${rowsOf(afterClose.data).length}`);
    const closedSubmit = await req('POST', `/api/surveys/${sid}/responses`, { answers: JSON.stringify({ q1: '每天' }) });
    check('结束后禁止提交', closedSubmit.status === 409 && closedSubmit.text.includes('SURVEY_CLOSED'), `${closedSubmit.status} ${closedSubmit.text.slice(0, 100)}`);

    const reopen = await req('POST', `/api/admin/surveys/${sid}/status`, { status: 1 }, token);
    check('重新发布', reopen.status === 200, String(reopen.status));
    const update = await req('PUT', `/api/admin/surveys/${sid}`, {
      title: '产品体验问卷（已更新）',
      description: '更新后的说明。',
      questions: JSON.stringify(questions),
      status: 1,
    }, token);
    check('编辑问卷', update.status === 200, String(update.status));
    const changed = await req('GET', `/api/surveys/${sid}`);
    check('编辑结果生效', changed.data && changed.data.title === '产品体验问卷（已更新）', changed.data && changed.data.title);

    const bad = await req('POST', '/api/admin/surveys', { title: '', questions: '[]', status: 1 }, token);
    check('空标题被拒绝', bad.status === 400, `${bad.status} ${bad.text.slice(0, 100)}`);

    const missing = await req('GET', '/api/surveys/999999');
    check('不存在问卷返回 404', missing.status === 404, String(missing.status));
  } finally {
    if (!child.killed) child.kill();
    await sleep(300);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 通过`);
    if (failed.length) console.log('服务日志尾部：\n' + log.join('').slice(-1600));
    process.exit(failed.length ? 1 : 0);
  }
})();

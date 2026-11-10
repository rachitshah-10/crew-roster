// Capture the handbook's screenshots and diagrams from the running app.
//
//   CREWCHECK_DB=/tmp/handbook.db uv run uvicorn app.main:create_app --factory --port 8010 &
//   npm run handbook:assets            # or: node scripts/capture_handbook_assets.mjs http://127.0.0.1:8010
//
// Use an empty database so the screens show only the scripted, fictional records.
// Uses the installed Google Chrome; set CHROME_CHANNEL=chromium to use Playwright's browser.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/handbook/assets');
const SAMPLES = path.join(ROOT, 'samples');
const BASE = (process.argv[2] || 'http://127.0.0.1:8010').replace(/\/$/, '');

const browser = await chromium.launch(process.env.CHROME_CHANNEL === 'chromium' ? {} : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: 'UTC' });
await context.addInitScript(() => localStorage.setItem('crewcheck.displayZone', 'UTC'));
const page = await context.newPage();
const save = (name, target = page) => target.screenshot({ path: path.join(OUT, name), animations: 'disabled' });
const hideToast = () => page.evaluate(() => document.querySelector('#toast')?.classList.remove('visible'));

async function signIn(role) {
  await page.goto(BASE + '/');
  if (await page.$('[data-action=logout]')) { await page.click('[data-action=logout]'); }
  await page.waitForSelector('#login-form');
  await page.click(`[data-demo=${role}]`);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#display-zone');
}

async function upload(file) {
  await page.goto(BASE + '/#upload');
  await page.waitForSelector('#roster-file');
  await page.setInputFiles('#roster-file', path.join(SAMPLES, file));
}

async function check(file) {
  await upload(file);
  await page.waitForSelector('[data-action=run]');
  await page.click('[data-action=run]');
  await page.waitForSelector('[data-view=table]');
  await hideToast();
}

// Scheduler: upload, preview, evidence, timeline, one rejected file.
await signIn('scheduler');
await upload('sample_roster.csv');
await page.waitForSelector('[data-action=run]');
await save('upload.png');
await page.click('[data-action=run]');
await page.waitForSelector('[data-view=table]');
await hideToast();
await page.click('[data-view=table]');
await page.click('#result-body tr:nth-child(3) [data-row]');   // D103, insufficient rest
await page.waitForSelector('.drawer');
// Crop the drawer to its content instead of the full window height.
const box = await page.locator('.drawer').boundingBox();
const foot = await page.locator('.drawerfoot').boundingBox();
await page.screenshot({ path: path.join(OUT, 'evidence-detail.png'), clip: { x: box.x, y: box.y, width: box.width, height: foot.y + foot.height + 28 - box.y } });
await page.keyboard.press('Escape');

await check('review_roster.csv');
await page.click('[data-view=timeline]');
await page.waitForSelector('.tlgrid');
await page.setViewportSize({ width: 1440, height: 1000 });
await save('timeline.png', page.locator('.card', { has: page.locator('.tabbar') }));
await page.setViewportSize({ width: 1440, height: 900 });
await page.click('[data-view=table]');
await upload('edge-cases/04_duplicate_records.csv');
await page.waitForSelector('#upload-error .error');

// Manager: history, import log, rule builder with an impact preview.
await signIn('manager');
await page.goto(BASE + '/#checks');
await page.waitForSelector('table');
await save('history.png');
await page.goto(BASE + '/#imports');
await page.waitForSelector('#import-status');
await page.click('.importerrors summary');
await save('import-log.png');
await page.goto(BASE + '/#rules');
await page.waitForSelector('#rule-editors');
const night = await page.$eval('#preset', s => [...s.options].findIndex(o => o.text === 'Night duty limit'));
await page.selectOption('#preset', String(night));
await page.click('[data-action=rule-add]');
const last = (await page.$$('.rulecard')).length - 1;
await page.selectOption(`#r${last}-zone`, 'UTC');
// A second draft rule that changes the outcome, so the impact preview shows a difference.
const weekly = await page.$eval('#preset', s => [...s.options].findIndex(o => o.text === 'Duty hours in any 7 days'));
await page.selectOption('#preset', String(weekly));
await page.click('[data-action=rule-add]');
await page.selectOption(`#r${last + 1}-zone`, 'UTC');
await page.fill(`#r${last + 1}-limit`, '20');
await page.selectOption('#impact-run', { index: 0 });
await page.click('[data-action=rule-preview]');
await page.waitForSelector('.impactbox');
await save('rule-card.png', page.locator('.rulecard').nth(last));
await save('rule-impact.png', page.locator('.impact'));

// Diagrams drawn with the app's palette.
const diagram = (body, width, height) => `<!doctype html><html><head><style>
  *{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Arial,sans-serif;color:#182d44;background:#fff}
  .canvas{position:relative;width:${width}px;height:${height}px;padding:28px}
  .box{position:absolute;border:1.5px solid #9fb5c8;background:#f6f9fc;padding:12px 14px;font-size:13px;line-height:1.45}
  .box b{display:block;font-size:14px;margin-bottom:4px}.box small{color:#5d7186;font-size:12px}
  .dark{background:#142a43;color:#fff;border-color:#142a43}.dark small{color:#b8c9db}
  .boundary{position:absolute;border:1.5px dashed #7d93a8;background:#fbfcfe}
  .label{position:absolute;font-size:11px;letter-spacing:1.2px;font-weight:700;color:#5d7186;text-transform:uppercase}
  svg{position:absolute;inset:0;overflow:visible}line,path{stroke:#4d6a85;stroke-width:1.6;fill:none}
  .dash{stroke-dasharray:5 4}text{font-size:11.5px;fill:#4d6a85}
</style></head><body><div class="canvas">${body}</div></body></html>`;

const arrow = `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#4d6a85" stroke="none"/></marker></defs>`;
const node = (x, y, w, title, text, cls = '') => `<div class="box ${cls}" style="left:${x}px;top:${y}px;width:${w}px"><b>${title}</b><small>${text}</small></div>`;
const architecture = diagram(`
  ${node(420, 20, 240, 'Browser', 'Static UI served by the app', 'dark')}
  <div class="boundary" style="left:28px;top:118px;width:1024px;height:316px"></div>
  <div class="label" style="left:44px;top:130px">One FastAPI process · app/</div>
  ${node(420, 160, 240, 'Request layer · main.py', 'Size limit, host and origin checks, session, CSRF, roles')}
  <div class="label" style="left:60px;top:404px">Pure logic row · no database or file access</div>
  ${node(60, 318, 280, 'Parser · parsing.py', 'CSV/XLSX, column mapping, time zones, DST')}
  ${node(400, 318, 280, 'Rules + engine · ruleset.py, engine.py', 'Rule building blocks and deterministic findings')}
  ${node(740, 318, 280, 'Timeline · timeline.py', 'Crew lanes and zone-aware days')}
  ${node(60, 160, 280, 'Repository · repository.py', 'All SQL (SQLAlchemy Core), Alembic migrations')}
  ${node(740, 160, 280, 'File store · filestore.py', 'Original uploads addressed by SHA-256')}
  ${node(60, 492, 280, 'Database', 'SQLite file (default) or PostgreSQL via CREWCHECK_DATABASE_URL')}
  ${node(740, 492, 280, 'Disk or volume', 'data/files/ (CREWCHECK_FILES)')}
  <svg>${arrow}
    <line x1="540" y1="84" x2="540" y2="156" marker-end="url(#a)"/>
    <line x1="420" y1="200" x2="344" y2="200" marker-end="url(#a)"/>
    <line x1="660" y1="200" x2="736" y2="200" marker-end="url(#a)"/>
    <line x1="500" y1="240" x2="230" y2="314" marker-end="url(#a)"/>
    <line x1="540" y1="240" x2="540" y2="314" marker-end="url(#a)"/>
    <line x1="580" y1="240" x2="850" y2="314" marker-end="url(#a)"/>
    <path d="M60 200 C 0 200, 0 540, 56 540" marker-end="url(#a)"/>
    <path d="M1020 200 C 1080 200, 1080 540, 1024 540" marker-end="url(#a)"/>
  </svg>`, 1100, 580);

const lanes = [['Scheduler', 130], ['Browser UI', 380], ['API and engine', 640], ['Database and files', 900]];
const steps = [
  [130, 380, 'Choose file; sheet, columns, zone if asked'],
  [380, 640, 'POST /api/uploads'],
  [640, 900, 'Store original file; log the attempt'],
  [640, 380, 'Invalid: 422 with row errors, nothing saved', true],
  [640, 900, 'Valid: save rows + active rule version'],
  [640, 380, 'Preview: counts, first 20 rows, rules', true],
  [130, 380, 'Run roster check'],
  [380, 640, 'POST /api/uploads/{id}/check'],
  [640, 900, 'Save result snapshot (once per upload)'],
  [640, 380, 'Findings, evidence, timeline', true],
  [130, 380, 'Manager: history, import log, rules'],
];
const workflow = diagram(`
  ${lanes.map(([name, x]) => `<div class="box ${name === 'Scheduler' ? 'dark' : ''}" style="left:${x - 95}px;top:10px;width:190px;text-align:center"><b style="margin:0">${name}</b></div>`).join('')}
  <svg>${arrow}
    ${lanes.map(([, x]) => `<line x1="${x}" y1="58" x2="${x}" y2="${78 + steps.length * 44}" class="dash" style="stroke:#c3d0dc"/>`).join('')}
    ${steps.map(([from, to, text, back], i) => {
      const y = 92 + i * 44, mid = (from + to) / 2;
      return `<line x1="${from}" y1="${y}" x2="${to + (to > from ? -4 : 4)}" y2="${y}" marker-end="url(#a)" class="${back ? 'dash' : ''}"/>
              <text x="${mid}" y="${y - 7}" text-anchor="middle">${text}</text>`;
    }).join('')}
  </svg>`, 1040, 100 + steps.length * 44);

for (const [name, html, width] of [['architecture.png', architecture, 1100], ['workflow.png', workflow, 1040]]) {
  const sheet = await context.newPage();
  await sheet.setViewportSize({ width, height: 400 });
  await sheet.setContent(html);
  await save(name, sheet.locator('.canvas'));
  await sheet.close();
}

await browser.close();
console.log(`Saved handbook assets to ${OUT}`);

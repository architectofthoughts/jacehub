#!/usr/bin/env node
// 디테일 시트용 스크린샷 캡처 — catalog.json의 url이 있는 앱(정문·미검수·퇴역후보)을 1280×800으로 찍어 shots/<slug>.jpg 저장.
//   node scripts/shots.mjs            # 전부 (manual.json에 적힌 slug는 건너뜀)
//   node scripts/shots.mjs --only kyou,jacewiki
//   node scripts/shots.mjs --force    # manual.json 무시
// playwright-core는 ~/tools/shot/node_modules 것을 빌려 쓴다 (jacehub는 의존성 0 유지).
import { readdirSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.env.HOME}/tools/shot/package.json`)('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
const HOME = process.env.HOME;
const libs = `${HOME}/tools/shot/libs`;
if (existsSync(libs)) process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH ? `${libs}:${process.env.LD_LIBRARY_PATH}` : libs;
const pw = `${HOME}/.cache/ms-playwright`;
const dir = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const exe = [`${pw}/${dir}/chrome-linux64/chrome`, `${pw}/${dir}/chrome-linux/chrome`].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? (argv[onlyIdx + 1] || '').split(',').filter(Boolean) : [];
const force = argv.includes('--force');
const SECTIONS = new Set(['game', 'life', 'tool', 'archive', 'huchu', 'unreviewed', 'retire']);
const catalog = JSON.parse(readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
const manualPath = path.join(OUT, 'manual.json');
const manual = new Set(existsSync(manualPath) ? JSON.parse(readFileSync(manualPath, 'utf8')) : []);
mkdirSync(OUT, { recursive: true });

let apps = catalog.apps.filter((a) => SECTIONS.has(a.section) && a.url);
if (only.length) apps = apps.filter((a) => only.includes(a.slug));
else if (!force) apps = apps.filter((a) => !manual.has(a.slug));

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const results = [];
async function shoot(app) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  try {
    await page.goto(app.url, { waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${app.slug}.jpg`), type: 'jpeg', quality: 60 });
    results.push(`${app.slug} ok`);
  } catch (e) {
    results.push(`${app.slug} FAIL ${String(e.message).slice(0, 80)}`);
  }
  await ctx.close();
}
for (let i = 0; i < apps.length; i += 4) await Promise.all(apps.slice(i, i + 4).map(shoot));
await browser.close();
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.endsWith(' ok')).length}/${apps.length} captured → shots/`);

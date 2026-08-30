import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

// 정적 화이트리스트 — 여기 없는 루트 파일은 dist에 올라가지 않는다.
const staticEntries = ['index.html', 'style.css', 'app.js', 'catalog.json', 'retroarch-hotkeys.html'];
const functionEntries = ['functions/api/projects.js', 'functions/api/vault.js'];
// 통째로 복사하는 디렉토리. required=false는 아직 없어도 빌드를 막지 않는다
// (icons/·shots/는 별도 파이프라인 산출물이라 작업 중엔 비어 있을 수 있음).
const directoryEntries = [
  { dir: 'functions', required: true },
  { dir: 'icons', required: false },
  { dir: 'shots', required: false },
];

function assertNodeCheck(relativeFile) {
  const result = spawnSync(process.execPath, ['--check', relativeFile], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    return;
  }

  const errorOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  throw new Error(`Syntax check failed for ${relativeFile}\n${errorOutput}`);
}

async function assertFile(relativeFile) {
  const absoluteFile = path.join(rootDir, relativeFile);
  await stat(absoluteFile);
}

async function directoryExists(relativeDir) {
  try {
    const info = await stat(path.join(rootDir, relativeDir));
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function assertCatalog() {
  const raw = await readFile(path.join(rootDir, 'catalog.json'), 'utf8');
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (error) {
    throw new Error(`catalog.json is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(catalog.sections) || !Array.isArray(catalog.apps)) {
    throw new Error('catalog.json must have sections[] and apps[]');
  }
  const sectionKeys = new Set(catalog.sections.map((section) => section.key));
  const seen = new Set();
  for (const app of catalog.apps) {
    if (!app.slug || !app.name) {
      throw new Error(`catalog.json app entry missing slug/name: ${JSON.stringify(app)}`);
    }
    if (seen.has(app.slug)) {
      throw new Error(`catalog.json duplicate slug: ${app.slug}`);
    }
    seen.add(app.slug);
    if (!sectionKeys.has(app.section)) {
      throw new Error(`catalog.json app "${app.slug}" has unknown section "${app.section}"`);
    }
  }
  return catalog.apps.length;
}

async function build() {
  const allEntries = [...staticEntries, ...functionEntries];
  await Promise.all(allEntries.map(assertFile));

  const indexHtml = await readFile(path.join(rootDir, 'index.html'), 'utf8');
  if (!indexHtml.includes('style.css') || !indexHtml.includes('app.js')) {
    throw new Error('index.html must reference style.css and app.js');
  }

  const appCount = await assertCatalog();

  ['app.js', ...functionEntries].forEach(assertNodeCheck);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await Promise.all(staticEntries.map((entry) => cp(path.join(rootDir, entry), path.join(distDir, entry))));

  const copiedDirs = [];
  for (const { dir, required } of directoryEntries) {
    if (await directoryExists(dir)) {
      await cp(path.join(rootDir, dir), path.join(distDir, dir), { recursive: true });
      copiedDirs.push(dir);
    } else if (required) {
      throw new Error(`Required directory missing: ${dir}`);
    } else {
      console.warn(`[build] optional directory "${dir}" not found — skipped`);
    }
  }

  const manifestFiles = await Promise.all(allEntries.map(async (entry) => {
    const info = await stat(path.join(rootDir, entry));
    return { file: entry, bytes: info.size };
  }));

  await writeFile(
    path.join(distDir, 'build-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        catalogApps: appCount,
        directories: copiedDirs,
        files: manifestFiles,
      },
      null,
      2
    )
  );

  console.log(`Built ${manifestFiles.length} source files + [${copiedDirs.join(', ')}] into ${path.relative(rootDir, distDir)} (catalog: ${appCount} apps)`);
}

build().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

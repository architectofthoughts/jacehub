import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const staticEntries = ['index.html', 'style.css', 'app.js', 'lobby.html', 'lobby.css', 'lobby.js', 'quests.html', 'quests.css', 'quests.js', 'retroarch-hotkeys.html'];
const functionEntries = ['functions/api/projects.js', 'functions/api/vault.js', 'functions/api/_quest_shared.js', 'functions/api/quests.js', 'functions/api/ingest.js', 'functions/api/progress.js'];
const libEntries = ['lib/quest-logic.js'];

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

async function build() {
  const allEntries = [...staticEntries, ...functionEntries, ...libEntries];
  await Promise.all(allEntries.map(assertFile));

  const indexHtml = await readFile(path.join(rootDir, 'index.html'), 'utf8');
  if (!indexHtml.includes('style.css') || !indexHtml.includes('app.js')) {
    throw new Error('index.html must reference style.css and app.js');
  }

  const lobbyHtml = await readFile(path.join(rootDir, 'lobby.html'), 'utf8');
  if (!lobbyHtml.includes('lobby.css') || !lobbyHtml.includes('lobby.js')) {
    throw new Error('lobby.html must reference lobby.css and lobby.js');
  }

  const questsHtml = await readFile(path.join(rootDir, 'quests.html'), 'utf8');
  if (!questsHtml.includes('quests.css') || !questsHtml.includes('quests.js')) {
    throw new Error('quests.html must reference quests.css and quests.js');
  }

  ['app.js', 'lobby.js', 'quests.js', ...functionEntries, ...libEntries].forEach(assertNodeCheck);

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await Promise.all(staticEntries.map((entry) => cp(path.join(rootDir, entry), path.join(distDir, entry))));
  await cp(path.join(rootDir, 'functions'), path.join(distDir, 'functions'), { recursive: true });
  await cp(path.join(rootDir, 'lib'), path.join(distDir, 'lib'), { recursive: true });

  const manifestFiles = await Promise.all(allEntries.map(async (entry) => {
    const info = await stat(path.join(rootDir, entry));
    return { file: entry, bytes: info.size };
  }));

  await writeFile(
    path.join(distDir, 'build-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        files: manifestFiles,
      },
      null,
      2
    )
  );

  console.log(`Built ${manifestFiles.length} source files into ${path.relative(rootDir, distDir)}`);
}

build().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

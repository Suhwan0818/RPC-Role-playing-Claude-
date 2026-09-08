#!/usr/bin/env node
// rpg-mode — 프로젝트 계급 · 장비 무게 측정.
//
//   require('./rpg-scan')      → { evaluate, card, RANKS, WEIGHTS }
//   node rpg-scan.js [경로]    → 카드 출력
//
// 계급도 무게도 감상이 아니라 실제로 잰 값에서만 나온다. 파일은 읽지 않고 크기만 본다.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BUDGET_MS = 3000; // 전체 예산. 넘으면 그때까지의 값으로 partial 반환
const MAX_FILES = 5000;
const MAX_DEPTH = 8;
const HEAVY_BYTES = 32 * 1024; // 이보다 크면 "거대 파일"

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor',
  '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'coverage',
  '.claude-flow', '.swarm', '.gradle', '.idea', '.vscode',
]);

// 잠금 파일은 사람이 쓴 코드가 아니다. 무게에 넣으면 전부 과적재로 보인다.
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
  'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'go.sum', 'skills-lock.json',
]);

const SOURCE_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php',
  '.scala', '.sh', '.ps1', '.sql', '.vue', '.svelte', '.html', '.css', '.scss',
  '.md', '.json', '.yml', '.yaml', '.toml',
]);

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'setup.py', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json',
  'Package.swift', 'CMakeLists.txt',
];

const CI_PATHS = [
  '.github/workflows', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml',
  'Jenkinsfile', '.travis.yml',
];

const DOC_PATHS = ['docs', 'doc', 'CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md'];

const TEST_PATH = /(^|[\\/])(tests?|__tests__|spec|specs)[\\/]|\.(test|spec)\.[a-z]+$|(^|[\\/])test_[^\\/]+\.py$/i;

// 낮은 것부터. 각 항목의 min 은 그 계급에 들어가는 점수 하한선.
const RANKS = [
  { min: 0, ko: '떠돌이', en: 'Wanderer' },
  { min: 10, ko: '마을 주민', en: 'Villager' },
  { min: 25, ko: '견습', en: 'Apprentice' },
  { min: 40, ko: '모험가', en: 'Adventurer' },
  { min: 60, ko: '기사', en: 'Knight' },
  { min: 75, ko: '성기사', en: 'Paladin' },
  { min: 90, ko: '용사', en: 'Hero' },
];

const WEIGHTS = [
  { min: 0, ko: '가벼움', en: 'light' },
  { min: 15, ko: '적당', en: 'fair' },
  { min: 35, ko: '무거움', en: 'heavy' },
  { min: 60, ko: '과적재', en: 'overloaded' },
];

// 계급별 도트아트. 폭이 애매한 문자는 터미널에서 깨지므로 블록 문자만 쓴다.
const ART = [
  ['░░███░░', '░░▒█▒░░', '░░███░░', '░░█░█░░', '░░▒░▒░░'],
  ['░▒███▒░', '░░▒█▒░░', '░▒███▒░', '░░█░█░░', '░░▒░▒░░'],
  ['░░███░░', '░░▒█▒░░', '░░███▓░', '░░█░█▓░', '░░▒░▒░░'],
  ['░░███░░', '░░▒█▒░░', '░▒████▓', '░░█░█▓░', '░░▒░▒░░'],
  ['░░▓▓▓░░', '░░▒█▒░░', '░▓████▓', '░▓█░█▓░', '░░▒░▒░░'],
  ['░░▓█▓░░', '░░▓▓▓░░', '░▓████▓', '░▓███▓░', '░░█░█░░'],
  ['▒░▓█▓░▒', '▒░▓▓▓░▒', '▒▓████▓', '▒▓█▓█▓▒', '░░█░█░░'],
];

function tierFor(table, value) {
  let index = 0;
  for (let i = 0; i < table.length; i += 1) {
    if (value >= table[i].min) index = i;
  }
  return index;
}

function has(root, relative) {
  try {
    return fs.existsSync(path.join(root, relative));
  } catch (e) {
    return false;
  }
}

/** git 이 관리하는 파일 목록. 저장소가 아니거나 git 이 없으면 null. */
function gitFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], {
    timeout: 1500, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8',
  });
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.split('\0').filter(Boolean);
}

/** git 이 없을 때의 폴백. 깊이와 개수를 제한한 너비 우선 탐색. */
function walkFiles(root, deadline) {
  const found = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length && found.length < MAX_FILES) {
    if (Date.now() > deadline) break;
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        if (depth < MAX_DEPTH) queue.push({ dir: full(dir, entry.name), depth: depth + 1 });
      } else if (entry.isFile()) {
        found.push(path.relative(root, full(dir, entry.name)));
        if (found.length >= MAX_FILES) break;
      }
    }
  }
  return found;
}

function full(dir, name) {
  return path.join(dir, name);
}

function countTodos(root) {
  const r = spawnSync(
    'git',
    ['-C', root, 'grep', '-I', '-o', '-E', 'TODO|FIXME|HACK|XXX'],
    { timeout: 1000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  );
  if (r.error || typeof r.stdout !== 'string') return null; // 못 쟀으면 null. 0 으로 속이지 않는다
  if (r.status === 1) return 0; // git grep 규약: 일치 없음
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).length;
}

function countCommits(root) {
  const r = spawnSync('git', ['-C', root, 'rev-list', '--count', 'HEAD'], {
    timeout: 800, encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return 0;
  const n = parseInt(String(r.stdout).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function bandPoints(value, bands) {
  let points = 0;
  for (const [threshold, score] of bands) {
    if (value >= threshold) points = score;
  }
  return points;
}

/** 프로젝트를 측정하고 계급·무게를 매긴다. 절대 던지지 않는다. */
function evaluate(root) {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const isRepo = has(root, '.git');

  let relatives = isRepo ? gitFiles(root) : null;
  if (!relatives) relatives = walkFiles(root, deadline);

  let files = 0;
  let bytes = 0;
  let tests = 0;
  const heavy = [];

  for (const relative of relatives) {
    if (files >= MAX_FILES || Date.now() > deadline) break;
    const segments = relative.split(/[\\/]/);
    if (segments.some((s) => SKIP_DIRS.has(s))) continue;
    if (LOCK_FILES.has(segments[segments.length - 1])) continue;
    if (!SOURCE_EXT.has(path.extname(relative).toLowerCase())) continue;

    let size;
    try {
      size = fs.statSync(path.join(root, relative)).size;
    } catch (e) {
      continue; // 목록에는 있는데 사라진 파일
    }
    files += 1;
    bytes += size;
    if (TEST_PATH.test(relative)) tests += 1;
    if (size >= HEAVY_BYTES) heavy.push({ file: relative, bytes: size });
  }

  heavy.sort((a, b) => b.bytes - a.bytes);

  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(root);
  } catch (e) {
    /* 읽을 수 없으면 플래그는 전부 false 가 된다 */
  }

  const metrics = {
    root,
    isRepo,
    files,
    bytes,
    tests,
    commits: isRepo ? countCommits(root) : 0,
    todos: isRepo && Date.now() < deadline ? countTodos(root) : null,
    heavy: heavy.slice(0, 3),
    heavyCount: heavy.length,
    hasReadme: rootEntries.some((n) => /^readme(\.|$)/i.test(n)),
    hasLicense: rootEntries.some((n) => /^licen[cs]e(\.|$)/i.test(n)),
    hasCI: CI_PATHS.some((p) => has(root, p)),
    hasManifest: MANIFESTS.some((p) => has(root, p)),
    hasDocs: DOC_PATHS.some((p) => has(root, p)),
    partial: Date.now() > deadline,
    elapsedMs: Date.now() - started,
  };

  const weight = weighEquipment(metrics);
  const rank = rankProject(metrics, weight);
  return { ...metrics, weight, rank };
}

/** 장비 무게 지수 0-100 과 구간. 근거가 되는 값을 함께 돌려준다. */
function weighEquipment(m) {
  const avgBytes = m.files > 0 ? Math.round(m.bytes / m.files) : 0;
  const todos = Number.isFinite(m.todos) ? m.todos : 0;

  const index = Math.min(
    100,
    Math.min(40, m.heavyCount * 8) +
      bandPoints(avgBytes, [[6 * 1024, 10], [12 * 1024, 20]]) +
      Math.min(25, Math.floor(todos / 5) * 5) +
      bandPoints(m.files, [[150, 8], [400, 15]])
  );

  const tier = tierFor(WEIGHTS, index);
  return { index, tier, avgBytes, ...WEIGHTS[tier] };
}

/** 계급 점수 0-100 과 구간. 하드 게이트가 상한을 누른다. */
function rankProject(m, weight) {
  const testRatio = m.files > 0 ? m.tests / m.files : 0;
  const score = Math.min(
    100,
    (m.hasManifest ? 10 : 0) +
      (m.hasReadme ? 10 : 0) +
      (m.hasDocs ? 5 : 0) +
      (m.hasLicense ? 5 : 0) +
      (m.hasCI ? 15 : 0) +
      (m.tests > 0 ? 20 : 0) +
      (testRatio >= 0.15 ? 10 : 0) +
      bandPoints(m.commits, [[1, 2], [5, 5], [20, 8], [100, 12], [500, 15]]) +
      bandPoints(m.files, [[3, 2], [10, 5], [30, 8], [100, 10]])
  );

  let tier = tierFor(RANKS, score);
  const gates = [];

  // 테스트 없이는 견습(2)을 넘지 못한다.
  if (m.tests === 0 && tier > 2) {
    tier = 2;
    gates.push('테스트 없음');
  }
  // 짐을 진 채로는 기사(4)까지. 용사는 가벼워야 한다.
  if (weight.tier >= 2 && tier > 4) {
    tier = 4;
    gates.push('장비 과중');
  }

  return { score, tier, gates, ...RANKS[tier] };
}

/** 사람이 읽는 카드. 아트를 뺄 수도 있다. */
function card(r, { art = true } = {}) {
  const lines = [];
  if (art) lines.push(...ART[r.rank.tier].map((row) => '   ' + row));

  const kb = (n) => (n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B');
  const gate = r.rank.gates.length ? ` (상한: ${r.rank.gates.join(', ')})` : '';
  const todos = Number.isFinite(r.todos) ? `TODO ${r.todos}` : 'TODO 미측정';

  lines.push(
    `계급: ${r.rank.ko} (${r.rank.en}) · 점수 ${r.rank.score}/100${gate}`,
    `규모: 파일 ${r.files} · ${kb(r.bytes)} · 테스트 ${r.tests} · 커밋 ${r.commits} · ${todos}`,
    `장비 무게: ${r.weight.ko} (지수 ${r.weight.index}, 평균 ${kb(r.weight.avgBytes)}/파일)`
  );

  if (r.heavyCount > 0) {
    const top = r.heavy.map((h) => `${h.file} ${kb(h.bytes)}`).join(', ');
    lines.push(`거대 파일 ${r.heavyCount}개 (32KB 이상): ${top}`);
  }

  const missing = [];
  if (!r.hasReadme) missing.push('README');
  if (r.tests === 0) missing.push('테스트');
  if (!r.hasCI) missing.push('CI');
  if (!r.hasManifest) missing.push('매니페스트');
  if (missing.length) lines.push(`빠진 장비: ${missing.join(', ')}`);
  if (r.partial) lines.push(`부분 측정 — ${BUDGET_MS}ms 예산 초과. 실제보다 작게 잡혔을 수 있다.`);

  return lines.join('\n');
}

module.exports = { evaluate, card, RANKS, WEIGHTS, ART, HEAVY_BYTES, BUDGET_MS };

// ── CLI ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const target = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = evaluate(path.resolve(target));
  process.stdout.write(card(result) + `\n측정 ${result.elapsedMs}ms · ${result.root}\n`);
}

#!/usr/bin/env node
// rpg-scan 자체 점검. 프레임워크 없음 — node tests/rpg-scan.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { evaluate, card, RANKS, WEIGHTS, HEAVY_BYTES } = require('../hooks/rpg-scan');

const roots = [];

/** 합성 프로젝트를 만든다. files 는 { 상대경로: 내용 또는 바이트수 }. */
function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-scan-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'number' ? 'x'.repeat(content) : content, 'utf8');
  }
  return root;
}

const rankName = (r) => RANKS[r.rank.tier].ko;
const weightName = (r) => WEIGHTS[r.weight.tier].ko;

// ── 파일 하나짜리 = 떠돌이 ───────────────────────────────────────
const empty = evaluate(makeProject({ 'a.js': 'let a = 1\n' }));
assert.strictEqual(rankName(empty), '떠돌이', '파일 하나짜리는 떠돌이');
assert.strictEqual(empty.rank.score, 0);
assert.strictEqual(empty.commits, 0, 'git 이 아니면 커밋 0');
assert.strictEqual(empty.todos, null, 'git 이 아니면 TODO 는 미측정(null)');
assert.strictEqual(empty.tests, 0);

// ── README + 매니페스트만 = 테스트 게이트가 상한을 누른다 ─────────
const noTests = evaluate(
  makeProject({
    'README.md': '# hi\n',
    'package.json': '{}\n',
    'CONTRIBUTING.md': 'x\n',
    'LICENSE': 'MIT\n',
    '.github/workflows/ci.yml': 'on: push\n',
    'src/a.js': 'a\n',
    'src/b.js': 'b\n',
    'src/c.js': 'c\n',
    'src/d.js': 'd\n',
    'src/e.js': 'e\n',
  })
);
assert.ok(noTests.rank.score >= 40, '장비를 다 갖췄으니 점수 자체는 높다');
assert.strictEqual(rankName(noTests), '견습', '테스트가 없으면 견습이 상한');
assert.ok(noTests.rank.gates.includes('테스트 없음'), '상한 이유를 밝힌다');

// ── 테스트까지 있으면 게이트가 풀린다 ────────────────────────────
const withTests = evaluate(
  makeProject({
    'README.md': '# hi\n',
    'package.json': '{}\n',
    'LICENSE': 'MIT\n',
    'docs/guide.md': 'x\n',
    '.github/workflows/ci.yml': 'on: push\n',
    'src/a.js': 'a\n',
    'src/b.js': 'b\n',
    'tests/a.test.js': 'test\n',
    'tests/b.test.js': 'test\n',
  })
);
assert.strictEqual(withTests.tests, 2, '테스트 파일을 경로로 알아본다');
assert.deepStrictEqual(withTests.rank.gates, [], '테스트가 있으면 상한 없음');
assert.ok(withTests.rank.tier > noTests.rank.tier, '테스트가 계급을 올린다');

// ── 거대 파일 = 무게가 오르고 용사 게이트가 걸린다 ────────────────
const heavy = evaluate(
  makeProject({
    'README.md': '# hi\n',
    'package.json': '{}\n',
    'LICENSE': 'MIT\n',
    'docs/guide.md': 'x\n',
    '.github/workflows/ci.yml': 'on: push\n',
    'src/fat1.js': HEAVY_BYTES + 10,
    'src/fat2.js': HEAVY_BYTES + 10,
    'src/fat3.js': HEAVY_BYTES + 10,
    'src/fat4.js': HEAVY_BYTES + 10,
    'src/fat5.js': HEAVY_BYTES + 10,
    // 테스트 비율까지 채워 점수를 성기사 구간(75+)으로 올린다.
    // 그래야 "장비 과중" 게이트가 실제로 상한을 누르는지 볼 수 있다.
    'tests/a.test.js': 'test\n',
    'tests/b.test.js': 'test\n',
  })
);
assert.ok(heavy.rank.score >= 75, '게이트가 없었다면 성기사 이상이었을 점수');
assert.strictEqual(heavy.heavyCount, 5, '32KB 이상을 거대 파일로 센다');
assert.ok(heavy.weight.index >= 35, '거대 파일 5개면 최소 무거움');
assert.ok(['무거움', '과적재'].includes(weightName(heavy)));
assert.ok(heavy.rank.tier <= 4, '짐을 진 채로는 기사(4)를 못 넘는다');
assert.ok(heavy.rank.gates.includes('장비 과중'));
assert.ok(heavy.heavy[0].bytes >= heavy.heavy[1].bytes, '큰 것부터 보고한다');
assert.ok(heavy.heavy.length <= 3, '가장 무거운 셋까지만 보고한다');

// ── 잠금 파일은 무게에서 뺀다 (안 그러면 전부 과적재) ─────────────
const locked = evaluate(
  makeProject({
    'README.md': '# hi\n',
    'package.json': '{}\n',
    'package-lock.json': HEAVY_BYTES * 20,
    'src/a.js': 'a\n',
  })
);
assert.strictEqual(locked.heavyCount, 0, 'package-lock.json 은 거대 파일로 세지 않는다');
assert.strictEqual(weightName(locked), '가벼움');

// ── 제외 디렉터리 ────────────────────────────────────────────────
const noisy = evaluate(
  makeProject({
    'src/a.js': 'a\n',
    'node_modules/pkg/index.js': HEAVY_BYTES + 10,
    'dist/bundle.js': HEAVY_BYTES + 10,
  })
);
assert.strictEqual(noisy.files, 1, 'node_modules 와 dist 는 세지 않는다');
assert.strictEqual(noisy.heavyCount, 0);

// ── 카드 출력 ────────────────────────────────────────────────────
const text = card(heavy);
assert.ok(text.includes('계급:'), '카드에 계급이 있다');
assert.ok(text.includes('장비 무게:'), '카드에 무게가 있다');
assert.ok(text.includes('fat'), '무거우면 어떤 파일이 무거운지 이름을 댄다');
assert.ok(text.includes('상한: 장비 과중'), '상한 이유가 카드에 보인다');
assert.ok(/[░▒▓█]/.test(text), '기본은 아트 포함');
assert.ok(!/[░▒▓█]/.test(card(heavy, { art: false })), 'art:false 면 아트를 뺀다');
assert.ok(card(empty).includes('TODO 미측정'), 'git 이 아니면 미측정이라고 쓴다');

// ── 영어 카드 ────────────────────────────────────────────────────
const en = card(heavy, { lang: 'en' });
assert.ok(en.includes('Rank: Knight'), '영어면 계급도 영어 이름만');
assert.ok(en.includes('Pack weight:'), '무게 라벨도 영어');
assert.ok(en.includes('capped:'), '상한 라벨도 영어');
assert.ok(card(empty, { lang: 'en' }).includes('TODO not measured'), '미측정도 영어로');

// 알 수 없는 언어는 기본값(ko)으로 떨어진다
assert.strictEqual(card(heavy, { lang: 'fr' }), card(heavy), '모르는 언어는 한국어로');

// ── 표가 서로 어긋나지 않는다 ────────────────────────────────────
assert.strictEqual(RANKS.length, 7);
for (let i = 1; i < RANKS.length; i += 1) {
  assert.ok(RANKS[i].min > RANKS[i - 1].min, '계급 하한선은 단조 증가');
}
for (let i = 1; i < WEIGHTS.length; i += 1) {
  assert.ok(WEIGHTS[i].min > WEIGHTS[i - 1].min, '무게 하한선은 단조 증가');
}

for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
console.log('rpg-scan 점검 통과 ✅');

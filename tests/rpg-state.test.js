#!/usr/bin/env node
// rpg-mode 자체 점검. 프레임워크 없음 — node tests/rpg-state.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// 실제 ~/.claude 를 건드리지 않도록 임시 디렉터리로 격리 (require 전에 설정해야 한다)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-test-'));
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const state = require('../hooks/rpg-state');
const statePath = path.join(tmpDir, '.rpg-state.json');

// ── 레벨 곡선 경계 ──────────────────────────────────────────────
assert.strictEqual(state.levelFor(0), 1, 'XP 0 은 Lv.1');
assert.strictEqual(state.levelFor(99), 1, '99 는 아직 Lv.1');
assert.strictEqual(state.levelFor(100), 2, '100 에서 Lv.2');
assert.strictEqual(state.levelFor(101), 2);
assert.strictEqual(state.levelFor(299), 2, '299 는 아직 Lv.2');
assert.strictEqual(state.levelFor(300), 3, '300 에서 Lv.3');
assert.strictEqual(state.levelFor(599), 3);
assert.strictEqual(state.levelFor(600), 4, '600 에서 Lv.4');

// ── 구간 진행도 ────────────────────────────────────────────────
assert.deepStrictEqual(state.progress(0), { level: 1, into: 0, span: 100 });
assert.deepStrictEqual(state.progress(150), { level: 2, into: 50, span: 200 });
assert.deepStrictEqual(state.progress(300), { level: 3, into: 0, span: 300 });

// ── XP 지급 ────────────────────────────────────────────────────
const base = { mode: 'full', xp: 90, level: 1, streak: 2, updatedAt: null };
const win = state.award(base, { xp: 10, success: true });
assert.strictEqual(win.state.xp, 100);
assert.strictEqual(win.state.streak, 3, '성공은 연속 카운트를 올린다');
assert.strictEqual(win.leveledUp, true, '90 + 10 은 레벨업');
assert.strictEqual(win.from, 1);
assert.strictEqual(base.xp, 90, '입력 객체는 변형되지 않는다');

const loss = state.award(base, { xp: 0, success: false });
assert.strictEqual(loss.state.xp, 90, '실패는 감점하지 않는다');
assert.strictEqual(loss.state.streak, 0, '실패는 연속을 끊는다');
assert.strictEqual(loss.leveledUp, false);

// ── 깨진 상태 파일 복구 ────────────────────────────────────────
fs.writeFileSync(statePath, '{ 이건 JSON 이 아니다', 'utf8');
assert.deepStrictEqual(state.read(), {
  mode: 'full', xp: 0, level: 1, streak: 0, progress: { into: 0, span: 100 },
  projects: {}, updatedAt: null,
});

fs.writeFileSync(statePath, JSON.stringify({ mode: '이상한모드', xp: 300, level: 99, streak: -5 }));
const repaired = state.read();
assert.strictEqual(repaired.mode, 'full', '알 수 없는 모드는 기본값으로');
assert.strictEqual(repaired.level, 3, '저장된 level 은 무시하고 xp 에서 재계산');
assert.strictEqual(repaired.streak, 0, '음수 연속은 0 으로');

// ── 저장 후 다시 읽기 ──────────────────────────────────────────
const saved = state.write({ mode: 'lite', xp: 420, streak: 4 });
assert.ok(saved.updatedAt && !Number.isNaN(Date.parse(saved.updatedAt)), 'updatedAt 은 ISO 시각');
const reloaded = state.read();
assert.strictEqual(reloaded.mode, 'lite');
assert.strictEqual(reloaded.xp, 420);
assert.strictEqual(reloaded.level, 3);
assert.deepStrictEqual(reloaded.progress, { into: 120, span: 300 }, 'statusline 이 쓸 파생값도 저장된다');

// ── 프로젝트 계급 기록 ─────────────────────────────────────────
const noted = state.withProject({ mode: 'full', xp: 0 }, 'C:/proj/a', { rank: 3, weight: 1 });
assert.deepStrictEqual(
  { rank: noted.projects['C:/proj/a'].rank, weight: noted.projects['C:/proj/a'].weight },
  { rank: 3, weight: 1 }
);
assert.ok(!Number.isNaN(Date.parse(noted.projects['C:/proj/a'].at)), 'at 은 ISO 시각');

const bumped = state.withProject(noted, 'C:/proj/a', { rank: 4, weight: 0 });
assert.strictEqual(bumped.projects['C:/proj/a'].rank, 4, '같은 경로는 덮어쓴다');
assert.strictEqual(Object.keys(bumped.projects).length, 1);

// 형식이 어긋난 항목은 버린다
const dirty = state.write({
  mode: 'full',
  xp: 0,
  projects: {
    'C:/good': { rank: 2, weight: 1, at: '2026-01-01T00:00:00.000Z' },
    'C:/bad-rank': { rank: 'high', weight: 1 },
    'C:/bad-shape': 'nope',
  },
});
assert.deepStrictEqual(Object.keys(dirty.projects), ['C:/good'], '깨진 항목은 버린다');

// 20개를 넘으면 최근 것만 남긴다
let many = { mode: 'full', xp: 0, projects: {} };
for (let i = 0; i < 25; i += 1) {
  many.projects['C:/p' + i] = {
    rank: 1, weight: 0, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  };
}
const pruned = state.write(many);
assert.strictEqual(Object.keys(pruned.projects).length, state.MAX_PROJECTS, '20개로 정리');
assert.ok(pruned.projects['C:/p24'], '가장 최근 것은 남는다');
assert.ok(!pruned.projects['C:/p0'], '가장 오래된 것은 버려진다');

// ── XP hook 통합: 실제 프로세스에 PostToolUse 페이로드를 흘려본다 ──
const hook = path.join(__dirname, '..', 'hooks', 'rpg-xp.js');
const env = { ...process.env, CLAUDE_CONFIG_DIR: tmpDir };
const runHook = (payload) =>
  execFileSync(process.execPath, [hook], { input: JSON.stringify(payload), env, encoding: 'utf8' });

state.write({ mode: 'full', xp: 0, streak: 0 });

runHook({ tool_name: 'Edit', tool_input: { file_path: 'a.ts' }, tool_response: { filePath: 'a.ts' } });
assert.strictEqual(state.read().xp, 10, '편집 성공은 +10');

runHook({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } });
assert.strictEqual(state.read().xp, 35, '테스트 통과는 +25');

runHook({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, tool_response: { stdout: '1 file' } });
assert.strictEqual(state.read().xp, 85, '커밋은 +50');
assert.strictEqual(state.read().streak, 3);

runHook({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { is_error: true, stdout: '2 failed' } });
const afterFail = state.read();
assert.strictEqual(afterFail.xp, 85, '실패한 테스트는 XP 를 주지 않는다');
assert.strictEqual(afterFail.streak, 0, '실패는 연속을 끊는다');

runHook({ tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: 'a b' } });
assert.strictEqual(state.read().xp, 85, '평범한 명령은 XP 없음');

const levelUpOut = runHook({
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m y' },
  tool_response: { stdout: 'ok' },
});
assert.ok(/LEVEL UP/.test(levelUpOut), '레벨업 시 컨텍스트로 알린다');
assert.strictEqual(state.read().level, 2);

// off 모드에서는 아무것도 하지 않는다
state.write({ mode: 'off', xp: 135, streak: 0 });
runHook({ tool_name: 'Edit', tool_input: {}, tool_response: {} });
assert.strictEqual(state.read().xp, 135, 'off 모드는 XP 를 주지 않는다');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('모든 점검 통과 ✅');

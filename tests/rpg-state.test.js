#!/usr/bin/env node
// rpg-mode 자체 점검. 프레임워크 없음 — node tests/rpg-state.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
  mode: 'full', lang: 'ko', xp: 0, level: 1, streak: 0, progress: { into: 0, span: 100 },
  projects: {}, session: null, lastSession: null, updatedAt: null,
});

fs.writeFileSync(statePath, JSON.stringify({ mode: '이상한모드', xp: 300, level: 99, streak: -5 }));
const repaired = state.read();
assert.strictEqual(repaired.mode, 'full', '알 수 없는 모드는 기본값으로');
assert.strictEqual(state.read().lang, 'ko', '언어가 없으면 기본값 ko');
assert.strictEqual(state.write({ mode: 'full', xp: 0, lang: 'fr' }).lang, 'ko', '모르는 언어는 버린다');
assert.strictEqual(state.write({ mode: 'full', xp: 0, lang: 'en' }).lang, 'en', '아는 언어는 남긴다');
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

// ── 세션 기준선과 요약 ─────────────────────────────────────────
const opened = state.startSession({ mode: 'full', xp: 120, streak: 2 });
assert.strictEqual(opened.session.startXp, 120, '기준선은 현재 XP');
assert.strictEqual(opened.session.startLevel, 2, 'startLevel 은 startXp 에서 재계산');
assert.ok(!Number.isNaN(Date.parse(opened.session.startedAt)), 'startedAt 은 ISO 시각');

const closed = state.endSession({ ...opened, xp: 320, streak: 6 });
assert.strictEqual(closed.session, null, '닫으면 기준선을 비운다');
assert.deepStrictEqual(
  {
    gained: closed.lastSession.gained,
    from: closed.lastSession.fromLevel,
    to: closed.lastSession.toLevel,
  },
  { gained: 200, from: 2, to: 3 },
  '획득량과 레벨 변화를 기록한다'
);
assert.strictEqual(closed.lastSession.streak, 6);

// 아무것도 못 번 세션은 기록을 남기지 않는다 — 지어낸 축하 금지
const quiet = state.endSession({ ...opened, xp: 120 });
assert.strictEqual(quiet.lastSession, null, '획득 0 이면 lastSession 없음');
assert.strictEqual(quiet.session, null);

// 기준선 없이 닫아도 터지지 않는다 (상태 파일이 막 생긴 경우)
assert.strictEqual(state.endSession({ mode: 'full', xp: 50 }).lastSession, null);

// 깨진 값은 버린다
const junk = state.write({
  mode: 'full',
  xp: 0,
  session: { startXp: '많이' },
  lastSession: { gained: -5 },
});
assert.strictEqual(junk.session, null, '숫자가 아닌 기준선은 버린다');
assert.strictEqual(junk.lastSession, null, '음수 획득은 버린다');

// 입력 변형 없음
const src = { mode: 'full', xp: 10, streak: 1 };
state.startSession(src);
state.endSession(src);
assert.deepStrictEqual(src, { mode: 'full', xp: 10, streak: 1 }, '입력 객체는 변형되지 않는다');

// ── statusline 세그먼트 ────────────────────────────────────────
const { rpgSegment } = require('../hooks/rpg-statusline');

state.write({ mode: 'full', xp: 420, streak: 4 });
assert.strictEqual(
  rpgSegment({ plain: true }),
  'Lv.3 ███░░░░░ 120/300 *4',
  '저장된 progress 를 그대로 쓴다 — 레벨 공식을 다시 구현하지 않는다'
);
assert.ok(/\x1b\[/.test(rpgSegment()), '기본은 ANSI 색을 넣는다');

state.write({ mode: 'full', xp: 0, streak: 1 });
assert.strictEqual(rpgSegment({ plain: true }), 'Lv.1 ░░░░░░░░ 0/100', '연속 1 은 표시하지 않는다');

state.write({ mode: 'off', xp: 420, streak: 4 });
assert.strictEqual(rpgSegment(), null, 'off 면 아무것도 그리지 않는다');

fs.writeFileSync(statePath, '깨진 파일', 'utf8');
assert.strictEqual(rpgSegment(), null, '상태 파일이 깨져도 statusline 을 죽이지 않는다');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('모든 점검 통과 ✅');

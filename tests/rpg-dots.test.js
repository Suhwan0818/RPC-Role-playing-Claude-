#!/usr/bin/env node
// rpg-dots 자체 점검. 프레임워크 없음 — node tests/rpg-dots.test.js
//
// 막대 길이는 측정값에서만 나온다. 범위를 벗어난 값이 폭보다 긴 막대가 되면
// 그건 지어낸 수치와 같다 — 경계값을 여기서 붙잡는다.

const assert = require('assert');
const { meter, progressMeter, spark, BOSS_ART, FULL, EMPTY, LEVELS, METER_WIDTH } =
  require('../hooks/rpg-dots');

// ── 막대 ─────────────────────────────────────────────────────────
assert.strictEqual(meter(0), EMPTY.repeat(METER_WIDTH), '0 은 빈 막대');
assert.strictEqual(meter(1), FULL.repeat(METER_WIDTH), '1 은 꽉 찬 막대');
assert.strictEqual(meter(0.5), '████░░░░');
assert.strictEqual(meter(0.4), '███░░░░░', 'statusline 이 기대하는 반올림 (120/300)');
assert.strictEqual(meter(1.5), FULL.repeat(METER_WIDTH), '1 을 넘겨도 폭을 넘지 않는다');
assert.strictEqual(meter(-1), EMPTY.repeat(METER_WIDTH), '음수는 빈 막대');
assert.strictEqual(meter(NaN), EMPTY.repeat(METER_WIDTH), '숫자가 아니면 빈 막대');
assert.strictEqual(meter(undefined), EMPTY.repeat(METER_WIDTH));
assert.strictEqual(meter(0.5, 4).length, 4, '폭을 바꿀 수 있다');

for (const ratio of [0, 0.01, 0.33, 0.5, 0.99, 1, 2]) {
  assert.strictEqual(meter(ratio).length, METER_WIDTH, ratio + ' 도 폭이 일정하다');
}

// ── have/need 막대 ───────────────────────────────────────────────
assert.strictEqual(progressMeter(10, 100), '█░░░░░░░');
assert.strictEqual(progressMeter(7, 10), '██████░░');
assert.strictEqual(progressMeter(1, 0), EMPTY.repeat(METER_WIDTH), 'need 0 은 빈 막대 (0 으로 나누지 않는다)');
assert.strictEqual(progressMeter(200, 100), FULL.repeat(METER_WIDTH), '넘겨도 꽉 찬 막대까지');

// ── 스파크라인 ───────────────────────────────────────────────────
assert.strictEqual(spark([]), '', '값이 없으면 한 칸도 그리지 않는다');
assert.strictEqual(spark('array 아님'), '');
assert.strictEqual(spark([0, 0, 0]), LEVELS[0].repeat(3), '전부 0 이면 가장 낮은 칸');
assert.strictEqual(spark([25]), FULL, '하나뿐이면 그게 최고점');

const line = spark([10, 0, 25, 50]);
assert.strictEqual(line.length, 4, '값 하나당 한 칸');
assert.strictEqual(line[3], FULL, '가장 큰 값이 꽉 찬 칸');
assert.strictEqual(line[1], LEVELS[0], '0 은 가장 낮은 칸 — 실패를 빈칸으로 지우지 않는다');
assert.ok(LEVELS.indexOf(line[0]) < LEVELS.indexOf(line[2]), '작은 값이 더 낮다');
assert.ok(spark([1, 2]).split('').every((c) => LEVELS.includes(c)), '블록 문자만 쓴다');

// ── 보스 스프라이트 ──────────────────────────────────────────────
assert.strictEqual(BOSS_ART.length, 3, '세 줄');
assert.ok(BOSS_ART.every((row) => row.length === BOSS_ART[0].length), '줄 폭이 같아야 어긋나지 않는다');
assert.ok(
  BOSS_ART.every((row) => /^[░▒▓█▄▀]+$/.test(row)),
  '폭이 애매한 문자는 터미널에서 깨진다 — 블록 문자만'
);

console.log('rpg-dots 점검 통과 ✅');

#!/usr/bin/env node
// rpg-mode — 도트 그래픽. 막대 · 스파크라인 · 보스 스프라이트.
//
//   require('./rpg-dots') → { meter, spark, BOSS_ART, ... }
//
// 표시 전용 모듈이다. 의존이 없으므로 statusline(매 렌더마다 도는 경로)도 안심하고 쓴다.
// 폭이 애매한 문자는 터미널에서 깨진다 — Block Elements 범위만 쓴다 (ART 와 같은 규칙).
//
// 막대 길이는 측정값에서만 나온다. 비율이 없으면 빈 막대다 — 그려 넣지 않는다.

const FULL = '█';
const EMPTY = '░';
const METER_WIDTH = 8;

// 스파크라인 높이 8단. 0 은 가장 낮은 칸으로 둔다 — 빈칸은 실패를 지워버린다.
const LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * 0-1 비율 → 막대. 범위를 벗어난 값은 잘라낸다 (폭보다 긴 막대는 거짓말이다).
 * @param {number} ratio
 * @param {number} [width]
 */
function meter(ratio, width = METER_WIDTH) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * width);
  return FULL.repeat(filled) + EMPTY.repeat(Math.max(0, width - filled));
}

/** have/need 막대. need 가 0 이하면 빈 막대. */
function progressMeter(have, need, width = METER_WIDTH) {
  return meter(need > 0 ? have / need : 0, width);
}

/**
 * 값 배열 → 스파크라인. 가장 큰 값이 █ 이 되도록 상대 높이로 그린다.
 * 값이 없으면 빈 문자열 — 한 칸이라도 지어내지 않는다.
 */
function spark(values) {
  const nums = (Array.isArray(values) ? values : []).map((v) =>
    Number.isFinite(v) && v > 0 ? v : 0
  );
  if (!nums.length) return '';
  const max = Math.max(...nums);
  if (max === 0) return LEVELS[0].repeat(nums.length);
  const top = LEVELS.length - 1;
  return nums
    .map((v) => (v === 0 ? LEVELS[0] : LEVELS[Math.max(1, Math.round((v / max) * top))]))
    .join('');
}

// 보스 스프라이트. 살아 있는 보스가 있을 때만 그린다 (계급 아트와 같은 규칙: 한 번만).
const BOSS_ART = Object.freeze(['░▄███▄░', '▓█▒█▒█▓', '░▀█▀█▀░']);

module.exports = { meter, progressMeter, spark, BOSS_ART, FULL, EMPTY, LEVELS, METER_WIDTH };

#!/usr/bin/env node
// rpg-mode — statusline 세그먼트. 모듈이자 CLI.
//
//   require('./rpg-statusline')   → { rpgSegment }
//   node rpg-statusline.js        stdin 의 statusline JSON 을 읽고 세그먼트 한 줄 출력
//
// 표시 예: Lv.3 ███░░░░░ 120/300 *4
//
// 상태 파일이 없거나 mode 가 off 면 빈 값이다. statusline 이 이것 때문에 죽으면 안 된다.

const fs = require('fs');
const path = require('path');
const os = require('os');

const BAR_WIDTH = 8;
const LEVEL_COLOR = 213; // 분홍
const STREAK_COLOR = 208; // 주황

const ESC = '\x1b';
const reset = `${ESC}[0m`;
const dim = (s) => `${ESC}[38;5;244m${s}${reset}`;
const color = (s, code) => `${ESC}[38;5;${code}m${s}${reset}`;

function filledCount(pct) {
  return Math.round((pct / 100) * BAR_WIDTH);
}

function bar(pct, code) {
  const filled = filledCount(pct);
  return color('█'.repeat(filled), code) + dim('░'.repeat(BAR_WIDTH - filled));
}

/**
 * RPG 세그먼트 문자열. 상태가 없거나 off 면 null.
 *
 * rpg-state 를 require 하지 않고 상태 파일을 직접 읽는다 — statusline 은 매 렌더마다 돌아
 * 의존성을 최소로 두는 편이 낫고, 저장된 progress 를 그대로 쓰므로 레벨 공식을 다시
 * 구현할 일도 없다 (progress 를 상태에 저장하는 이유가 이것이다).
 *
 * @param {{ plain?: boolean }} [options] plain 이면 ANSI 색을 빼고 돌려준다
 * @returns {string|null}
 */
function rpgSegment({ plain = false } = {}) {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const st = JSON.parse(fs.readFileSync(path.join(dir, '.rpg-state.json'), 'utf8'));
    if (!st || st.mode === 'off') return null;

    const into = (st.progress && st.progress.into) || 0;
    const span = (st.progress && st.progress.span) || 100;
    const pct = Math.min(100, Math.round((into / span) * 100));
    const level = st.level || 1;
    const streak = st.streak > 1 ? '*' + st.streak : '';

    if (plain) {
      const filled = filledCount(pct);
      const meter = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
      return `Lv.${level} ${meter} ${into}/${span}${streak ? ' ' + streak : ''}`;
    }

    return (
      color('Lv.' + level, LEVEL_COLOR) +
      ' ' + bar(pct, LEVEL_COLOR) +
      ' ' + dim(into + '/' + span) +
      (streak ? ' ' + color(streak, STREAK_COLOR) : '')
    );
  } catch (e) {
    return null; // 상태 파일 문제로 statusline 이 죽으면 안 된다
  }
}

module.exports = { rpgSegment };

// ── CLI ──────────────────────────────────────────────────────────────
// statusline 이 아직 없는 사람용. settings.json 의 statusLine.command 에 바로 걸 수 있다.
// stdin 의 JSON 은 쓰지 않지만, 읽지 않으면 파이프가 안 닫힌다.
if (require.main === module) {
  const plain = process.argv.includes('--plain');
  const emit = () => process.stdout.write(rpgSegment({ plain }) || '');
  process.stdin.resume();
  process.stdin.on('data', () => {});
  process.stdin.on('end', emit);
  process.stdin.on('error', emit);
}

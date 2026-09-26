#!/usr/bin/env node
// rpg-mode — PostToolUse XP 지급 hook.
//
// 실제로 일어난 일에만 XP 를 준다. 지어낸 수치는 없다.
// 점수표·보스·업적 규칙은 rpg-progress.js 에, 상태 전이는 rpg-state.applyEvent 에 있다.
// 이 파일이 하는 일은 입출력뿐이다 — 규칙을 여기 베껴두지 않는다.

const { read, write, applyEvent, progress } = require('./rpg-state');
const { signalFor, achievementName } = require('./rpg-progress');
const { t } = require('./rpg-text');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.exit(0); // 입력이 이상하면 조용히 빠진다
  }

  const state = read();
  if (state.mode === 'off') process.exit(0);

  const tool = payload.tool_name || '';
  const cmd = String((payload.tool_input || {}).command || '');
  const ok = succeeded(payload.tool_response);

  // 점수 신호도 없고 실패도 아니면 파일을 건드리지 않는다. 디스크 낭비 금지.
  if (ok && !signalFor(tool, cmd)) process.exit(0);

  const result = applyEvent(state, { tool, cmd, ok });
  write(result.state);

  // 알릴 것이 있을 때만 컨텍스트에 넣는다. 매 도구마다 알리면 소음이다.
  const notes = [];
  if (result.slain) {
    notes.push(t(state.lang, 'bossSlain', result.slain.cmd, result.slain.attempt, result.slain.bonus));
  }
  if (result.leveledUp) {
    notes.push(t(state.lang, 'levelUp', result.from, progress(result.state.xp).level, result.state.xp));
  }
  if (result.unlocked.length) {
    const names = result.unlocked.map((id) => achievementName(state.lang, id)).join(', ');
    notes.push(t(state.lang, 'achUnlock', names));
  }

  if (notes.length) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: notes.join(' '),
        },
      })
    );
  }
});

/**
 * 도구 실행이 성공했는지 판정.
 *
 * Bash 가 실패하면 tool_response 는 `"Error: Exit code 1\n…"` 문자열로 온다 (객체가 아니다).
 * 성공한 Bash 는 `{ stdout, stderr, isImage, interrupted }` 객체이고 종료 코드가 없다 —
 * 그래서 문자열 앞머리의 Error 를 먼저 본다.
 * ponytail: 정확한 코드가 필요해지면 그때 도구별 분기를 추가한다.
 */
function succeeded(response) {
  if (response == null) return true;
  if (typeof response === 'string') return !/^error/i.test(response.trim());
  if (typeof response !== 'object') return true;

  for (const key of ['exit_code', 'exitCode', 'returnCode']) {
    if (Number.isFinite(response[key])) return response[key] === 0;
  }
  if (response.is_error === true || response.isError === true) return false;
  if (response.error) return false;
  if (response.interrupted === true) return false;
  return true;
}

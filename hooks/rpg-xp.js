#!/usr/bin/env node
// rpg-mode — PostToolUse XP 지급 hook.
// 실제로 일어난 일에만 XP 를 준다. 지어낸 수치는 없다.

const { read, write, award, progress } = require('./rpg-state');

const XP_EDIT = 10; // 파일 편집 성공
const XP_TEST = 25; // 테스트 통과
const XP_COMMIT = 50; // 커밋 성공

const TEST_CMD = /\b(pytest|jest|vitest|npm (run )?test|pnpm test|yarn test|go test|cargo test|mvn test|gradle test)\b/;
const COMMIT_CMD = /\bgit\s+commit\b/;

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
  const input = payload.tool_input || {};
  const response = payload.tool_response;

  const ok = succeeded(response);
  let xp = 0;

  if (/^(Edit|Write|MultiEdit)$/.test(tool)) {
    if (ok) xp = XP_EDIT;
  } else if (tool === 'Bash') {
    const cmd = String(input.command || '');
    if (ok && COMMIT_CMD.test(cmd)) xp = XP_COMMIT;
    else if (ok && TEST_CMD.test(cmd)) xp = XP_TEST;
  }

  // XP 도 없고 연속 카운트도 안 변하면 파일을 건드리지 않는다.
  if (xp === 0 && ok) process.exit(0);

  const result = award(state, { xp, success: ok });
  write(result.state);

  // 레벨업일 때만 컨텍스트에 알린다. 매 도구마다 알리면 소음이다.
  if (result.leveledUp) {
    const p = progress(result.state.xp);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `⬆ LEVEL UP — Lv.${result.from} → Lv.${p.level} (누적 XP ${result.state.xp}). ` +
            '이번 응답 끝에 한 줄로 알릴 것.',
        },
      })
    );
  }
});

/**
 * 도구 실행이 성공했는지 판정.
 * ponytail: PostToolUse 페이로드에 종료 코드가 항상 있지는 않다 — 있으면 쓰고,
 * 없으면 에러 필드를 본다. 정확한 코드가 필요해지면 그때 도구별 분기 추가.
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

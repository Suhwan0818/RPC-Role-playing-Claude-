#!/usr/bin/env node
// rpg-xp hook 자체 점검. 프레임워크 없음 — node tests/rpg-xp.test.js
//
// 실제 프로세스를 띄워 PostToolUse 페이로드를 stdin 으로 흘려본다.
// 훅의 계약(입력 JSON → 상태 변화 → 레벨업 stdout)을 그대로 검증한다.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// 실제 ~/.claude 를 건드리지 않도록 임시 디렉터리로 격리 (require 전에 설정해야 한다)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-xp-test-'));
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const state = require('../hooks/rpg-state');

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


// ── 확장 XP 신호: 성공하면 주고, 실패하면 안 준다 ─────────────────
const signals = [
  ['cargo clippy', 10, 'lint'],
  ['npm run build', 15, '빌드'],
  ['git push -u origin main', 20, '푸시'],
  ['gh pr create --fill', 40, 'PR 생성'],
];

for (const [cmd, expected, label] of signals) {
  state.write({ mode: 'full', xp: 0, streak: 0 });
  runHook({ tool_name: 'Bash', tool_input: { command: cmd }, tool_response: { stdout: 'ok' } });
  assert.strictEqual(state.read().xp, expected, `${label} 성공은 +${expected}`);

  runHook({
    tool_name: 'Bash',
    tool_input: { command: cmd },
    tool_response: { is_error: true, stdout: 'failed' },
  });
  const after = state.read();
  assert.strictEqual(after.xp, expected, `${label} 실패는 XP 를 주지 않는다`);
  assert.strictEqual(after.streak, 0, `${label} 실패는 연속을 끊는다`);
}

// 순서 규칙: npm run build 가 테스트 패턴에 먼저 걸리면 안 된다
state.write({ mode: 'full', xp: 0, streak: 0 });
runHook({ tool_name: 'Bash', tool_input: { command: 'npm run build' }, tool_response: { stdout: 'ok' } });
assert.strictEqual(state.read().xp, 15, 'npm run build 는 빌드(15)지 테스트(25)가 아니다');

// ── SessionEnd 훅: 실제 프로세스로 세션을 닫아본다 ────────────────
const summaryHook = path.join(__dirname, '..', 'hooks', 'rpg-summary.js');
const runSummary = () =>
  execFileSync(process.execPath, [summaryHook], { input: '{}', env, encoding: 'utf8' });

state.write({ ...state.startSession({ mode: 'full', xp: 120 }), xp: 320, streak: 6 });
runSummary();
const summarized = state.read();
assert.strictEqual(summarized.session, null, '세션을 닫으면 기준선이 비워진다');
assert.strictEqual(summarized.lastSession.gained, 200, '기준선 이후 번 XP 를 기록한다');
assert.strictEqual(summarized.lastSession.toLevel, 3);

// 아무것도 못 번 세션은 기록을 남기지 않는다
state.write(state.startSession({ mode: 'full', xp: 320 }));
runSummary();
assert.strictEqual(state.read().lastSession, null, '획득 0 이면 기록 없음');

// off 모드에서는 아무것도 하지 않는다
state.write({ mode: 'off', xp: 320, session: { startXp: 100 } });
runSummary();
assert.ok(state.read().session, 'off 모드는 세션을 닫지 않는다');


// ── 보스전: 같은 명령을 3번 깨뜨린 뒤 통과하면 격파다 ──────────────
const NL = String.fromCharCode(10);
state.write({ mode: 'full', xp: 0, streak: 0 });
for (let i = 0; i < 3; i += 1) {
  runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pytest -q' },
    tool_response: 'Error: Exit code 1' + NL + 'FAILED tests/x.py',
  });
}
const fighting = state.read();
assert.strictEqual(fighting.boss.fails, 3, '같은 명령의 연속 실패를 보스로 센다');
assert.strictEqual(fighting.xp, 0, '실패에는 XP 가 없다');
assert.strictEqual(fighting.counts.fail, 3, '실패 횟수도 센다');
assert.strictEqual(fighting.streak, 0, '실패는 연속을 끊는다');

const slainOut = runHook({
  tool_name: 'Bash',
  tool_input: { command: 'pytest -q' },
  tool_response: { stdout: '3 passed' },
});
const won = state.read();
assert.ok(/보스 격파/.test(slainOut), '격파를 컨텍스트로 알린다');
assert.ok(/4번째 시도/.test(slainOut), '시도 횟수는 실제 실패 + 1');
assert.strictEqual(won.xp, 40, '테스트 25 + 보너스 15');
assert.strictEqual(won.boss, null, '격파한 보스는 사라진다');
assert.strictEqual(won.counts.bossSlain, 1);
assert.ok(won.achievements.includes('boss-slayer'), '업적도 함께 해금된다');
assert.ok(/업적 해금/.test(slainOut), '해금도 한 번 알린다');

// 전투 기록에 실패 3건과 성공 1건이 남는다 — 실패를 숨기지 않는다
assert.strictEqual(won.log.length, 4);
assert.strictEqual(won.log.filter((e) => !e.ok).length, 3);
assert.strictEqual(won.log[3].xp, 40, '보너스까지 합친 값을 기록한다');

// 실패한 Bash 는 문자열 "Error: Exit code 1" 로 온다 (실제 트랜스크립트에서 확인한 형태)
state.write({ mode: 'full', xp: 0, streak: 5 });
runHook({
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  tool_response: 'Error: Exit code 1' + NL + '2 failed',
});
assert.strictEqual(state.read().xp, 0, '실패 문자열은 XP 를 주지 않는다');
assert.strictEqual(state.read().streak, 0);

// heredoc 본문에 적힌 명령어는 XP 를 주지 않는다 — 언급은 실행이 아니다
state.write({ mode: 'full', xp: 0, streak: 0 });
runHook({
  tool_name: 'Bash',
  tool_input: { command: ['cat > a.md <<EOF', 'git commit -m x', 'EOF'].join(NL) },
  tool_response: { stdout: '' },
});
assert.strictEqual(state.read().xp, 0, '본문의 언급은 커밋이 아니다');
assert.strictEqual(state.read().log.length, 0, '기록도 남지 않는다');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('rpg-xp 점검 통과 ✅');

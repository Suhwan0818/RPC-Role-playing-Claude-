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


fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('rpg-xp 점검 통과 ✅');

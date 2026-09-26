#!/usr/bin/env node
// rpg-progress 자체 점검. 프레임워크 없음 — node tests/rpg-progress.test.js
//
// 게임 규칙의 경계값만 본다. 상태 저장은 rpg-state.test.js, 훅 통합은 rpg-xp.test.js.

const assert = require('assert');
const {
  signalFor, commandText, bossKey, bossBonus, nextBoss, appendLog, bumpCounts,
  unlockedIds, newlyUnlocked, achievementName,
  normalizeCounts, normalizeAchievements, normalizeBoss, normalizeLog,
  ACHIEVEMENTS, MAX_LOG, MAX_CMD, BOSS_THRESHOLD, BOSS_BONUS_CAP, BOSS_TTL_MS,
} = require('../hooks/rpg-progress');

// ── 신호표: 순서가 규칙이다 ──────────────────────────────────────
assert.strictEqual(signalFor('Bash', 'npm run build').name, 'build', 'build 가 test 보다 먼저');
assert.strictEqual(signalFor('Bash', 'npm run build').xp, 15);
assert.strictEqual(signalFor('Bash', 'npm test').name, 'test');
assert.strictEqual(signalFor('Bash', 'git commit -m x').name, 'commit');
assert.strictEqual(signalFor('Bash', 'git push -u origin main').name, 'push');
assert.strictEqual(signalFor('Bash', 'gh pr create --fill').name, 'pr');
assert.strictEqual(signalFor('Bash', 'cargo clippy').name, 'lint');
assert.strictEqual(signalFor('Edit', undefined).name, 'edit', '편집은 명령어가 없어도 신호다');
assert.strictEqual(signalFor('Write', undefined).name, 'edit');
assert.strictEqual(signalFor('Bash', 'ls -la'), null, '평범한 명령은 신호가 아니다');
assert.strictEqual(signalFor('Read', 'npm test'), null, 'Bash 가 아니면 명령어를 보지 않는다');
assert.strictEqual(signalFor(undefined, undefined), null);

// ── 보스 이름 ────────────────────────────────────────────────────
assert.strictEqual(bossKey('  npm   test  '), 'npm test', '공백 차이는 접는다');
assert.strictEqual(bossKey(''), null);
assert.strictEqual(bossKey('x'.repeat(MAX_CMD + 50)).length, MAX_CMD, '이름 길이 상한');

// ── 보너스 ───────────────────────────────────────────────────────
assert.strictEqual(bossBonus(3), 15, '3회 실패 → 15');
assert.strictEqual(bossBonus(100), BOSS_BONUS_CAP, '상한을 넘지 않는다');
assert.strictEqual(bossBonus(-1), 0);

// ── 보스 수명주기 ────────────────────────────────────────────────
const fail = (boss, key) => nextBoss(boss, { key, ok: false, scored: true });
const pass = (boss, key) => nextBoss(boss, { key, ok: true, scored: true });

let b = fail(null, 'npm test').boss;
assert.strictEqual(b.fails, 1);
b = fail(b, 'npm test').boss;
b = fail(b, 'npm test').boss;
assert.strictEqual(b.fails, BOSS_THRESHOLD, '같은 명령의 연속 실패를 센다');

const slainRun = pass(b, 'npm test');
assert.strictEqual(slainRun.boss, null, '격파하면 보스가 사라진다');
assert.deepStrictEqual(
  { fails: slainRun.slain.fails, attempt: slainRun.slain.attempt, bonus: slainRun.slain.bonus },
  { fails: 3, attempt: 4, bonus: 15 },
  '시도 횟수는 실패 + 1 이고 보너스는 실패 × 5'
);

// 문턱 아래는 조용히 해제된다 — 한두 번 실패한 걸 보스로 부르지 않는다
const shallow = pass(fail(null, 'npm test').boss, 'npm test');
assert.strictEqual(shallow.slain, null, '실패 1회는 격파가 아니다');
assert.strictEqual(shallow.boss, null, '그래도 보스는 해제한다');

// 다른 명령이 실패하면 보스가 교체된다
const swapped = fail(b, 'cargo test').boss;
assert.strictEqual(swapped.cmd, 'cargo test');
assert.strictEqual(swapped.fails, 1);

// 다른 명령의 성공은 보스를 건드리지 않는다 — 아직 전투 중이다
const untouched = pass(b, 'git commit -m x');
assert.strictEqual(untouched.boss.cmd, 'npm test', '다른 명령 성공은 보스를 남긴다');
assert.strictEqual(untouched.slain, null);

// 점수 신호가 아닌 명령은 보스와 무관하다 — 실패한 ls 가 보스가 되면 소음이다
const ignored = nextBoss(b, { key: 'ls', ok: false, scored: false });
assert.strictEqual(ignored.boss.cmd, 'npm test');
assert.strictEqual(ignored.boss.fails, BOSS_THRESHOLD, '횟수도 그대로');

// 하루 지난 보스는 폐기한다 — 좀비 방지
const stale = {
  cmd: 'npm test',
  fails: 5,
  since: new Date(Date.now() - BOSS_TTL_MS - 1000).toISOString(),
};
assert.strictEqual(nextBoss(stale, { key: 'ls', ok: true, scored: false }).boss, null, '낡은 보스는 버린다');
assert.strictEqual(fail(stale, 'npm test').boss.fails, 1, '폐기 후에는 처음부터 다시 센다');
assert.strictEqual(pass(stale, 'npm test').slain, null, '폐기된 보스는 격파할 수 없다');

// 형식이 어긋난 보스는 버린다
assert.strictEqual(normalizeBoss({ cmd: '', fails: 3 }), null);
assert.strictEqual(normalizeBoss({ cmd: 'x', fails: 0 }), null);
assert.strictEqual(normalizeBoss({ cmd: 'x', fails: 'many' }), null);
assert.strictEqual(normalizeBoss({ cmd: 'x', fails: 2 }).fails, 2);

// ── 전투 기록 ────────────────────────────────────────────────────
let log = [];
for (let i = 0; i < MAX_LOG + 7; i += 1) {
  log = appendLog(log, { tool: 'Bash', signal: 'test', xp: i, ok: true });
}
assert.strictEqual(log.length, MAX_LOG, '링 버퍼는 상한을 넘지 않는다');
assert.strictEqual(log[log.length - 1].xp, MAX_LOG + 6, '마지막 것이 최신');
assert.strictEqual(log[0].xp, 7, '오래된 것부터 밀려난다');

const failed = appendLog([], { tool: 'Bash', signal: 'test', xp: 0, ok: false });
assert.strictEqual(failed[0].ok, false, '실패도 남긴다 — 그게 요점이다');
assert.ok(!Number.isNaN(Date.parse(failed[0].at)), 'at 은 ISO 시각');

assert.deepStrictEqual(normalizeLog('array 아님'), []);
assert.deepStrictEqual(normalizeLog([{ tool: '' }, null, 42]), [], '깨진 항목은 버린다');
assert.strictEqual(normalizeLog([{ tool: 'Bash', xp: -5 }])[0].xp, 0, '음수 XP 는 0');

// ── 카운터 ───────────────────────────────────────────────────────
assert.strictEqual(bumpCounts(null, { signal: 'test', ok: true }).test, 1);
assert.strictEqual(bumpCounts(null, { signal: 'test', ok: false }).fail, 1, '실패는 fail 로만 센다');
assert.strictEqual(bumpCounts(null, { signal: 'test', ok: false }).test, 0);
assert.strictEqual(bumpCounts(null, { signal: 'test', ok: true, slain: {} }).bossSlain, 1);
assert.strictEqual(bumpCounts({ test: 2 }, { signal: 'nope', ok: true }).test, 2, '모르는 신호는 무시');
assert.strictEqual(normalizeCounts({ test: -1, bogus: 9 }).test, 0, '음수는 0');
assert.strictEqual(normalizeCounts({ bogus: 9 }).bogus, undefined, '표 밖의 키는 버린다');

// ── 업적: 조건과 진행도가 같은 함수에서 나온다 ────────────────────
const blank = { counts: normalizeCounts(null), best: { streak: 0 }, level: 1, achievements: [] };
assert.deepStrictEqual(unlockedIds(blank), [], '빈 상태에서는 아무것도 해금되지 않는다');

const nine = { ...blank, counts: { ...blank.counts, test: 9 } };
assert.ok(!unlockedIds(nine).includes('test-10'), '9 는 아직 아니다');
const ten = { ...blank, counts: { ...blank.counts, test: 10 } };
assert.ok(unlockedIds(ten).includes('test-10'), '10 에서 해금');

const streaked = { ...blank, best: { streak: 25 } };
assert.ok(unlockedIds(streaked).includes('streak-25'), '최고 연속으로 해금 — 끊겨도 기록은 남는다');

// 이미 기록된 것은 다시 알리지 않는다
assert.deepStrictEqual(newlyUnlocked({ ...ten, achievements: ['test-10'] }), [], '두 번 자랑하지 않는다');
assert.deepStrictEqual(newlyUnlocked(ten), ['test-10']);

assert.strictEqual(achievementName('ko', 'first-blood'), '첫 피');
assert.strictEqual(achievementName('en', 'first-blood'), 'First blood');
assert.strictEqual(achievementName('ko', 'nope'), 'nope', '표 밖의 id 는 id 그대로');

// 업적 표가 스스로 어긋나지 않는다
const ids = ACHIEVEMENTS.map((a) => a.id);
assert.strictEqual(new Set(ids).size, ids.length, 'id 는 중복되지 않는다');
for (const a of ACHIEVEMENTS) {
  assert.ok(a.ko && a.en, a.id + ' 는 두 언어 이름이 있어야 한다');
  const [have, need] = a.at(blank);
  assert.ok(Number.isFinite(have) && need > 0, a.id + ' 의 at() 은 [현재, 목표] 를 준다');
}

assert.deepStrictEqual(normalizeAchievements(['nope', 'first-blood', 'first-blood']), ['first-blood']);
assert.deepStrictEqual(normalizeAchievements('array 아님'), []);


// ── heredoc 본문의 언급은 신호가 아니다 ─────────────────────────
// 문서나 테스트에 명령어를 적었을 뿐인데 XP 가 붙으면 그건 지어낸 수치다.
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const mention = [
  'cat > note.md <<' + Q + 'EOF' + Q,
  'gh pr create --fill',
  'git commit -m nope',
  'EOF',
].join(NL);
assert.strictEqual(signalFor('Bash', mention), null, 'heredoc 본문의 명령어는 세지 않는다');

// heredoc 을 여는 줄의 명령은 진짜다
const realCommit = [
  'git commit -F - <<' + Q + 'MSG' + Q,
  'npm test 얘기를 본문에 써도',
  'MSG',
].join(NL);
assert.strictEqual(signalFor('Bash', realCommit).name, 'commit', '여는 줄의 커밋은 진짜다');

assert.strictEqual(commandText(mention).includes('gh pr'), false);
assert.strictEqual(
  bossKey(mention),
  'cat > note.md <<' + Q + 'EOF' + Q,
  '보스 이름도 본문을 빼고 짓는다'
);
console.log('rpg-progress 점검 통과 ✅');

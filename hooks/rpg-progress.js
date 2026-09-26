#!/usr/bin/env node
// rpg-mode — 게임 규칙 원본. 신호표 · 카운터 · 전투 기록 · 보스 · 업적.
//
//   require('./rpg-progress') → { signalFor, nextBoss, appendLog, ACHIEVEMENTS, ... }
//
// rpg-state.js 는 저장소와 레벨 산식만 담당한다. "무엇이 몇 점인가", "무엇이 업적인가" 는
// 전부 여기 한 곳에 있다 — 규칙을 두 군데 베껴두지 않는다.
// 의존은 한 줄기다: rpg-xp → rpg-state → rpg-progress → rpg-text.
// 여기서 rpg-state 를 require 하지 않는다 (순환 금지). 평범한 상태 객체만 받는다.
//
// 모든 값은 실제로 일어난 일을 센 것이다. 보스의 시도 횟수는 진짜 실패 횟수고,
// 업적은 진짜 카운터다. HP 처럼 측정할 신호가 없는 수치는 만들지 않는다.

const XP = Object.freeze({
  edit: 10, // 파일 편집 성공
  lint: 10, // lint 통과
  build: 15, // 빌드 통과
  push: 20, // 푸시 성공
  test: 25, // 테스트 통과
  pr: 40, // PR 생성
  commit: 50, // 커밋 성공
});

const MAX_LOG = 20; // 전투 기록 링 버퍼 크기. 상태 파일을 무겁게 만들지 않는다
const MAX_CMD = 200; // 보스 이름(명령어) 길이 상한
const BOSS_THRESHOLD = 3; // 이만큼 연속 실패하면 보스로 본다
const BOSS_BONUS_PER_FAIL = 5;
const BOSS_BONUS_CAP = 50;
const BOSS_TTL_MS = 24 * 60 * 60 * 1000; // 하루 지난 보스는 폐기 — 좀비 방지

// Bash 명령 → 신호. 위에서부터 먼저 맞는 것 하나만 쓴다.
// 순서가 규칙이다: git push 를 git commit 과 나란히 두고, 빌드를 테스트보다 앞에 두어야
// `npm run build` 가 테스트 패턴에 잘못 걸리지 않는다.
const BASH_SIGNALS = Object.freeze([
  { name: 'pr', xp: XP.pr, pattern: /\bgh\s+pr\s+create\b/ },
  { name: 'commit', xp: XP.commit, pattern: /\bgit\s+commit\b/ },
  { name: 'push', xp: XP.push, pattern: /\bgit\s+push\b/ },
  {
    name: 'build',
    xp: XP.build,
    pattern:
      /\b(npm run build|pnpm( run)? build|yarn build|tsc|cargo build|go build|mvn package|gradlew? build)\b/,
  },
  {
    name: 'test',
    xp: XP.test,
    pattern:
      /\b(pytest|jest|vitest|npm (run )?test|pnpm test|yarn test|go test|cargo test|mvn test|gradle test)\b/,
  },
  {
    name: 'lint',
    xp: XP.lint,
    pattern: /\b(eslint|ruff|golangci-lint|npm run lint|pnpm( run)? lint|yarn lint|cargo clippy)\b/,
  },
]);

// 상태에 남기는 카운터. 여기 없는 키는 normalize 가 버린다.
const COUNT_KEYS = Object.freeze([
  'edit', 'lint', 'build', 'push', 'test', 'pr', 'commit', 'fail', 'bossSlain',
]);

/**
 * 업적. 조건과 진행도가 한 함수(`at`)에서 나온다 — 해금 판정과 `37/100` 표시가
 * 서로 어긋날 수 없다. 전부 실제 카운터에서 읽는다.
 */
const ACHIEVEMENTS = Object.freeze([
  { id: 'first-blood', ko: '첫 피', en: 'First blood', at: (s) => [s.counts.commit, 1] },
  { id: 'test-10', ko: '검을 벼리다', en: 'Whetstone', at: (s) => [s.counts.test, 10] },
  { id: 'test-100', ko: '백련', en: 'Hundred drills', at: (s) => [s.counts.test, 100] },
  { id: 'clean-build', ko: '정비공', en: 'Mechanic', at: (s) => [s.counts.build, 25] },
  { id: 'commit-50', ko: '기록자', en: 'Chronicler', at: (s) => [s.counts.commit, 50] },
  { id: 'shipper', ko: '출항', en: 'Setting sail', at: (s) => [s.counts.pr, 1] },
  { id: 'streak-25', ko: '무패 25', en: 'Unbeaten 25', at: (s) => [s.best.streak, 25] },
  { id: 'streak-100', ko: '무패 100', en: 'Unbeaten 100', at: (s) => [s.best.streak, 100] },
  { id: 'boss-slayer', ko: '보스 사냥꾼', en: 'Boss slayer', at: (s) => [s.counts.bossSlain, 1] },
  { id: 'boss-5', ko: '해결사', en: 'Fixer', at: (s) => [s.counts.bossSlain, 5] },
  { id: 'level-10', ko: '베테랑', en: 'Veteran', at: (s) => [s.level, 10] },
]);

const ACHIEVEMENT_IDS = Object.freeze(ACHIEVEMENTS.map((a) => a.id));

/**
 * 명령어에서 heredoc 본문을 걷어낸 부분. 신호 판정은 이것만 본다.
 *
 * `cat > f <<'EOF' … gh pr create … EOF` 처럼 본문이 명령어를 **언급**만 해도 신호로 잡혀,
 * 일어나지 않은 PR 에 XP 가 붙었다 (이 저장소를 고치는 중에 실제로 났다).
 * 문서·테스트에 명령어를 적는 일은 흔하므로 이건 지어낸 수치와 같다.
 *
 * heredoc 을 여는 줄은 남긴다 — `git commit -F - <<'MSG'` 는 진짜 커밋이다.
 * ponytail: 셸 파서는 붙이지 않는다. 여러 줄에 걸친 따옴표 문자열은 여전히 새어
 * 들어올 수 있고, 실제로 오탐이 나면 그때 막는다.
 */
function commandText(cmd) {
  const lines = String(cmd || '').split('\n');
  const kept = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue; // heredoc 본문은 명령이 아니다
    }
    kept.push(line);
    const opener = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (opener) terminator = opener[2];
  }
  return kept.join('\n');
}

/** 도구 실행 → 점수 신호. 맞는 게 없으면 null. */
function signalFor(tool, cmd) {
  if (/^(Edit|Write|MultiEdit)$/.test(String(tool || ''))) return { name: 'edit', xp: XP.edit };
  if (tool !== 'Bash') return null;
  const text = commandText(cmd);
  return BASH_SIGNALS.find((s) => s.pattern.test(text)) || null;
}

/** 보스 이름으로 쓸 명령어. 공백 차이로 같은 명령이 다른 보스가 되지 않게 접는다. */
function bossKey(cmd) {
  const s = commandText(cmd).trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, MAX_CMD) : null;
}

function bossBonus(fails) {
  return Math.min(Math.max(0, Math.floor(fails)) * BOSS_BONUS_PER_FAIL, BOSS_BONUS_CAP);
}

/**
 * 보스 상태 전이. 입력을 변형하지 않는다.
 *
 * 점수 신호에 걸리는 명령만 본다 — 실패한 `ls` 가 보스가 되면 소음이다.
 * 같은 명령이 연속 실패하면 횟수가 오르고, 다른 명령이 실패하면 보스가 교체된다.
 * 3회 이상 실패한 보스를 통과시키면 격파다. 그보다 적게 실패한 것은 조용히 해제한다.
 * 다른 명령의 성공은 보스를 건드리지 않는다 — 아직 전투 중이다.
 *
 * @returns {{ boss: object|null, slain: {cmd, fails, attempt, bonus}|null }}
 */
function nextBoss(boss, { key, ok, scored, now = Date.now() } = {}) {
  const fresh =
    boss && boss.cmd && now - Date.parse(boss.since || '') < BOSS_TTL_MS ? boss : null;
  if (!key || !scored) return { boss: fresh, slain: null };

  const same = fresh && fresh.cmd === key ? fresh : null;

  if (!ok) {
    return {
      boss: {
        cmd: key,
        fails: same ? same.fails + 1 : 1,
        since: same ? same.since : new Date(now).toISOString(),
      },
      slain: null,
    };
  }

  if (!same) return { boss: fresh, slain: null };
  return {
    boss: null,
    slain:
      same.fails >= BOSS_THRESHOLD
        ? { cmd: key, fails: same.fails, attempt: same.fails + 1, bonus: bossBonus(same.fails) }
        : null,
  };
}

/** 전투 기록 한 줄 추가. 링 버퍼라 마지막 20건만 남는다. 입력 변형 없음. */
function appendLog(log, { tool, signal, xp, ok, at } = {}) {
  const entry = {
    at: typeof at === 'string' ? at : new Date().toISOString(),
    tool: String(tool || '').slice(0, 40),
    signal: signal ? String(signal).slice(0, 20) : null,
    xp: Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0,
    ok: ok !== false,
  };
  return [...normalizeLog(log), entry].slice(-MAX_LOG);
}

/** 카운터 증가. 실패는 fail 로, 성공은 신호 이름으로. 입력 변형 없음. */
function bumpCounts(counts, { signal, ok, slain } = {}) {
  const next = normalizeCounts(counts);
  if (ok === false) next.fail += 1;
  else if (signal && COUNT_KEYS.includes(signal)) next[signal] += 1;
  if (slain) next.bossSlain += 1;
  return next;
}

/** 조건을 만족한 업적 id 전부. */
function unlockedIds(state) {
  return ACHIEVEMENTS.filter((a) => {
    const [have, need] = a.at(state);
    return have >= need;
  }).map((a) => a.id);
}

/** 아직 상태에 기록되지 않은 새 해금분. 알림은 이것만 쓴다 — 매번 자랑하지 않는다. */
function newlyUnlocked(state) {
  const had = new Set(normalizeAchievements(state.achievements));
  return unlockedIds(state).filter((id) => !had.has(id));
}

/** 업적 이름. 표 밖의 id 는 id 자체를 돌려준다. */
function achievementName(lang, id) {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return id;
  return lang === 'en' ? a.en : a.ko;
}

// ── normalize 헬퍼. rpg-state.normalize() 가 불러 쓴다 ────────────────

function normalizeCounts(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of COUNT_KEYS) {
    out[key] = Number.isFinite(src[key]) && src[key] >= 0 ? Math.floor(src[key]) : 0;
  }
  return out;
}

function normalizeBest(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return { streak: Number.isFinite(src.streak) && src.streak >= 0 ? Math.floor(src.streak) : 0 };
}

function normalizeAchievements(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.filter((id) => {
    if (typeof id !== 'string' || !ACHIEVEMENT_IDS.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeBoss(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cmd = bossKey(raw.cmd);
  if (!cmd) return null;
  if (!Number.isFinite(raw.fails) || raw.fails < 1) return null;
  return {
    cmd,
    fails: Math.min(999, Math.floor(raw.fails)),
    since: typeof raw.since === 'string' ? raw.since : null,
  };
}

function normalizeLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === 'object' && typeof e.tool === 'string' && e.tool)
    .map((e) => ({
      at: typeof e.at === 'string' ? e.at : null,
      tool: e.tool.slice(0, 40),
      signal: typeof e.signal === 'string' && e.signal ? e.signal.slice(0, 20) : null,
      xp: Number.isFinite(e.xp) && e.xp >= 0 ? Math.floor(e.xp) : 0,
      ok: e.ok !== false,
    }))
    .slice(-MAX_LOG);
}

module.exports = {
  signalFor, commandText, bossKey, bossBonus, nextBoss, appendLog, bumpCounts,
  unlockedIds, newlyUnlocked, achievementName,
  normalizeCounts, normalizeBest, normalizeAchievements, normalizeBoss, normalizeLog,
  XP, ACHIEVEMENTS, ACHIEVEMENT_IDS, BASH_SIGNALS, COUNT_KEYS,
  MAX_LOG, MAX_CMD, BOSS_THRESHOLD, BOSS_BONUS_CAP, BOSS_TTL_MS,
};

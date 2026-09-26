#!/usr/bin/env node
// rpg-mode — 상태 저장소 + 레벨 계산. 모듈이자 CLI.
//
//   require('./rpg-state')  → { read, write, award, startSession, endSession, progress, ... }
//   node rpg-state.js on|off|full|lite|status|reset

const fs = require('fs');
const path = require('path');
const os = require('os');

const XP_PER_LEVEL = 100; // 레벨 n → n+1 에 필요한 XP = 100 * n
const MODES = ['full', 'lite', 'off'];

const { t, LANGS, DEFAULT_LANG } = require('./rpg-text');
const {
  signalFor, bossKey, nextBoss, appendLog, bumpCounts, newlyUnlocked,
  normalizeCounts, normalizeBest, normalizeAchievements, normalizeBoss, normalizeLog,
  ACHIEVEMENTS, achievementName,
  bossBonus, BOSS_BONUS_CAP,
} = require('./rpg-progress');
const { meter, progressMeter, spark, BOSS_ART } = require('./rpg-dots');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_PATH = path.join(claudeDir, '.rpg-state.json');

const MAX_PROJECTS = 20; // 계급 변화를 감지할 만큼만 기억한다
const MAX_TIER = 15; // rank/weight 구간 번호의 상한. 우리가 쓰는 표보다 넉넉하게 잡은 검증용 값
const STALE_SESSION_MS = 12 * 60 * 60 * 1000; // 이보다 오래된 기준선은 죽은 세션으로 본다

const DEFAULT_STATE = Object.freeze({
  mode: 'full',
  lang: DEFAULT_LANG,
  xp: 0,
  level: 1,
  streak: 0,
  best: Object.freeze({ streak: 0 }), // 최고 연속 — 업적의 근거. 끊겨도 기록은 남는다
  counts: Object.freeze(normalizeCounts(null)), // 신호별 누적 횟수
  achievements: Object.freeze([]), // 해금된 업적 id
  boss: null, // { cmd, fails, since } — 연속 실패 중인 명령
  log: Object.freeze([]), // 전투 기록 링 버퍼 (최근 20건)
  progress: Object.freeze({ into: 0, span: XP_PER_LEVEL }),
  projects: Object.freeze({}),
  session: null,
  lastSession: null,
  updatedAt: null,
});

/** 누적 XP → 레벨. 부동소수 없이 루프로 정확히. */
function levelFor(xp) {
  let level = 1;
  let threshold = XP_PER_LEVEL;
  while (xp >= threshold) {
    level += 1;
    threshold += XP_PER_LEVEL * level;
  }
  return level;
}

/** 현재 레벨 구간 내 진행도. { level, into, span } */
function progress(xp) {
  const level = levelFor(xp);
  const floorXp = (XP_PER_LEVEL * level * (level - 1)) / 2;
  const nextXp = floorXp + XP_PER_LEVEL * level;
  return { level, into: xp - floorXp, span: nextXp - floorXp };
}

/**
 * 프로젝트 경로 → 상태 키.
 *
 * 같은 저장소가 표기 차이로 두 번 기록되는 것을 막는다 — 실제 상태 파일에
 * `C:/Users/.../RPG` 와 `C:\Users\...\RPG` 가 같이 들어가 가짜 승급을 만들었다.
 * 드라이브 문자가 있으면 윈도우 경로이므로 대소문자까지 접는다 (윈도우 FS 는 구분하지 않는다).
 * POSIX 경로는 대소문자를 구분하므로 구분자만 통일하고 그대로 둔다.
 * path.resolve 는 쓰지 않는다 — POSIX 에서 `C:/x` 가 상대 경로로 해석돼 cwd 가 붙는다.
 */
function projectKey(root) {
  const s = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(s) ? s.toLowerCase() : s;
}

/**
 * 프로젝트별 마지막 계급 기록. 형식이 어긋난 항목은 버리고, 표기만 다른 중복은 접고,
 * 최근 것부터 20개만 남긴다.
 */
function normalizeProjects(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const valid = (v) =>
    v &&
    typeof v === 'object' &&
    Number.isInteger(v.rank) && v.rank >= 0 && v.rank <= MAX_TIER &&
    Number.isInteger(v.weight) && v.weight >= 0 && v.weight <= MAX_TIER;

  const folded = new Map();
  Object.entries(raw)
    .filter(([key, v]) => typeof key === 'string' && key && valid(v))
    .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')))
    .forEach(([key, v]) => {
      const k = projectKey(key);
      // 최신 항목이 먼저 오므로 처음 본 것만 남긴다 — 표기만 다른 중복이 여기서 접힌다
      if (!folded.has(k)) {
        folded.set(k, { rank: v.rank, weight: v.weight, at: typeof v.at === 'string' ? v.at : null });
      }
    });

  return Object.fromEntries([...folded].slice(0, MAX_PROJECTS));
}

/**
 * 이번 세션의 XP 기준선. 형식이 어긋나면 null — 기준선이 없으면 요약을 만들지 않는다.
 * startLevel 은 저장값을 믿지 않고 startXp 에서 재계산한다 (level 과 같은 원칙).
 */
function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(raw.startXp) || raw.startXp < 0) return null;
  const startXp = Math.floor(raw.startXp);
  return {
    startXp,
    startLevel: levelFor(startXp),
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
  };
}

/**
 * 직전 세션의 결과. 획득이 0 이하면 null — 보여줄 것이 없는데 카드를 띄우지 않는다.
 * (아무것도 안 한 세션을 축하하는 건 이 플러그인이 금지하는 지어내기다.)
 */
function normalizeLastSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(raw.gained) || raw.gained <= 0) return null;
  const fromLevel = Number.isInteger(raw.fromLevel) && raw.fromLevel >= 1 ? raw.fromLevel : 1;
  const toLevel = Number.isInteger(raw.toLevel) && raw.toLevel >= fromLevel ? raw.toLevel : fromLevel;
  return {
    gained: Math.floor(raw.gained),
    fromLevel,
    toLevel,
    streak: Number.isFinite(raw.streak) && raw.streak >= 0 ? Math.floor(raw.streak) : 0,
    endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : null,
  };
}

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const xp = Number.isFinite(src.xp) && src.xp >= 0 ? Math.floor(src.xp) : 0;
  return {
    mode: MODES.includes(src.mode) ? src.mode : DEFAULT_STATE.mode,
    lang: LANGS.includes(src.lang) ? src.lang : DEFAULT_LANG,
    xp,
    level: levelFor(xp), // 저장된 level 은 신뢰하지 않고 xp 에서 재계산
    streak: Number.isFinite(src.streak) && src.streak >= 0 ? Math.floor(src.streak) : 0,
    best: normalizeBest(src.best),
    counts: normalizeCounts(src.counts),
    achievements: normalizeAchievements(src.achievements),
    boss: normalizeBoss(src.boss),
    log: normalizeLog(src.log),
    // 표시용 파생값. statusline 이 레벨 공식을 다시 구현하지 않도록 여기서 계산해 저장한다.
    progress: (({ into, span }) => ({ into, span }))(progress(xp)),
    projects: normalizeProjects(src.projects),
    session: normalizeSession(src.session),
    lastSession: normalizeLastSession(src.lastSession),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : null,
  };
}

/**
 * 이번 세션의 기준선을 잡는다 (입력 변형 없음). SessionStart 에서 부른다.
 *
 * 이미 살아 있는 기준선이 있으면 그대로 둔다 — compact/clear 로 SessionStart 가 다시 돌아도
 * 그 전에 번 XP 가 요약에서 빠지지 않는다. 기준선을 비우는 건 SessionEnd 의 몫이다
 * (SessionEnd 는 async 라 clear 에서 SessionStart 와 순서가 보장되지 않는다).
 * SessionEnd 없이 죽은 세션의 기준선이 영원히 남는 것은 12시간 만료로 막는다.
 * 직전 세션 기록(lastSession)은 건드리지 않는다 — 그 줄을 보여주는 건 SessionStart 의 몫이다.
 */
function startSession(state) {
  const before = normalize(state);
  const startedAt = before.session && before.session.startedAt;
  const live = startedAt && Date.now() - Date.parse(startedAt) < STALE_SESSION_MS;
  if (live) return before;
  return normalize({
    ...before,
    session: { startXp: before.xp, startedAt: new Date().toISOString() },
  });
}

/**
 * 세션을 닫는다 (입력 변형 없음). 기준선 이후 번 XP 를 lastSession 에 남기고 기준선을 비운다.
 * 기준선이 없으면 현재 XP 를 기준으로 삼아 획득 0 이 되고, 획득이 0 이면 기록도 남기지 않는다.
 */
function endSession(state) {
  const before = normalize(state);
  const startXp = before.session ? before.session.startXp : before.xp;
  const gained = before.xp - startXp;
  return normalize({
    ...before,
    session: null,
    lastSession:
      gained > 0
        ? {
            gained,
            fromLevel: levelFor(startXp),
            toLevel: before.level,
            streak: before.streak,
            endedAt: new Date().toISOString(),
          }
        : null,
  });
}

/**
 * 프로젝트의 계급·무게 구간을 기록한 새 상태를 돌려준다 (입력 변형 없음).
 * 다음 세션에서 승급/강등을 감지하고, --brief 가 재스캔 없이 계급명을 쓰기 위한 것.
 */
function withProject(state, root, { rank, weight }) {
  const before = normalize(state);
  return normalize({
    ...before,
    projects: {
      ...before.projects,
      [projectKey(root)]: { rank, weight, at: new Date().toISOString() },
    },
  });
}

/** 상태 읽기. 파일이 없거나 깨졌으면 기본값. 절대 던지지 않는다. */
function read() {
  try {
    return normalize(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')));
  } catch (e) {
    return { ...DEFAULT_STATE, progress: { ...DEFAULT_STATE.progress } };
  }
}

/** 상태 쓰기 (tmp → rename 으로 반쯤 쓰인 파일 방지). 실패해도 던지지 않는다. */
function write(state) {
  const next = { ...normalize(state), updatedAt: new Date().toISOString() };
  try {
    const tmp = STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, STATE_PATH);
  } catch (e) {
    /* 상태 저장 실패가 세션을 막으면 안 된다 */
  }
  return next;
}

/**
 * XP 지급. 새 객체를 돌려준다 (입력 변형 없음).
 * normalize 를 한 번 통과시켜 progress 같은 파생값이 낡은 채 새어 나가지 않게 한다.
 * @returns {{state: object, leveledUp: boolean, from: number}}
 */
function award(state, { xp = 0, success = true } = {}) {
  const before = normalize(state);
  const next = normalize({
    ...before,
    xp: before.xp + Math.max(0, xp),
    streak: success ? before.streak + 1 : 0,
  });
  return { state: next, leveledUp: next.level > before.level, from: before.level };
}

/**
 * 도구 실행 하나를 상태에 반영한다 (입력 변형 없음). XP·연속·카운터·보스·전투 기록·업적을
 * 한 번에 옮기는 유일한 통로 — 호출부가 순서를 잘못 맞출 여지를 두지 않는다.
 *
 * 순서가 중요하다: 보스 격파를 먼저 판정해 보너스를 확정하고, 그 합계로 XP 를 준다.
 *
 * @param {object} state
 * @param {{tool: string, cmd?: string, ok?: boolean}} event
 * @returns {{state, leveledUp, from, signal, xp, bonus, slain, unlocked}}
 */
function applyEvent(state, { tool, cmd, ok = true } = {}) {
  const before = normalize(state);
  const signal = signalFor(tool, cmd);
  // 보스는 Bash 만 상대한다. 편집 실패를 보스로 만들면 이름 붙일 대상이 없다.
  const key = tool === 'Bash' ? bossKey(cmd) : null;
  const { boss, slain } = nextBoss(before.boss, { key, ok, scored: !!signal });

  const base = ok && signal ? signal.xp : 0;
  const bonus = slain ? slain.bonus : 0;
  const gained = base + bonus;
  const { state: awarded, leveledUp, from } = award(before, { xp: gained, success: ok });

  const advanced = normalize({
    ...awarded,
    boss,
    counts: bumpCounts(before.counts, { signal: signal && signal.name, ok, slain }),
    best: { streak: Math.max(before.best.streak, awarded.streak) },
    log: appendLog(before.log, { tool, signal: signal && signal.name, xp: gained, ok }),
  });

  const unlocked = newlyUnlocked(advanced);
  return {
    state: normalize({ ...advanced, achievements: [...advanced.achievements, ...unlocked] }),
    leveledUp,
    from,
    signal: signal ? signal.name : null,
    xp: gained,
    bonus,
    slain,
    unlocked,
  };
}

module.exports = {
  read, write, award, applyEvent, withProject, startSession, endSession, progress, levelFor, projectKey,
  STATE_PATH, MODES, XP_PER_LEVEL, MAX_PROJECTS, STALE_SESSION_MS,
};

// ── CLI ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const arg = (process.argv[2] || 'status').toLowerCase();
  const current = read();

  const lang = current.lang;

  if (arg === 'status') {
    const p = progress(current.xp);
    process.stdout.write(
      `${t(lang, 'mode')}: ${current.mode} | Lv.${p.level} ${meter(p.into / p.span)} ` +
        `${p.into}/${p.span} (${t(lang, 'total')} ${current.xp}) | ` +
        `${t(lang, 'streak')} ${current.streak}\n`
    );
    // 살아 있는 보스가 있을 때만 스프라이트를 그린다. 없는 전투를 연출하지 않는다.
    if (current.boss) {
      const bonus = bossBonus(current.boss.fails);
      const side = [
        t(lang, 'bossActive', current.boss.cmd, current.boss.fails),
        `${t(lang, 'bossBonusAt', bonus)}  ${meter(bonus / BOSS_BONUS_CAP)}`,
        '',
      ];
      BOSS_ART.forEach((row, i) => process.stdout.write(`   ${row}  ${side[i] || ''}\n`.trimEnd() + '\n'));
    }
    // 현재 프로젝트 카드도 같이. 스캔은 여기서만 필요하므로 이 시점에 불러온다.
    try {
      const scan = require('./rpg-scan');
      const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      process.stdout.write(scan.card(scan.evaluate(root), { lang }) + '\n');
    } catch (e) {
      process.stdout.write(t(lang, 'scanFailed') + '\n');
    }
  } else if (arg === 'log') {
    // 전투 기록. XP 가 어디서 붙었는지 감사할 수 있어야 한다 — 그래야 지어낸 값이 아님이 보인다.
    if (!current.log.length) {
      process.stdout.write(t(lang, 'logEmpty') + '\n');
    } else {
      // 스파크라인은 오래된 것부터, 목록은 최신부터. 같은 높이 배열을 나눠 쓴다.
      const marks = spark(current.log.map((e) => e.xp));
      process.stdout.write(`${t(lang, 'logHeader', current.log.length)}  ${marks}\n`);
      const rows = [];
      current.log.forEach((e, i) => {
        const time = e.at ? new Date(e.at).toTimeString().slice(0, 5) : '--:--';
        const xp = e.xp > 0 ? '+' + e.xp : '0';
        const line =
          `${time}  ${e.ok ? '✓' : '✗'} ${e.tool.padEnd(6)} ` +
          `${(e.signal || '-').padEnd(7)} ${xp.padStart(4)}  ${marks[i] || ''}`;
        rows.push(line);
      });
      rows.reverse().forEach((line) => process.stdout.write(line + '\n'));
    }
  } else if (arg === 'achievements' || arg === 'ach') {
    const unlocked = new Set(current.achievements);
    process.stdout.write(
      `${t(lang, 'achHeader', unlocked.size, ACHIEVEMENTS.length)}  ` +
        `${progressMeter(unlocked.size, ACHIEVEMENTS.length)}\n`
    );
    for (const a of ACHIEVEMENTS) {
      const [have, need] = a.at(current);
      const name = achievementName(lang, a.id);
      process.stdout.write(
        unlocked.has(a.id)
          ? `  ✓ ${name}\n`
          : `  · ${name} — ${progressMeter(have, need)} ` +
            `${t(lang, 'achLocked', Math.min(have, need), need)}\n`
      );
    }
  } else if (arg === 'reset') {
    // 계급은 프로젝트의 성질이지 내 진행도가 아니다. XP 만 되돌린다.
    write({ ...DEFAULT_STATE, mode: current.mode, lang, projects: current.projects });
    process.stdout.write(t(lang, 'resetDone') + '\n');
  } else if (arg === 'lang') {
    const next = (process.argv[3] || '').toLowerCase();
    if (!LANGS.includes(next)) {
      process.stdout.write(t(lang, 'usage') + '\n');
      process.exit(1);
    }
    write({ ...current, lang: next });
    process.stdout.write(t(next, 'langSet', next) + '\n');
  } else if (arg === 'on') {
    write({ ...current, mode: 'full' });
    process.stdout.write(t(lang, 'modeOn') + '\n');
  } else if (MODES.includes(arg)) {
    write({ ...current, mode: arg });
    process.stdout.write(t(lang, 'modeSet', arg) + '\n');
  } else {
    process.stdout.write(t(lang, 'usage') + '\n');
    process.exit(1);
  }
}

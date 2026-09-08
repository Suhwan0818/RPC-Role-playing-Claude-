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

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_PATH = path.join(claudeDir, '.rpg-state.json');

const MAX_PROJECTS = 20; // 계급 변화를 감지할 만큼만 기억한다
const MAX_TIER = 15; // rank/weight 구간 번호의 상한. 우리가 쓰는 표보다 넉넉하게 잡은 검증용 값

const DEFAULT_STATE = Object.freeze({
  mode: 'full',
  lang: DEFAULT_LANG,
  xp: 0,
  level: 1,
  streak: 0,
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

/** 프로젝트별 마지막 계급 기록. 형식이 어긋난 항목은 버리고 최근 것부터 20개만 남긴다. */
function normalizeProjects(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const valid = (v) =>
    v &&
    typeof v === 'object' &&
    Number.isInteger(v.rank) && v.rank >= 0 && v.rank <= MAX_TIER &&
    Number.isInteger(v.weight) && v.weight >= 0 && v.weight <= MAX_TIER;

  const kept = Object.entries(raw)
    .filter(([key, v]) => typeof key === 'string' && key && valid(v))
    .map(([key, v]) => [key, { rank: v.rank, weight: v.weight, at: typeof v.at === 'string' ? v.at : null }])
    .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')))
    .slice(0, MAX_PROJECTS);

  return Object.fromEntries(kept);
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
    // 표시용 파생값. statusline 이 레벨 공식을 다시 구현하지 않도록 여기서 계산해 저장한다.
    progress: (({ into, span }) => ({ into, span }))(progress(xp)),
    projects: normalizeProjects(src.projects),
    session: normalizeSession(src.session),
    lastSession: normalizeLastSession(src.lastSession),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : null,
  };
}

/**
 * 이번 세션의 기준선을 현재 XP 로 새로 잡는다 (입력 변형 없음).
 * SessionStart 에서 부른다. 직전 세션 기록(lastSession)은 건드리지 않는다 —
 * 그 줄을 보여주는 건 같은 SessionStart 의 몫이다.
 */
function startSession(state) {
  const before = normalize(state);
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
      [root]: { rank, weight, at: new Date().toISOString() },
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
 * @returns {{state: object, leveledUp: boolean, from: number}}
 */
function award(state, { xp = 0, success = true } = {}) {
  const before = normalize(state);
  const next = {
    ...before,
    xp: before.xp + Math.max(0, xp),
    streak: success ? before.streak + 1 : 0,
  };
  next.level = levelFor(next.xp);
  return { state: next, leveledUp: next.level > before.level, from: before.level };
}

module.exports = {
  read, write, award, withProject, startSession, endSession, progress, levelFor,
  STATE_PATH, MODES, XP_PER_LEVEL, MAX_PROJECTS,
};

// ── CLI ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const arg = (process.argv[2] || 'status').toLowerCase();
  const current = read();

  const lang = current.lang;

  if (arg === 'status') {
    const p = progress(current.xp);
    process.stdout.write(
      `${t(lang, 'mode')}: ${current.mode} | Lv.${p.level} | ` +
        `XP ${p.into}/${p.span} (${t(lang, 'total')} ${current.xp}) | ` +
        `${t(lang, 'streak')} ${current.streak}\n`
    );
    // 현재 프로젝트 카드도 같이. 스캔은 여기서만 필요하므로 이 시점에 불러온다.
    try {
      const scan = require('./rpg-scan');
      const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      process.stdout.write(scan.card(scan.evaluate(root), { lang }) + '\n');
    } catch (e) {
      process.stdout.write(t(lang, 'scanFailed') + '\n');
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

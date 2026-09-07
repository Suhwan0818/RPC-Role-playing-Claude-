#!/usr/bin/env node
// rpg-mode — 상태 저장소 + 레벨 계산. 모듈이자 CLI.
//
//   require('./rpg-state')  → { read, write, award, progress, STATE_PATH }
//   node rpg-state.js on|off|full|lite|status|reset

const fs = require('fs');
const path = require('path');
const os = require('os');

const XP_PER_LEVEL = 100; // 레벨 n → n+1 에 필요한 XP = 100 * n
const MODES = ['full', 'lite', 'off'];

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_PATH = path.join(claudeDir, '.rpg-state.json');

const DEFAULT_STATE = Object.freeze({
  mode: 'full',
  xp: 0,
  level: 1,
  streak: 0,
  progress: Object.freeze({ into: 0, span: XP_PER_LEVEL }),
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

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const xp = Number.isFinite(src.xp) && src.xp >= 0 ? Math.floor(src.xp) : 0;
  return {
    mode: MODES.includes(src.mode) ? src.mode : DEFAULT_STATE.mode,
    xp,
    level: levelFor(xp), // 저장된 level 은 신뢰하지 않고 xp 에서 재계산
    streak: Number.isFinite(src.streak) && src.streak >= 0 ? Math.floor(src.streak) : 0,
    // 표시용 파생값. statusline 이 레벨 공식을 다시 구현하지 않도록 여기서 계산해 저장한다.
    progress: (({ into, span }) => ({ into, span }))(progress(xp)),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : null,
  };
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

module.exports = { read, write, award, progress, levelFor, STATE_PATH, MODES, XP_PER_LEVEL };

// ── CLI ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const arg = (process.argv[2] || 'status').toLowerCase();
  const current = read();

  if (arg === 'status') {
    const p = progress(current.xp);
    process.stdout.write(
      `모드: ${current.mode} | Lv.${p.level} | XP ${p.into}/${p.span} (누적 ${current.xp}) | 연속 ${current.streak}\n`
    );
  } else if (arg === 'reset') {
    write({ ...DEFAULT_STATE, mode: current.mode });
    process.stdout.write('RPG 진행도 초기화됨. Lv.1 XP 0\n');
  } else if (arg === 'on') {
    write({ ...current, mode: 'full' });
    process.stdout.write('RPG 모드 ON (full)\n');
  } else if (MODES.includes(arg)) {
    write({ ...current, mode: arg });
    process.stdout.write(`RPG 모드: ${arg}\n`);
  } else {
    process.stdout.write('사용법: rpg-state.js on|off|full|lite|status|reset\n');
    process.exit(1);
  }
}

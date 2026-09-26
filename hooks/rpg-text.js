#!/usr/bin/env node
// rpg-mode — 훅이 직접 찍는 문자열의 한국어/영어 표.
//
//   const { t } = require('./rpg-text');
//   t('en', 'rank')          → 'Rank'
//   t('en', 'partial', 3000) → 'Partial scan — exceeded the 3000ms budget. ...'
//
// 서술 자체는 여기서 다루지 않는다. SKILL.md 규칙 4번이 모델에게 "사용자 언어를
// 따라간다" 고 이미 지시하므로 영어 세션의 서술은 원래 영어로 나온다.
// 여기서 번역하는 건 훅이 만드는 문구뿐이다.
//
// auto 는 없다. 훅에는 사용자 언어를 알려주는 신호가 없고,
// 없는 신호로 추측하는 것은 이 플러그인이 금지하는 짓이다.

const LANGS = ['ko', 'en'];
const DEFAULT_LANG = 'ko';

const STRINGS = {
  ko: {
    // ── 계급 카드 ──
    rank: '계급',
    score: '점수',
    cap: '상한',
    size: '규모',
    files: '파일',
    tests: '테스트',
    commits: '커밋',
    todosUnknown: 'TODO 미측정',
    weight: '장비 무게',
    weightIndex: '지수',
    avg: '평균',
    perFile: '/파일',
    heavyFiles: '거대 파일',
    heavyUnit: '개 (32KB 이상)',
    missing: '빠진 장비',
    manifest: '매니페스트',
    unknownRank: '알 수 없음',
    partial: (ms) => `부분 측정 — ${ms}ms 예산 초과. 실제보다 작게 잡혔을 수 있다.`,

    // ── CLI ──
    mode: '모드',
    total: '누적',
    streak: '연속',
    usage: '사용법: rpg-state.js on|off|full|lite|status|reset|log|achievements|lang <ko|en>',
    scanFailed: '프로젝트 측정 실패 — 계급은 생략한다.',
    resetDone: 'RPG 진행도 초기화됨. Lv.1 XP 0 (프로젝트 계급 기록은 유지)',
    modeOn: 'RPG 모드 ON (full)',
    modeSet: (m) => `RPG 모드: ${m}`,
    langSet: (l) => `RPG 표시 언어: ${l}`,

    // ── 주입 문구 (SessionStart / UserPromptSubmit) ──
    activeHeader: (mode, status) => `RPG MODE ACTIVE — 강도: ${mode} · ${status}`,
    briefReminder: (mode, status, rank) =>
      `RPG MODE ACTIVE (${mode}) — ${status}${rank}. ` +
      '퀘스트 틀 유지, 기술 내용 원문 보존, 실패는 실패로 보고. 도트아트는 넣지 않는다.',
    fallbackRules:
      '# RPG Mode\n작업을 퀘스트로 서술한다. `⚔️ 퀘스트` 헤더, `[탐색]/[전투]/[결과]`, ' +
      '`📜 획득` 마무리.\n코드·에러·경로는 원문 그대로. 없는 수치 지어내지 않는다. ' +
      '실패는 실패로 보고한다.\n파괴적 작업 확인과 보안 경고는 평문으로.',
    projectHeader: '## 이번 프로젝트 (측정값 — 이 수치 밖의 것은 지어내지 말 것)',
    promoted: (from, to) => `승급: ${from} → ${to}. 이번 세션 첫 응답에서 한 번 언급한다.`,
    demoted: (from, to) =>
      `강등: ${from} → ${to}. 이유를 위 측정값에서 찾아 한 번 언급한다.`,
    artOnce: '도트아트는 이번 세션 첫 응답에서만 쓴다. 이후 응답에는 넣지 않는다.',
    scanFailedSession: '프로젝트 측정 실패 — 계급·무게는 이번 세션에서 언급하지 않는다.',
    levelRange: (from, to) => ` · Lv.${from} → Lv.${to}`,
    lastRun: (gained, levels, streak) =>
      `지난 원정: XP +${gained}${levels} · 연속 ${streak}. ` +
      '이번 세션 첫 응답에서 한 줄로만 언급한다.',
    rivals: (list) =>
      `동시 활성: ${list} — RPG 는 틀(헤더·획득 라인)만 담당하고 ` +
      '본문 문장 스타일은 그쪽 규칙을 따른다. 충돌 시 그쪽이 본문의 주인이다.',

    // ── 보스 · 업적 알림 ──
    bossSlain: (cmd, attempt, bonus) =>
      `⚔ 보스 격파 — \`${cmd}\` ${attempt}번째 시도에서 통과. 보너스 XP +${bonus}. ` +
      '이번 응답 끝에 한 줄로 알릴 것. 시도 횟수는 실제 실패 횟수다.',
    achUnlock: (names) =>
      `🏅 업적 해금 — ${names}. 이번 응답 끝에 한 줄로 알릴 것. 없는 업적을 지어내지 말 것.`,

    // ── /rpg log · /rpg achievements ──
    logHeader: (n) => `전투 기록 (최근 ${n}건)`,
    logEmpty: '전투 기록이 없다. XP 를 주는 도구 실행이 아직 없었다.',
    achHeader: (have, total) => `업적 ${have}/${total}`,
    achLocked: (have, need) => `${have}/${need}`,
    bossActive: (cmd, fails) => `보스: \`${cmd}\` — 연속 실패 ${fails}회`,

    // ── PostToolUse 알림 ──
    levelUp: (from, to, total) =>
      `⬆ LEVEL UP — Lv.${from} → Lv.${to} (누적 XP ${total}). 이번 응답 끝에 한 줄로 알릴 것.`,
  },
  en: {
    // ── rank card ──
    rank: 'Rank',
    score: 'score',
    cap: 'capped',
    size: 'Size',
    files: 'files',
    tests: 'tests',
    commits: 'commits',
    todosUnknown: 'TODO not measured',
    weight: 'Pack weight',
    weightIndex: 'index',
    avg: 'avg',
    perFile: '/file',
    heavyFiles: 'Heavy files',
    heavyUnit: ' (32KB+)',
    missing: 'Missing gear',
    manifest: 'manifest',
    unknownRank: 'unknown',
    partial: (ms) => `Partial scan — exceeded the ${ms}ms budget. Numbers may read low.`,

    // ── CLI ──
    mode: 'mode',
    total: 'total',
    streak: 'streak',
    usage: 'usage: rpg-state.js on|off|full|lite|status|reset|log|achievements|lang <ko|en>',
    scanFailed: 'Project scan failed — skipping rank.',
    resetDone: 'RPG progress reset. Lv.1 XP 0 (project ranks kept)',
    modeOn: 'RPG mode ON (full)',
    modeSet: (m) => `RPG mode: ${m}`,
    langSet: (l) => `RPG display language: ${l}`,

    // ── injected text (SessionStart / UserPromptSubmit) ──
    activeHeader: (mode, status) => `RPG MODE ACTIVE — intensity: ${mode} · ${status}`,
    briefReminder: (mode, status, rank) =>
      `RPG MODE ACTIVE (${mode}) — ${status}${rank}. ` +
      'Keep the quest frame, keep technical content verbatim, report failure as failure. No pixel art.',
    fallbackRules:
      '# RPG Mode\nNarrate the work as a quest. `⚔️ Quest` header, `[Scout]/[Fight]/[Result]`, ' +
      'close with `📜 Loot`.\nCode, errors and paths stay verbatim. Never invent numbers. ' +
      'Report failure as failure.\nDestructive-action confirmations and security warnings go in plain prose.',
    projectHeader: '## This project (measured — never invent anything beyond these numbers)',
    promoted: (from, to) => `Promoted: ${from} → ${to}. Mention it once in the first reply.`,
    demoted: (from, to) =>
      `Demoted: ${from} → ${to}. Find the reason in the numbers above and mention it once.`,
    artOnce: 'Use the pixel art only in this session first reply. Leave it out of later replies.',
    scanFailedSession: 'Project scan failed — do not mention rank or pack weight this session.',
    levelRange: (from, to) => ` · Lv.${from} → Lv.${to}`,
    lastRun: (gained, levels, streak) =>
      `Last run: XP +${gained}${levels} · streak ${streak}. ` +
      'Mention it in one line in the first reply.',
    rivals: (list) =>
      `Also active: ${list} — RPG owns only the frame (header and loot line); ` +
      'the prose style follows those rules. On conflict they own the body.',

    // ── boss / achievement notices ──
    bossSlain: (cmd, attempt, bonus) =>
      `⚔ Boss slain — \`${cmd}\` passed on attempt ${attempt}. Bonus XP +${bonus}. ` +
      'Announce it in one line at the end of this reply. The attempt count is real failures.',
    achUnlock: (names) =>
      `🏅 Achievement unlocked — ${names}. Announce it in one line at the end of this reply. Never invent one.`,

    // ── /rpg log · /rpg achievements ──
    logHeader: (n) => `Combat log (last ${n})`,
    logEmpty: 'No combat log yet. No XP-scoring tool run so far.',
    achHeader: (have, total) => `Achievements ${have}/${total}`,
    achLocked: (have, need) => `${have}/${need}`,
    bossActive: (cmd, fails) => `Boss: \`${cmd}\` — ${fails} consecutive failures`,

    // ── PostToolUse notice ──
    levelUp: (from, to, total) =>
      `⬆ LEVEL UP — Lv.${from} → Lv.${to} (total XP ${total}). Announce it in one line at the end of this reply.`,
  },
};

/**
 * 문구 한 개. 알 수 없는 언어는 기본값으로 떨어진다.
 * 키가 표에 없으면 키 자체를 돌려준다 — 조용히 빈 칸을 내는 것보다 낫다.
 */
function t(lang, key, ...args) {
  const table = STRINGS[LANGS.includes(lang) ? lang : DEFAULT_LANG];
  const value = table[key];
  if (typeof value === 'function') return value(...args);
  return value === undefined ? key : value;
}

module.exports = { t, LANGS, DEFAULT_LANG, STRINGS };

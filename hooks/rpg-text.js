#!/usr/bin/env node
// rpg-mode — 훅이 직접 찍는 문자열의 한국어/영어 표.
//
//   const { t } = require('./rpg-text');
//   t('en', 'rank')          → 'Rank'
//   t('en', 'partial', 3000) → 'Partial scan — exceeded the 3000ms budget. ...'
//
// 서술 자체는 여기서 다루지 않는다. SKILL.md 규칙 4번이 모델에게 "사용자 언어를
// 따라간다" 고 이미 지시하므로 영어 세션의 서술은 원래 영어로 나온다.
// 여기서 번역하는 건 훅이 만드는 라벨뿐이다.
//
// auto 는 없다. 훅에는 사용자 언어를 알려주는 신호가 없고,
// 없는 신호로 추측하는 것은 이 플러그인이 금지하는 짓이다.

const LANGS = ['ko', 'en'];
const DEFAULT_LANG = 'ko';

const STRINGS = {
  ko: {
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
    partial: (ms) => `부분 측정 — ${ms}ms 예산 초과. 실제보다 작게 잡혔을 수 있다.`,
    mode: '모드',
    total: '누적',
    streak: '연속',
    usage: '사용법: rpg-state.js on|off|full|lite|status|reset|lang <ko|en>',
    scanFailed: '프로젝트 측정 실패 — 계급은 생략한다.',
    resetDone: 'RPG 진행도 초기화됨. Lv.1 XP 0 (프로젝트 계급 기록은 유지)',
    modeOn: 'RPG 모드 ON (full)',
    modeSet: (m) => `RPG 모드: ${m}`,
    langSet: (l) => `RPG 표시 언어: ${l}`,
  },
  en: {
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
    partial: (ms) => `Partial scan — exceeded the ${ms}ms budget. Numbers may read low.`,
    mode: 'mode',
    total: 'total',
    streak: 'streak',
    usage: 'usage: rpg-state.js on|off|full|lite|status|reset|lang <ko|en>',
    scanFailed: 'Project scan failed — skipping rank.',
    resetDone: 'RPG progress reset. Lv.1 XP 0 (project ranks kept)',
    modeOn: 'RPG mode ON (full)',
    modeSet: (m) => `RPG mode: ${m}`,
    langSet: (l) => `RPG display language: ${l}`,
  },
};

/**
 * 라벨 한 개. 알 수 없는 언어는 기본값으로 떨어진다.
 * 키가 표에 없으면 키 자체를 돌려준다 — 조용히 빈 칸을 내는 것보다 낫다.
 */
function t(lang, key, ...args) {
  const table = STRINGS[LANGS.includes(lang) ? lang : DEFAULT_LANG];
  const value = table[key];
  if (typeof value === 'function') return value(...args);
  return value === undefined ? key : value;
}

module.exports = { t, LANGS, DEFAULT_LANG, STRINGS };

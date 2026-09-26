#!/usr/bin/env node
// rpg-mode — 규칙 주입 hook.
//
//   node rpg-activate.js           SessionStart: SKILL.md 전문 주입
//   node rpg-activate.js --brief   UserPromptSubmit: 한 줄 리마인더 (드리프트 방지)
//
// SKILL.md 를 런타임에 읽는다 — 규칙 원본은 한 곳뿐, 복사본이 낡을 일 없다.
// 훅이 직접 찍는 문구는 전부 rpg-text.js 의 표에서 온다 — /rpg lang en 이 반쪽이 되지 않게.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { read, write, withProject, startSession, progress, projectKey } = require('./rpg-state');
const { evaluate, card, rankName } = require('./rpg-scan');
const { t } = require('./rpg-text');

const brief = process.argv.includes('--brief');
const state = read();

if (state.mode === 'off') process.exit(0);

const lang = state.lang;
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// 조회도 기록과 같은 키를 쓴다 — 표기가 달라 같은 저장소를 못 찾으면 가짜 승급이 나온다.
const knownKey = projectKey(projectRoot);
const p = progress(state.xp);
const statusLine = `Lv.${p.level} · XP ${p.into}/${p.span} · ${t(lang, 'streak')} ${state.streak}`;

// 매 프롬프트마다 도는 경로다. 절대 스캔하지 않는다 — 저장된 계급만 얹는다.
if (brief) {
  const known = state.projects[knownKey];
  const rank = known ? ` · ${rankName(lang, known.rank, { short: true })}` : '';
  process.stdout.write(t(lang, 'briefReminder', state.mode, statusLine, rank));
  process.exit(0);
}

// SKILL.md 후보 경로 — 플러그인 설치, 저장소 체크아웃, 수동 설치 순.
const candidates = [];
if (process.env.CLAUDE_PLUGIN_ROOT) {
  candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, 'skills', 'rpg', 'SKILL.md'));
}
candidates.push(
  path.join(__dirname, '..', 'skills', 'rpg', 'SKILL.md'),
  path.join(__dirname, '..', '..', 'skills', 'rpg', 'SKILL.md')
);

let rules = '';
for (const candidate of candidates) {
  try {
    rules = fs.readFileSync(candidate, 'utf8');
    break;
  } catch (e) {
    /* 다음 후보 */
  }
}

// SKILL.md 를 못 찾아도 모드는 켜져야 한다. 최소 규칙으로 폴백.
if (!rules) rules = t(lang, 'fallbackRules');

const out = [t(lang, 'activeHeader', state.mode, statusLine), '', rules];

// 이번 세션의 XP 기준선을 먼저 잡는다. 측정이 실패해도 세션 요약은 남아야 한다.
// 기준선이 이미 살아 있으면 startSession 이 보존한다 — compact/clear 로 여기가 다시 돌아도
// 그 전에 번 XP 가 요약에서 빠지지 않는다.
let next = startSession(state);

// 프로젝트 측정. 실패해도 세션은 떠야 하므로 통째로 감싼다.
try {
  const scan = evaluate(projectRoot);
  const known = state.projects[knownKey];
  out.push('', t(lang, 'projectHeader'), '', card(scan, { lang }));

  if (known && known.rank !== scan.rank.tier) {
    const up = scan.rank.tier > known.rank;
    const from = rankName(lang, known.rank, { short: true });
    const to = rankName(lang, scan.rank.tier, { short: true });
    out.push('', up ? t(lang, 'promoted', from, to) : t(lang, 'demoted', from, to));
  }
  out.push('', t(lang, 'artOnce'));

  next = withProject(next, projectRoot, { rank: scan.rank.tier, weight: scan.weight.tier });
} catch (e) {
  out.push('', t(lang, 'scanFailedSession'));
}

// 지난 원정. 아무것도 못 번 세션 뒤에는 lastSession 이 비어 있어 이 줄이 없다.
// 한 번 보여준 기록은 지운다 — compact 로 SessionStart 가 또 돌아도 두 번 나오지 않는다.
if (state.lastSession) {
  const s = state.lastSession;
  const levels = s.toLevel > s.fromLevel ? t(lang, 'levelRange', s.fromLevel, s.toLevel) : '';
  out.push('', t(lang, 'lastRun', s.gained, levels, s.streak));
  next = { ...next, lastSession: null };
}

write(next);

// 압축 모드와 동시에 켜져 있으면 우선순위를 명시한다. 안 그러면 두 규칙이 싸운다.
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const rivals = ['.caveman-active', '.ponytail-active'].filter((f) =>
  fs.existsSync(path.join(claudeDir, f))
);
if (rivals.length) out.push('', t(lang, 'rivals', rivals.join(', ')));

process.stdout.write(out.join('\n'));

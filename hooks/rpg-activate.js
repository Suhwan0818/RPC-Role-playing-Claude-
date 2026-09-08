#!/usr/bin/env node
// rpg-mode — 규칙 주입 hook.
//
//   node rpg-activate.js           SessionStart: SKILL.md 전문 주입
//   node rpg-activate.js --brief   UserPromptSubmit: 한 줄 리마인더 (드리프트 방지)
//
// SKILL.md 를 런타임에 읽는다 — 규칙 원본은 한 곳뿐, 복사본이 낡을 일 없다.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { read, write, withProject, startSession, progress } = require('./rpg-state');
const { evaluate, card, RANKS } = require('./rpg-scan');

const brief = process.argv.includes('--brief');
const state = read();

if (state.mode === 'off') process.exit(0);

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const p = progress(state.xp);
const statusLine = `Lv.${p.level} · XP ${p.into}/${p.span} · 연속 ${state.streak}`;

// 매 프롬프트마다 도는 경로다. 절대 스캔하지 않는다 — 저장된 계급만 얹는다.
if (brief) {
  const known = state.projects[projectRoot];
  const rankName = known && RANKS[known.rank] ? ` · ${RANKS[known.rank].ko}` : '';
  process.stdout.write(
    `RPG MODE ACTIVE (${state.mode}) — ${statusLine}${rankName}. ` +
      '퀘스트 틀 유지, 기술 내용 원문 보존, 실패는 실패로 보고. 도트아트는 넣지 않는다.'
  );
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
if (!rules) {
  rules =
    '# RPG Mode\n작업을 퀘스트로 서술한다. `⚔️ 퀘스트` 헤더, `[탐색]/[전투]/[결과]`, ' +
    '`📜 획득` 마무리.\n코드·에러·경로는 원문 그대로. 없는 수치 지어내지 않는다. ' +
    '실패는 실패로 보고한다.\n파괴적 작업 확인과 보안 경고는 평문으로.';
}

const out = [`RPG MODE ACTIVE — 강도: ${state.mode} · ${statusLine}`, '', rules];

// 이번 세션의 XP 기준선을 먼저 잡는다. 측정이 실패해도 세션 요약은 남아야 한다.
// ponytail: compact/clear 로 SessionStart 가 다시 돌면 기준선도 다시 잡힌다 —
// 그 전에 번 XP 는 요약에서 빠진다. 세션 id 를 물고 늘어질 만한 값은 아니다.
let next = startSession(state);

// 프로젝트 측정. 실패해도 세션은 떠야 하므로 통째로 감싼다.
try {
  const scan = evaluate(projectRoot);
  const known = state.projects[projectRoot];
  out.push(
    '',
    '## 이번 프로젝트 (측정값 — 이 수치 밖의 것은 지어내지 말 것)',
    '',
    card(scan, { lang: state.lang })
  );

  if (known && known.rank !== scan.rank.tier) {
    const up = scan.rank.tier > known.rank;
    const from = RANKS[known.rank] ? RANKS[known.rank].ko : '알 수 없음';
    out.push(
      '',
      up
        ? `승급: ${from} → ${scan.rank.ko}. 이번 세션 첫 응답에서 한 번 언급한다.`
        : `강등: ${from} → ${scan.rank.ko}. 이유를 위 측정값에서 찾아 한 번 언급한다.`
    );
  }
  out.push('', '도트아트는 이번 세션 첫 응답에서만 쓴다. 이후 응답에는 넣지 않는다.');

  next = withProject(next, projectRoot, { rank: scan.rank.tier, weight: scan.weight.tier });
} catch (e) {
  out.push('', '프로젝트 측정 실패 — 계급·무게는 이번 세션에서 언급하지 않는다.');
}

// 지난 원정. 아무것도 못 번 세션 뒤에는 lastSession 이 비어 있어 이 줄이 없다.
// 한 번 보여준 기록은 지운다 — compact 로 SessionStart 가 또 돌아도 두 번 나오지 않는다.
if (state.lastSession) {
  const s = state.lastSession;
  const levels = s.toLevel > s.fromLevel ? ` · Lv.${s.fromLevel} → Lv.${s.toLevel}` : '';
  out.push(
    '',
    `지난 원정: XP +${s.gained}${levels} · 연속 ${s.streak}. ` +
      '이번 세션 첫 응답에서 한 줄로만 언급한다.'
  );
  next = { ...next, lastSession: null };
}

write(next);

// 압축 모드와 동시에 켜져 있으면 우선순위를 명시한다. 안 그러면 두 규칙이 싸운다.
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const rivals = ['.caveman-active', '.ponytail-active'].filter((f) =>
  fs.existsSync(path.join(claudeDir, f))
);
if (rivals.length) {
  out.push(
    '',
    `동시 활성: ${rivals.join(', ')} — RPG 는 틀(헤더·획득 라인)만 담당하고 ` +
      '본문 문장 스타일은 그쪽 규칙을 따른다. 충돌 시 그쪽이 본문의 주인이다.'
  );
}

process.stdout.write(out.join('\n'));

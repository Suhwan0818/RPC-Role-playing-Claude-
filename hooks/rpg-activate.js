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
const { read, progress } = require('./rpg-state');

const brief = process.argv.includes('--brief');
const state = read();

if (state.mode === 'off') process.exit(0);

const p = progress(state.xp);
const statusLine = `Lv.${p.level} · XP ${p.into}/${p.span} · 연속 ${state.streak}`;

if (brief) {
  process.stdout.write(
    `RPG MODE ACTIVE (${state.mode}) — ${statusLine}. ` +
      '퀘스트 틀 유지, 기술 내용 원문 보존, 실패는 실패로 보고.'
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

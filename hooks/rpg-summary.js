#!/usr/bin/env node
// rpg-mode — SessionEnd 훅. 이번 세션에서 번 것을 기록한다.
//
//   node rpg-summary.js
//
// 왜 여기서 출력하지 않나: SessionEnd 는 세션이 끝난 뒤라 보여줄 화면이 없다.
// 그래서 기록만 남기고, 다음 세션의 SessionStart 가 "지난 원정" 한 줄로 보여준다.
//
// 아무것도 못 번 세션은 기록을 남기지 않는다 (endSession 이 lastSession 을 null 로 둔다).
// 지어낸 축하는 이 플러그인이 금지하는 짓이다.

const { read, write, endSession } = require('./rpg-state');

let done = false;

function finish() {
  if (done) return;
  done = true;
  try {
    const state = read();
    if (state.mode !== 'off') write(endSession(state));
  } catch (e) {
    /* 세션 종료를 막으면 안 된다 */
  }
  process.exit(0);
}

// stdin 은 흘려보낸다. 페이로드가 없어도 동작해야 하므로 내용을 쓰지 않는다.
// 읽지 않으면 파이프가 안 닫혀 타임아웃까지 매달릴 수 있다.
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', finish);
process.stdin.on('error', finish);

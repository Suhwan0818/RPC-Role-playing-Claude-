# rpg-mode

Claude Code 응답을 RPG 게임처럼 서술하고, **XP·레벨을 실제로 누적**한다.

```
⚔️  퀘스트: auth 미들웨어가 유효한 토큰을 거부하는 문제

[탐색] src/auth/middleware.ts:42 — 만료 검사가 `token.exp < now`
[전투] `<` → `<=` 로 교체
[결과] npm test 통과 (24/24)

📜 획득: 회귀 테스트 지점 1개
```

statusline: `Lv.3 ███░░░░░ 120/300 *4`

세션 첫 응답에는 프로젝트 계급 카드가 붙는다:

```
   ░░███░░
   ░░▒█▒░░
   ░▒████▓     계급: 모험가 (Adventurer) · 점수 52/100
   ░░█░█▓░     규모: 파일 12 · 57KB · 테스트 2 · 커밋 3 · TODO 17
   ░░▒░▒░░     장비 무게: 적당 (지수 15, 평균 5KB/파일)
```

## 설치

```
/plugin marketplace add Suhwan0818/RPC-Role-playing-Claude-
/plugin install rpg-mode@rpg-mode
```

statusline 표시는 별도다 — `~/.claude/statusline.js` 에 `rpgSegment()` 가 이미 들어가 있다.
(상태 파일이 없거나 `off` 면 아무것도 그리지 않으므로 기존 statusline 동작은 그대로다.)

## 알려진 표시 문제

**로컬 directory 마켓플레이스로 설치했을 때만** 해당한다 (`/plugin marketplace add <로컬 경로>`).
`claude plugin list` 가 이 플러그인을 `failed to load` 로 표시할 수 있는데 실제로는 정상이다 —
`claude plugin details rpg-mode` 는 Hooks (3) 을 보여주고, 새 세션에서 규칙 주입과 XP 지급이
모두 동작하는 것을 확인했다. 소스가 OneDrive/한글 경로일 때 나오는 표시 문제로 보인다.

## 사용

| 명령 | 동작 |
|------|------|
| `/rpg` | 현재 레벨·XP·모드 확인 |
| `/rpg lite` | 헤더와 획득 줄만, 본문은 평범하게 |
| `/rpg off` | 완전 해제 |
| `/rpg full` | 다시 켜기 |
| `/rpg reset` | 누적 XP 를 0 으로 (확인 후 실행) |

## 계급 — 프로젝트가 얼마나 자랐나

세션 시작 때 프로젝트를 측정해 7단계 계급을 매긴다.

`떠돌이 → 마을 주민 → 견습 → 모험가 → 기사 → 성기사 → 용사`
(Wanderer → Villager → Apprentice → Adventurer → Knight → Paladin → Hero)

점수 100점 만점:

| 항목 | 점수 |
|------|------|
| 매니페스트 (package.json, pyproject.toml, Cargo.toml …) | 10 |
| README | 10 |
| 문서 (docs/, CONTRIBUTING.md, CLAUDE.md) | 5 |
| 라이선스 | 5 |
| CI (.github/workflows 등) | 15 |
| 테스트 파일 존재 | 20 |
| 테스트 비율 15% 이상 | 10 |
| 커밋 수 (1 / 5 / 20 / 100 / 500 이상) | 2 / 5 / 8 / 12 / 15 |
| 파일 수 (3 / 10 / 30 / 100 이상) | 2 / 5 / 8 / 10 |

**상한 규칙** — 점수가 높아도 눌린다:
- 테스트가 하나도 없으면 **견습**까지
- 장비 무게가 `무거움` 이상이면 **기사**까지. 짐 진 채로는 용사가 못 된다

## 장비 무게 — 덜어낼 게 쌓였나

| 항목 | 지수 |
|------|------|
| 32KB 넘는 파일 개수 × 8 | 최대 40 |
| 평균 파일 크기 6KB 초과 / 12KB 초과 | 10 / 20 |
| TODO·FIXME·HACK·XXX 5개당 5 | 최대 25 |
| 파일 150개 초과 / 400개 초과 | 8 / 15 |

`0-14 가벼움 · 15-34 적당 · 35-59 무거움 · 60+ 과적재`

무게를 말할 때는 항상 근거를 같이 댄다 — 어떤 파일이 몇 KB인지, TODO 가 몇 개인지.
잠금 파일(package-lock.json 등)과 node_modules·dist 는 세지 않는다.

측정은 파일 크기와 git 메타데이터만 본다. 파일 내용을 읽지 않으므로 빠르다
(3273파일 23MB 저장소에서 380ms). 3초를 넘기면 부분 측정으로 표시한다.

```bash
node hooks/rpg-scan.js [경로]   # 카드를 직접 찍어본다
```

## XP 는 어디서 오나

지어내지 않는다. PostToolUse hook 이 실제 도구 실행 결과만 본다.

| 이벤트 | XP |
|--------|-----|
| 파일 편집 성공 (Edit/Write/MultiEdit) | +10 |
| 테스트 통과 (pytest, jest, vitest, npm test, go test, cargo test …) | +25 |
| 커밋 성공 (`git commit`) | +50 |
| 실패 | 0 — 감점은 없고 연속 카운트만 끊긴다 |

레벨 곡선: 레벨 n → n+1 에 `100 × n` XP. Lv2=100, Lv3=300, Lv4=600 …

## 구조

```
.claude-plugin/plugin.json     플러그인 매니페스트
.claude-plugin/marketplace.json 로컬 마켓플레이스 등록용
hooks/hooks.json               SessionStart / UserPromptSubmit / PostToolUse 배선
hooks/rpg-state.js             상태 저장 + 레벨 계산 (모듈 겸 CLI)
hooks/rpg-scan.js              프로젝트 계급·장비 무게 측정 + 도트아트 (모듈 겸 CLI)
hooks/rpg-activate.js          SKILL.md 를 읽어 규칙 주입
hooks/rpg-xp.js                XP 지급, 레벨업 알림
skills/rpg/SKILL.md            서술 규칙 원본 — 여기만 고치면 된다
tests/rpg-state.test.js        상태 저장 · 레벨 곡선 · 프로젝트 기록
tests/rpg-scan.test.js         계급 · 장비 무게 경계값
tests/rpg-xp.test.js           XP 지급 hook 통합 (실제 프로세스에 페이로드를 흘린다)
package.json                   npm test 진입점 (의존성 0개)
.github/workflows/test.yml     CI — ubuntu · windows 매트릭스
```

상태 파일: `~/.claude/.rpg-state.json`

## 안전 장치

- 코드·에러·경로·명령어는 원문 그대로. 연출은 껍데기만 씌운다.
- **실패를 승리로 포장하지 않는다.** 테스트가 깨지면 `[결과] 패배` 로 쓰고 출력을 붙인다.
- 파괴적 작업 확인, 보안 경고, 순서가 중요한 절차는 연출을 벗고 평문으로.
- HP/MP 같은 건 없다 — 측정할 신호가 없는 수치는 만들지 않는다.
- 계급도 무게도 hook 이 잰 값만 쓴다. 코드가 좋아 보인다고 스스로 올리지 않는다.
- 무게가 무거워도 요청하지 않은 리팩터링은 하지 않는다. 어디가 무거운지 알려주고 멈춘다.
- 계급이 낮은 건 결함이 아니라 출발점이다. 깎아내리지 않는다.
- caveman / ponytail 과 함께 켜져 있으면 RPG 는 틀만 담당하고 본문 스타일은 그쪽을 따른다.

## 테스트

```bash
npm test          # 세 스위트 전부. 하나라도 실패하면 exit 1
```

개별 실행:

```bash
node tests/rpg-state.test.js
node tests/rpg-scan.test.js
node tests/rpg-xp.test.js
```

프레임워크 없음 — `assert` 와 종료 코드뿐이다. CI 는 ubuntu·windows 양쪽에서 `npm test` 를
돌린다. Windows 를 빼면 `commandWindows` 분기와 경로 구분자 처리를 검증하지 못한다.

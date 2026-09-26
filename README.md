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
   ░░▓█▓░░
   ░░▓▓▓░░
   ░▓████▓   계급: 성기사 (Paladin) · 점수 77/100
   ░▓███▓░   규모: 파일 20 · 121KB · 테스트 4 · 커밋 13 · TODO 19
   ░░█░█░░   장비 무게: 적당 (지수 25, 평균 6KB/파일)

장비: 투구 README ✓ · 무기 테스트 ✓ · 방패 CI ✓ · 갑옷 매니페스트 ✓ · 망토 라이선스 ✓ · 장화 문서 ✓
다음 계급: 용사까지 13점 — 릴리스 태그(+5) · 테스트 비율 30%(+4) · CHANGELOG(+3)
```

## 설치

```
/plugin marketplace add Suhwan0818/RPC-Role-playing-Claude-
/plugin install rpg-mode@rpg-mode
```

## statusline

`Lv.3 ███░░░░░ 120/300 *4` 세그먼트는 `hooks/rpg-statusline.js` 가 그린다. 배선은 두 가지.

**statusline 이 아직 없다면** — `~/.claude/settings.json` 에 바로 건다:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/marketplaces/rpg-mode/hooks/rpg-statusline.js"
  }
}
```

**이미 자기 statusline 이 있다면** — `settings.json` 은 `statusLine` 을 하나만 받으므로
기존 스크립트에서 `require` 해 붙인다. 사본을 만들지 않아야 낡지 않는다:

```js
const { rpgSegment } = require('/절대/경로/rpg-mode/hooks/rpg-statusline.js');

const rpg = rpgSegment();      // 색 없는 버전은 rpgSegment({ plain: true })
if (rpg) parts.push(rpg);
```

상태 파일이 없거나 `off` 면 `null` 을 돌려주므로 기존 statusline 동작은 그대로다.
파일이 깨져 있어도 `null` 이다 — statusline 이 이것 때문에 죽지 않는다.

## 알려진 표시 문제

**로컬 directory 마켓플레이스로 설치했을 때만** 해당한다 (`/plugin marketplace add <로컬 경로>`).
`claude plugin list` 가 이 플러그인을 `failed to load` 로 표시할 수 있는데 실제로는 정상이다 —
`claude plugin details rpg-mode` 는 Hooks (4) 을 보여주고, 새 세션에서 규칙 주입과 XP 지급이
모두 동작하는 것을 확인했다. 소스가 OneDrive/한글 경로일 때 나오는 표시 문제로 보인다.

## 사용

| 명령 | 동작 |
|------|------|
| `/rpg` | 현재 레벨·XP·모드 확인 |
| `/rpg lite` | 헤더와 획득 줄만, 본문은 평범하게 |
| `/rpg off` | 완전 해제 |
| `/rpg full` | 다시 켜기 |
| `/rpg log` | 최근 20건의 XP 이벤트 (실패 포함) |
| `/rpg achievements` | 업적 해금 현황과 진행도 |
| `/rpg reset` | 누적 XP 를 0 으로 (확인 후 실행) |
| `/rpg lang en` | 계급 카드·상태줄을 영어로 (`ko` 로 되돌린다) |

`lang` 은 훅이 찍는 라벨에만 걸린다. 서술 언어는 SKILL.md 규칙이 이미 "사용자 언어를
따라간다" 이므로 영어로 물으면 서술도 영어로 나온다. `auto` 는 없다 — 훅에는 사용자
언어를 알려주는 신호가 없고, 없는 신호로 추측하지 않는다.

## 계급 — 프로젝트가 얼마나 자랐나

세션 시작 때 프로젝트를 측정해 7단계 계급을 매긴다.

`떠돌이 → 마을 주민 → 견습 → 모험가 → 기사 → 성기사 → 용사`
(Wanderer → Villager → Apprentice → Adventurer → Knight → Paladin → Hero)

점수 100점 만점. 항목 81점 + 커밋·파일 밴드 19점:

| 항목 | 점수 | 장비 슬롯 |
|------|------|-----------|
| 테스트 파일 존재 | 16 | 무기 |
| CI (.github/workflows 등) | 14 | 방패 |
| README | 8 | 투구 |
| 매니페스트 (package.json, pyproject.toml, Cargo.toml …) | 8 | 갑옷 |
| 테스트 비율 15% 이상 / 30% 이상 | 8 / +4 | |
| 문서 (docs/, CONTRIBUTING.md, CLAUDE.md, AGENTS.md) | 5 | 장화 |
| 릴리스 태그 (`git tag`) | 5 | |
| 최근 커밋 30일 이내 | 4 | |
| 라이선스 | 3 | 망토 |
| `.gitignore` | 3 | |
| CHANGELOG | 3 | |
| 커밋 수 (1 / 5 / 20 / 100 / 500 이상) | 2 / 4 / 7 / 10 / 12 | |
| 파일 수 (3 / 10 / 30 / 100 이상) | 2 / 4 / 6 / 7 | |

**상한 규칙** — 점수가 높아도 눌린다:
- 테스트가 하나도 없으면 **견습**까지
- 장비 무게가 `무거움` 이상이면 **기사**까지. 짐 진 채로는 용사가 못 된다

상한이 걸리면 카드가 남은 점수 대신 상한 이유를 말한다. 점수를 더 벌어도 오르지 않는
상황에서 "3점 남았다" 고 쓰면 거짓말이 되기 때문이다.

점수를 매기는 표(`RANK_ITEMS`)와 "무엇이 빠졌고 몇 점인지" 를 말하는 곳은 같은 한 곳이다.
그래서 `장비:` 줄과 `다음 계급:` 줄은 점수와 어긋날 수 없다.

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

## 도트 그래픽

막대·스파크라인·스프라이트는 `hooks/rpg-dots.js` 한 곳에서 나온다. Block Elements 문자만
쓴다 — 폭이 애매한 문자는 터미널에서 깨진다. 막대 길이는 측정값 비율에서만 나오고,
범위를 벗어난 값은 폭까지 잘린다 (폭보다 긴 막대는 거짓말이다).

```
$ /rpg status
모드: full | Lv.8 ██░░░░░░ 220/800 (누적 2820) | 연속 113
   ░▄███▄░  보스: `npm test` — 연속 실패 6회
   ▓█▒█▒█▓  격파 보너스 +30  █████░░░
   ░▀█▀█▀░
   ░░▓█▓░░
   ░░▓▓▓░░
   ░▓████▓   계급: 성기사 (Paladin) · 점수 77/100 ██████░░
   ░▓███▓░   규모: 파일 21 · 137KB · 테스트 5 · 커밋 16 · TODO 19
   ░░█░█░░   장비 무게: 적당 ██░░░░░░ (지수 25, 평균 7KB/파일)
```

보스 스프라이트는 **살아 있는 보스가 있을 때만** 그린다. 없는 전투를 연출하지 않는다.

```
$ /rpg log
전투 기록 (최근 16건)  ▅▅▇▅▇▅▅█▅▅▅█▅▅█▅
19:12  ✓ Bash   test     +25  ▅
19:10  ✓ Bash   commit   +50  █
19:07  ✗ Bash   test       0  ▁
```

스파크라인은 가장 큰 XP 가 `█` 이 되는 상대 높이다. 실패(0)는 가장 낮은 칸(`▁`)으로
남는다 — 빈칸으로 두면 실패가 지워진다.

```
$ /rpg achievements
업적 5/11  ████░░░░
  ✓ 첫 피
  · 백련 — █░░░░░░░ 11/100
  · 베테랑 — ██████░░ 7/10
```

## 업적 · 보스전 · 전투 기록

전부 실제 카운터에서 나온다. 조건과 진행도가 같은 함수에서 나오므로
해금 판정과 `37/100` 표시가 어긋날 수 없다.

```
/rpg achievements
```

| 업적 | 조건 |
|------|------|
| 첫 피 | 커밋 1회 |
| 검을 벼리다 / 백련 | 테스트 통과 10회 / 100회 |
| 정비공 | 빌드 통과 25회 |
| 기록자 | 커밋 50회 |
| 출항 | PR 생성 1회 |
| 무패 25 / 무패 100 | 최고 연속 25 / 100 |
| 보스 사냥꾼 / 해결사 | 보스 격파 1회 / 5회 |
| 베테랑 | Lv.10 |

**보스전.** 같은 명령이 3회 이상 연속 실패하면 그 명령이 보스가 된다. 마침내 통과하면
격파로 보너스 XP (실패 횟수 × 5, 상한 50). 점수 신호에 걸리는 Bash 명령만 상대한다 —
실패한 `ls` 가 보스가 되면 소음이다. 하루 지난 보스는 폐기한다.

보스전은 실패를 가리는 장치가 **아니다.** 실패는 그대로 실패로 보고되고, 격파 알림은
고치는 데 실제로 든 시도 횟수만 말한다.

**전투 기록.** 최근 20건을 남긴다 (실패 포함). XP 가 어디서 붙었는지 감사할 수 있어야
지어낸 값이 아님이 보인다.

```
$ /rpg log
전투 기록 (최근 4건)
18:40  ✓ Bash   test     +40
18:40  ✗ Bash   test       0
18:40  ✗ Bash   test       0
18:40  ✗ Bash   test       0
```

## XP 는 어디서 오나

지어내지 않는다. PostToolUse hook 이 실제 도구 실행 결과만 본다.

| 이벤트 | XP |
|--------|-----|
| 파일 편집 성공 (Edit/Write/MultiEdit) | +10 |
| lint 통과 (`eslint`, `ruff`, `cargo clippy`, `golangci-lint`, `npm run lint` …) | +10 |
| 빌드 통과 (`npm run build`, `tsc`, `cargo build`, `go build`, `mvn package` …) | +15 |
| 푸시 성공 (`git push`) | +20 |
| 테스트 통과 (`pytest`, `jest`, `vitest`, `npm test`, `go test`, `cargo test` …) | +25 |
| PR 생성 (`gh pr create`) | +40 |
| 커밋 성공 (`git commit`) | +50 |
| 보스 격파 (3회 이상 연속 실패한 명령을 통과) | 보너스 +실패×5 (상한 50) |
| 실패 | 0 — 감점은 없고 연속 카운트만 끊긴다 |

heredoc 본문은 신호 판정에서 제외한다 — 문서나 테스트에 `git commit` 을 적었을 뿐인데
XP 가 붙으면 그건 지어낸 수치다 (실제로 났던 버그다).

Bash 명령은 위 표 순서대로 **먼저 맞는 것 하나만** 센다. `npm run build` 가 테스트로
잘못 잡히지 않도록 빌드를 테스트보다 앞에 두었다.

레벨 곡선: 레벨 n → n+1 에 `100 × n` XP. Lv2=100, Lv3=300, Lv4=600 …

## 구조

```
.claude-plugin/plugin.json     플러그인 매니페스트
.claude-plugin/marketplace.json 로컬 마켓플레이스 등록용
hooks/hooks.json               SessionStart / UserPromptSubmit / PostToolUse / SessionEnd 배선
hooks/rpg-state.js             상태 저장 + 레벨 계산 (모듈 겸 CLI)
hooks/rpg-progress.js          게임 규칙 원본 — 신호표·보스·업적·전투 기록
hooks/rpg-scan.js              프로젝트 계급·장비 무게 측정 + 도트아트 (모듈 겸 CLI)
hooks/rpg-activate.js          SKILL.md 를 읽어 규칙 주입 + 지난 원정 표시
hooks/rpg-xp.js                XP 지급, 레벨업 알림
hooks/rpg-summary.js           SessionEnd — 이번 세션 획득량 기록
hooks/rpg-statusline.js        statusline 세그먼트 (모듈 겸 CLI)
hooks/rpg-dots.js              도트 그래픽 — 막대·스파크라인·보스 스프라이트
hooks/rpg-text.js              훅이 찍는 라벨의 ko/en 표
skills/rpg/SKILL.md            서술 규칙 원본 — 여기만 고치면 된다
tests/rpg-state.test.js        상태 저장 · 레벨 곡선 · 프로젝트 기록
tests/rpg-progress.test.js     신호표 · 보스 수명주기 · 업적 경계값 · 전투 기록
tests/rpg-dots.test.js         막대·스파크라인 경계값
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
npm test          # 다섯 스위트 전부. 하나라도 실패하면 exit 1
```

개별 실행:

```bash
node tests/rpg-state.test.js
node tests/rpg-dots.test.js
node tests/rpg-progress.test.js
node tests/rpg-scan.test.js
node tests/rpg-xp.test.js
```

프레임워크 없음 — `assert` 와 종료 코드뿐이다. CI 는 ubuntu·windows 양쪽에서 `npm test` 를
돌린다. Windows 를 빼면 `commandWindows` 분기와 경로 구분자 처리를 검증하지 못한다.

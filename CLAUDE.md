# rpg-mode — 개발 규약

Claude Code 플러그인. 응답을 RPG 로 서술하고 XP·레벨을 실제로 누적한다.
설치·사용법은 README.md. 여기는 **이 저장소를 고칠 때 지켜야 할 것**만.

## 원본은 하나

서술 규칙은 `skills/rpg/SKILL.md` 뿐이다. `rpg-activate.js` 가 런타임에 읽어 주입한다.
규칙을 바꾸려면 SKILL.md 만 고친다. hook 안에 규칙을 복사해 넣지 않는다
(폴백 문자열은 SKILL.md 를 못 찾았을 때만 쓰는 최소본이고, `rpg-text.js` 표에 있다).

게임 규칙(신호표·업적·보스·전투 기록)은 `hooks/rpg-progress.js` 뿐이다. `rpg-state.js` 는
저장소와 레벨 산식만, `rpg-xp.js` 는 입출력만 담당한다. 의존은 한 줄기여야 한다:

```
rpg-xp → rpg-state → rpg-progress → rpg-text
```

`rpg-progress.js` 에서 `rpg-state.js` 를 require 하면 순환이 생긴다. 하지 말 것 —
평범한 상태 객체를 받아 새 객체를 돌려주는 순수 함수로 유지한다.

훅이 직접 찍는 문구는 전부 `hooks/rpg-text.js` 표에서 온다. 한국어를 코드에 박으면
`/rpg lang en` 이 반쪽이 된다 (실제로 그랬다). 두 언어 표의 키 개수는 같아야 한다.

## hook 규칙

- **세션을 막지 않는다.** 모든 hook 은 실패해도 조용히 exit 0. 상태 파일이 깨졌거나
  없거나 권한이 없어도 세션은 그대로 떠야 한다. try/catch 로 감싼다.
- timeout 5초 안. 네트워크 호출 금지.
- Windows 는 `commandWindows` 를 따로 준다. 빠뜨리면 Windows 에서 조용히 아무 일도 안 난다.
  PowerShell 경로에도 슬래시를 쓴다 — 역슬래시는 JSON 이스케이프 사고를 부른다.
- PostToolUse 는 XP 가 0 이고 연속도 안 변하면 파일을 건드리지 않는다. 디스크 낭비 금지.

## 도트 그래픽은 한 곳에서만 그린다

막대·스파크라인·스프라이트는 `hooks/rpg-dots.js` 뿐이다. statusline 이 자기 막대를 따로
구현하고 있었고, CLI 에 막대를 더 넣으면 세 군데가 된다 — 폭이나 반올림이 어긋나면
같은 XP 가 화면마다 다르게 보인다. `rpg-dots` 는 의존이 없으므로 매 렌더마다 도는
statusline 도 안심하고 쓴다.

Block Elements 범위 문자만 쓴다 (`░▒▓█▁▂▃▄▅▆▇▀▄`). 폭이 애매한 문자는 터미널에서
깨지고 줄이 어긋난다. 이모지는 넣지 않는다.

막대 길이는 측정값 비율에서만 나온다. 범위를 벗어난 값은 폭까지 자른다 — 폭보다 긴
막대는 거짓말이다. 값이 없으면 빈 막대이고, 스파크라인은 빈 문자열이다 (한 칸도 지어내지
않는다). 실패(XP 0)는 가장 낮은 칸으로 남긴다: 빈칸으로 두면 실패가 화면에서 지워진다.

보스 스프라이트는 **살아 있는 보스가 있을 때만** 그린다. 계급 아트와 같은 규칙이다 —
없는 전투를 연출하지 않는다.

## 신호는 명령을 세는 것이지 문자열을 찾는 것이 아니다

`BASH_SIGNALS` 를 명령어 전체에 그대로 대면 안 된다. heredoc 본문에 `git commit` 을
적었을 뿐인데 커밋 XP 가 붙는다 — 이 저장소를 고치는 중에 실제로 `gh pr create` 를
테스트 픽스처에 적었다가 일어나지 않은 PR 에 +40 을 받았다. 문서와 테스트에 명령어를
적는 일은 흔하므로 이건 지어낸 수치와 같다.

`commandText()` 가 heredoc 본문을 걷어낸 뒤 판정한다. 여는 줄은 남긴다 —
`git commit -F - <<MSG` 는 진짜 커밋이다. 셸 파서를 붙이려는 충동은 참을 것:
여러 줄 따옴표 문자열은 여전히 새어 들어올 수 있고, 실제 오탐이 나면 그때 막는다.

## JSON 파일은 스크립트로 쓴다

`hooks.json` 을 셸 heredoc 으로 쓰지 말 것. 백슬래시가 먹혀 `\h` 같은 잘못된 이스케이프가
생기고, 플러그인은 `failed to load` 로 조용히 죽는다 (증상: `claude plugin details` 에
`Hooks (0)`). 반드시 `json.dumps` 같은 직렬화기로 쓰고, 쓴 뒤 다시 파싱해 확인한다.

## 측정은 싸게, 정확히

`rpg-scan.js` 는 **파일 내용을 읽지 않는다.** `statSync` 로 크기만 보고 git 메타데이터를
쓴다. 그래서 3000파일 저장소도 400ms 안에 끝난다. 여기에 파서나 커버리지 실행을 붙이려는
충동을 참을 것 — SessionStart hook 이 느려지면 모든 세션이 느려진다.

예산은 3초. 넘으면 그때까지의 값에 `partial: true` 를 달아 돌려주고, 서술은 "부분 측정"
이라고 밝힌다. 조용히 틀린 값을 주는 것보다 낫다.

git 호출은 네 개다: `ls-files`, `rev-list --count`, `grep`, `tag`, `log -1`.
전부 timeout 을 달고 deadline 검사 안쪽에서 돈다. 못 쟀으면 `null` 로 두고 0 으로
속이지 않는다 (`todos`, `commitAgeDays`). 새 신호를 넣을 때도 같은 규칙을 지킨다.

`--brief`(UserPromptSubmit) 경로에서는 **절대 스캔하지 않는다.** 매 프롬프트마다 도는
hook 이다. 저장된 계급명만 얹는다.

## 계급·무게 규칙을 고칠 때

점수표는 `rpg-scan.js` 의 `RANK_ITEMS` / `weighEquipment()` 한 곳에 모여 있고,
`RANK_ITEMS` 는 점수와 "빠진 항목·슬롯" 을 동시에 낸다 — 점수를 매기는 곳과 무엇이
빠졌는지 말하는 곳이 갈라지면 카드가 점수와 어긋난다. 항목 81점 + 밴드 19점 = 100점이고,
이 합을 깨뜨리면 "점수 103/100" 이 나온다.

구간 이름은 `RANKS` / `WEIGHTS` 배열에 있다. 서술 쪽 표현은 `skills/rpg/SKILL.md`.
숫자를 바꾸면 `tests/rpg-scan.test.js` 의 경계 픽스처가 깨진다 — 그게 의도다.

하드 게이트(테스트 없으면 견습까지, 무거우면 기사까지)는 점수 구간이 모호해지는 걸 막는
장치다. 없애지 말 것. 게이트가 걸리면 `gates` 배열에 이유가 담기고 카드에 표시된다.

## 수치는 지어내지 않는다

XP 는 실제 도구 실행 결과에서만 나온다 (편집 성공, 테스트 통과, 커밋). 측정할 신호가 없는
값은 만들지 않는다 — HP/MP 가 없는 이유다. 서술이 실패를 승리로 포장하면 이 플러그인은
그 순간 해로운 물건이 된다.

보스의 시도 횟수는 실제 실패 횟수고, 업적은 실제 카운터다. 업적은 `at(state)` 하나로
조건과 진행도를 동시에 내야 한다 — 두 곳에 쓰면 "37/100" 과 해금 판정이 어긋난다.
보스전은 실패를 가리는 장치가 아니다. 실패는 그대로 보고하고, 격파는 hook 이 준 값만 쓴다.

## 상태

`~/.claude/.rpg-state.json` 한 파일. `level` 과 `progress` 는 저장돼 있어도 신뢰하지 않고
`xp` 에서 다시 계산한다 (`normalize()`). `progress` 를 저장하는 이유는 statusline 이
레벨 공식을 두 번 구현하지 않게 하려는 것뿐이다.

`projects` 는 프로젝트 경로별 마지막 계급·무게 구간으로, 다음 세션에서 승급/강등을
감지하는 데만 쓴다. 최근 20개만 남긴다. **키는 반드시 `projectKey()` 로 만든다** —
날것의 경로를 쓰면 `C:/x` 와 `C:\x` 가 다른 항목이 되어 가짜 승급이 나온다 (실제로 났다).
`path.resolve` 는 쓰지 말 것: POSIX 에서 `C:/x` 가 상대 경로로 해석돼 cwd 가 붙는다.

`session` 기준선은 SessionStart 가 잡고 SessionEnd 만 비운다. **이미 살아 있으면 덮어쓰지
않는다** — compact/clear 로 SessionStart 가 다시 돌면 그 전에 번 XP 가 요약에서 사라진다
(SessionEnd 는 async 라 순서도 보장되지 않는다). 죽은 세션은 12시간 만료로 정리한다.

`counts`·`best`·`achievements`·`boss`·`log` 는 게임 요소용이다. 전부 `rpg-progress.js` 의
normalize 헬퍼를 거친다. `log` 는 20건 링 버퍼 — 상한을 늘리면 상태 파일이 무거워진다.

## 고치기 전에

```bash
node tests/rpg-state.test.js      # 프레임워크 없음. 실패하면 exit 1
node tests/rpg-dots.test.js       # 막대·스파크라인 경계값
node tests/rpg-progress.test.js   # 신호표·보스·업적 경계값
node tests/rpg-scan.test.js       # 계급·무게 경계값
node tests/rpg-xp.test.js         # 훅 통합 (실제 프로세스에 페이로드를 흘린다)
npm test                          # 위 다섯 개 전부
```

hook 을 만졌으면 실제로 다시 설치해서 확인한다. `claude plugin details rpg-mode` 가
`Hooks (4)` 을 보여야 한다.

```bash
claude plugin marketplace update rpg-mode
claude plugin uninstall rpg-mode@rpg-mode && claude plugin install rpg-mode@rpg-mode
```

## statusline

표시부는 이 저장소 밖 `~/.claude/statusline.js` 의 `rpgSegment()` 에 있다.
settings.json 은 statusLine 을 하나만 받으므로 별도 스크립트를 만들지 않았다.
백업: `~/.claude/statusline.js.bak`

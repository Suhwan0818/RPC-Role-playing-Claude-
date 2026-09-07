# rpg-mode — 개발 규약

Claude Code 플러그인. 응답을 RPG 로 서술하고 XP·레벨을 실제로 누적한다.
설치·사용법은 README.md. 여기는 **이 저장소를 고칠 때 지켜야 할 것**만.

## 원본은 하나

서술 규칙은 `skills/rpg/SKILL.md` 뿐이다. `rpg-activate.js` 가 런타임에 읽어 주입한다.
규칙을 바꾸려면 SKILL.md 만 고친다. hook 안에 규칙을 복사해 넣지 않는다
(폴백 문자열은 SKILL.md 를 못 찾았을 때만 쓰는 최소본이다).

## hook 규칙

- **세션을 막지 않는다.** 모든 hook 은 실패해도 조용히 exit 0. 상태 파일이 깨졌거나
  없거나 권한이 없어도 세션은 그대로 떠야 한다. try/catch 로 감싼다.
- timeout 5초 안. 네트워크 호출 금지.
- Windows 는 `commandWindows` 를 따로 준다. 빠뜨리면 Windows 에서 조용히 아무 일도 안 난다.
  PowerShell 경로에도 슬래시를 쓴다 — 역슬래시는 JSON 이스케이프 사고를 부른다.
- PostToolUse 는 XP 가 0 이고 연속도 안 변하면 파일을 건드리지 않는다. 디스크 낭비 금지.

## JSON 파일은 스크립트로 쓴다

`hooks.json` 을 셸 heredoc 으로 쓰지 말 것. 백슬래시가 먹혀 `\h` 같은 잘못된 이스케이프가
생기고, 플러그인은 `failed to load` 로 조용히 죽는다 (증상: `claude plugin details` 에
`Hooks (0)`). 반드시 `json.dumps` 같은 직렬화기로 쓰고, 쓴 뒤 다시 파싱해 확인한다.

## 수치는 지어내지 않는다

XP 는 실제 도구 실행 결과에서만 나온다 (편집 성공, 테스트 통과, 커밋). 측정할 신호가 없는
값은 만들지 않는다 — HP/MP 가 없는 이유다. 서술이 실패를 승리로 포장하면 이 플러그인은
그 순간 해로운 물건이 된다.

## 상태

`~/.claude/.rpg-state.json` 한 파일. `level` 과 `progress` 는 저장돼 있어도 신뢰하지 않고
`xp` 에서 다시 계산한다 (`normalize()`). `progress` 를 저장하는 이유는 statusline 이
레벨 공식을 두 번 구현하지 않게 하려는 것뿐이다.

## 고치기 전에

```bash
node tests/rpg-state.test.js      # 프레임워크 없음. 실패하면 exit 1
```

hook 을 만졌으면 실제로 다시 설치해서 확인한다. `claude plugin details rpg-mode` 가
`Hooks (3)` 을 보여야 한다.

```bash
claude plugin marketplace update rpg-mode
claude plugin uninstall rpg-mode@rpg-mode && claude plugin install rpg-mode@rpg-mode
```

## statusline

표시부는 이 저장소 밖 `~/.claude/statusline.js` 의 `rpgSegment()` 에 있다.
settings.json 은 statusLine 을 하나만 받으므로 별도 스크립트를 만들지 않았다.
백업: `~/.claude/statusline.js.bak`

# Contributing Guide

이 저장소의 작업 단위는 `Issue -> Plan -> Commit -> PR` 순서를 기본으로 한다.

## 1) Issue 규칙

- 작업 시작 전 관련 GitHub Issue를 만든다.
- 이미 유사 이슈가 있어도, 작업 추적을 위해 현재 작업용 이슈를 별도로 만들어도 된다.
- 이슈 제목과 본문은 한국어로 작성한다.
- 이슈에는 목적, 범위, 완료 조건(Definition of Done)을 포함한다.

## 2) Commit 규칙

- 기본 규칙은 Conventional Commits를 따른다.
- 커밋 메시지는 한국어를 사용한다.
- `scope`는 반드시 이슈 번호를 사용한다.
- 형식:

```text
<type>(#<issue_number>): <한국어 요약>
```

- 예시:

```text
feat(#123): LH 공고 필터에 자동차 소유 조건 추가
fix(#124): 소득 기준 비교 로직의 경계값 오류 수정
docs(#125): AGENTS.md 응답 규칙 정리
```

- 허용 `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `revert`

## 3) 브랜치 전략

- 브랜치는 이슈 단위로 생성한다.
- 네이밍 형식:

```text
<prefix>/#<issue_number>/<summary>
```

- `prefix`는 커밋 `type`과 동일하게 사용한다 (`feat`, `fix`, `docs`, `chore` 등).
- 예시:

```text
feat/#3/add-filter-logic
fix/#12/income-boundary-error
docs/#5/update-contributing
```

- `main` 브랜치에 직접 커밋하지 않는다. 반드시 PR을 통해 병합한다.

## 4) PR 규칙

- PR은 하나 이상의 이슈를 반드시 연결한다.
- PR 제목/본문은 한국어로 작성한다.
- PR 설명에 아래를 포함한다.
- 변경 목적
- 핵심 변경점
- 테스트/검증 결과
- 영향 범위(있다면)

## 5) 권장 작업 흐름

1. 이슈 생성
2. 구현 계획 수립(필요 시 `docs/plans/`에 문서화)
3. 이슈 번호로 브랜치 생성: `git checkout -b <prefix>/#<issue_number>/<summary>`
4. 이슈 번호를 scope로 커밋
5. PR 생성 후 이슈 연결

## 6) 자동 검증

- 저장소는 `.github/workflows/commitlint.yml`로 커밋 메시지를 검사한다.
- 로컬에서도 아래처럼 사전 확인할 수 있다.

```bash
npx commitlint --from HEAD~1 --to HEAD
```

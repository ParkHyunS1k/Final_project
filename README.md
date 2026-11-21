# ProjectMate

**혼자 또는 2~4인 팀이 7일 안에 작은 프로젝트를 완주하도록 돕는 웹 서비스.**

목표·완료 기준을 합의하고, 업무를 나눠 체크인하면 서버가 남은 공수로 일정을 다시 계산해 병목을 보여준다. 끝나면 팀원끼리 동료평가를 하고 등급·뱃지가 마이페이지와 공개 프로필에 쌓인다. 연구가 아니라 서비스 개발이 목적이다.

- **운영 주소:** https://projectmate-parkhyuns1ks-projects.vercel.app

## 지금 되는 것

| 영역 | 기능 |
|---|---|
| 시작 | Google 로그인, 주사위·템플릿 20개로 프로젝트 만들기, 범위 슬라이더(핵심만·검증까지·확장까지), 혼자 시작 또는 팀으로 시작 |
| 팀 | 이메일 지정 초대(최대 4명), 공개 팀 목록('팀 찾기')에서 참여 신청 → 팀장 승인, 팀장/팀원 권한, 목표 버전별 재동의 |
| 진행 | 업무 생성·편집·담당 배정·의존관계, 체크인 → 일정 재계산·병목 표시, 승인된 업무 마감, 3~7일 마감(만들 때 고른 기간, 기본 7일, 시작 시각 기준·서버 시각) |
| AI 변경안 | 회의록 등 원문 붙여넣기 또는 공개 GitHub 저장소 이슈 가져오기 → 모델 변경안 → 검토·부분 승인·되돌리기 (사용자당 하루 10회) |
| 완주 | 완료 근거 기록과 팀장 확인으로 완주, 기한 종료 처리, 변경 기록 |
| 평가·프로필 | 종료 후 24시간 동료평가(5점제, 등급 S~D·계정 E, 뱃지 8개), 미제출 제재(7일·30일·영구), 마이페이지(활동·이력서·역량·경험·포트폴리오·설정), 본인이 켠 경우만 공개 프로필 `/u/<아이디>`와 공유 카드 |
| 기타 | 공고 찾기(Jooble), GitHub 계정 연결, 학습 기록(연속 학습일·학습한 날) |

**아직 없는 것:** 자동 팀 매칭, 실제 결제·환급, 메일 알림(초대 메일 제외, 제품에서 뺐다). 학습 확인(`/api/review`)은 API만 있고 화면이 없다. 일정·병목·상태 판정은 모두 규칙 계산이며 LLM은 AI 변경안·학습 확인·이력서 분석에만 쓴다.

## 로컬에서 실행하기

### 1. 준비물

- **Node.js 22.16 이상** (테스트·스크립트가 `--experimental-strip-types`를 쓴다)
- DB 설치는 필요 없다. `DATABASE_URL`을 비우면 내장 PGlite(`web/.data/pglite`)를 쓴다.
- Google 로그인까지 하려면 **Supabase 프로젝트**가 필요하다(무료 플랜으로 충분). 로그인 없이 API만 확인하려면 [4-B](#4-b-로그인-없이-개발-헤더로-확인)를 따른다.

### 2. 설치와 DB 준비

```bash
git clone https://github.com/ParkHyunS1k/Final_project.git
```

```bash
cd Final_project/web
```

```bash
npm ci
```

```bash
cp .env.example .env.local
```

```bash
npm run db:migrate
```

`db:migrate`는 처음 한 번, 그리고 `web/db/migrations/`에 새 파일이 생길 때마다 **개발 서버를 끈 상태에서** 실행한다(PGlite는 한 프로세스만 열 수 있다). 앱은 자동으로 마이그레이션하지 않는다. 출력에 `applied`가 찍히는지 확인한다.

### 3. 환경변수 (`web/.env.local`)

`.env.local`은 커밋하지 않는다. 비밀값은 서버 전용이며 `NEXT_PUBLIC_`을 붙이지 않는다.

| 변수 | 필요할 때 | 비우면 |
|---|---|---|
| `SUPABASE_URL` | 로그인(서버 토큰 검증) | 로그인 불가 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 로그인(화면). 공개돼도 되는 값 | 로그인 버튼이 오류 |
| `DATABASE_URL` | Supabase Postgres를 쓸 때(Connection pooling, Transaction mode 6543 주소) | 로컬 PGlite 사용. **운영 빌드(`next start`)에서는 필수**, 없으면 API 503 |
| `DATABASE_PATH` | PGlite 경로를 바꿀 때 | `.data/pglite` |
| `PROJECTMATE_LIVE_MODEL=1` + `OPENAI_API_KEY` | AI 변경안·학습 확인을 실제 모델로 | 화면에 '준비 중'. 개발 서버에서는 `.env.development`의 `AI_FAKE_MODEL=1`이 가짜 모델로 대신한다 |
| `OPENAI_API_KEY` 단독 | 이력서 AI 분석 | 기본 키워드 추출만 |
| `PROJECTMATE_MODEL`, `CAREERFLOW_MODEL` | 모델 이름을 바꿀 때 | 서비스 기본값 |
| `JOOBLE_API_KEY` | 공고 찾기 | '준비 중' |
| `EMAIL_PROVIDER=gmail`, `EMAIL_FROM`, `EMAIL_API_KEY`(Google 앱 비밀번호) | 초대 링크 메일 발송 | 메일 대신 화면에 초대 링크만 표시 |
| `GITHUB_TOKEN` | 공개 저장소 조회 호출 한도 완화 | 비로그인 GitHub API 한도 |
| `CRON_SECRET` | 프로필 점수 일괄 계산(`/api/internal/profile-scores`) | 실행 거절. 로컬에서는 보통 필요 없다 |

`web/.env.development`(커밋됨)는 `next dev`에서만 읽히며 `AUTH_DEV_HEADERS=1`, `AI_FAKE_MODEL=1`을 켠다. 운영에서는 둘 다 무시된다.

### 4-A. Google 로그인으로 실행

1. Supabase 대시보드 → Authentication → Providers에서 **Google**을 켠다(Google Cloud OAuth 클라이언트 ID·Secret 필요).
2. Authentication → URL Configuration의 Redirect URLs에 `http://localhost:*/**`와 `http://127.0.0.1:*/**`를 추가한다.
3. Project Settings → API의 URL과 anon key를 위 세 변수에 넣는다.
4. (선택) GitHub 계정 연결을 쓰려면 GitHub OAuth App을 만들고 Supabase의 GitHub 공급자와 Manual Linking을 켠다.
5. 마이그레이션을 이미 했다면 개발 서버를 켠다.

```bash
npm run dev
```

http://localhost:3000 → 시작하기 → Google 로그인 → `/app` 홈. 두 번째 Google 계정을 초대하면 팀 흐름을 확인할 수 있다.

### 4-B. 로그인 없이 개발 헤더로 확인

Supabase 없이도 개발 서버는 `oai-authenticated-user-id`, `oai-authenticated-user-email` 헤더를 로그인 대신 받는다. 가상 팀(프로젝트 생성 → 초대 → 수락 → 목표 합의 → 시작)을 API로 만드는 시드 스크립트가 있다. 개발 서버를 켠 채 다른 터미널의 `web/`에서 실행한다.

```bash
node scripts/seed-dev-team.mjs --base-url http://localhost:3000
```

주소는 `localhost`로 쓴다. 개발 서버는 요청 주소를 `localhost`로 보므로 `127.0.0.1`로 열면 쓰기 요청이 출처 검사(403)에 걸린다.

자세한 내용은 [docs/dev-team-seed-notes.md](docs/dev-team-seed-notes.md). 화면 로그인은 4-A가 필요하다.

### 5. 검증

`web/`에서:

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

테스트는 PGlite를 쓰므로 키가 없어도 돈다.

## 폴더

| 경로 | 내용 |
|---|---|
| `web/app`, `web/components` | 화면과 API 라우트(`app/api/*`) |
| `web/lib` | 서버 로직: 일정 계산, 권한, 점수(`score.ts`, `profile-score.ts`), AI 어댑터 |
| `web/db` | 스키마와 SQL 마이그레이션(`0000`~`0015`) |
| `web/tests` | Node 내장 테스트 러너 테스트 |
| `server/`, `tests/` | 기존 Python 엔진과 테스트(웹과 연결 안 됨) |
| `careerflow/` | 별도 로컬 Python 앱. 기능은 웹 마이페이지·공고 찾기로 옮겨졌고 원본은 보존. [CAREERFLOW.md](CAREERFLOW.md) |
| `datasets/`, `eval/`, `evals/` | 과거 평가 자료 |

기존 Python 엔진 테스트(Python 3.11 이상):

```bash
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -m unittest discover -s tests
```

## 문서

- [개발 기준](CLAUDE.md) — 제품 범위와 사용자 결정의 기준 문서
- [통합 앱 화면·규칙](docs/unified-app.md)
- [기능·운영 흐름](docs/features.md)
- [웹 API·배포 상세](web/README.md)
- [현재 스프린트](docs/current-sprint.md) · [품질 기준](docs/eval.md)
- 기능별 설계: [docs/superpowers/specs/](docs/superpowers/specs/)

과거 연구 중심 계획은 `docs/archive/`에 보관하며 현재 개발 지시로 쓰지 않는다.

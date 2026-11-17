# 공개 프로필과 자랑 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하루 한 번 계산한 프로필 점수·등급·상위 %를 마이페이지에 보이고, 본인이 켠 공개 프로필(`/u/<아이디>`)과 자랑 카드 이미지로 공유하게 한다.

**Architecture:** 산정식은 순수 함수(`lib/profile-score.ts`)에 버전과 함께 두고, 매일 Vercel Cron이 내부 경로로 모든 멤버의 점수를 `profile_scores`에 저장한다. 화면·카드·공개 프로필은 저장값만 읽는다. 공개 설정은 `public_profiles`에 두고, 공개 페이지와 카드 이미지(`next/og`)는 로그인 없이 저장값과 본인 기록만 보인다.

**Tech Stack:** Next.js 16 (web/), Postgres(Supabase 운영·PGlite 로컬/테스트), drizzle 스키마·마이그레이션, `node:test` + esbuild 번들, `react-dom/server` 렌더 테스트, `next/og` ImageResponse.

**Spec:** `docs/superpowers/specs/2026-11-17-profile-share-design.md`

## Global Constraints

- 작업 위치는 `web/`. 테스트 `npm test`, 타입 `node node_modules/typescript/bin/tsc --noEmit --incremental false`, 린트는 바꾼 파일만 `./node_modules/.bin/oxlint <files>`(react-compiler·jsx-a11y 규칙 포함, eslint-disable 주석 금지).
- 새 테스트 파일은 `package.json`의 `test` 목록 끝에 추가한다.
- 모든 새 표는 `.enableRLS()`(정책 없음), 서버만 접근. 스키마는 `db/schema.ts`에 쓰고 `npm run db:generate -- --name public_profile`로 `db/migrations/0015_public_profile.sql`을 만든다(`tests/schema-migrations.test.mjs`가 일치를 검사).
- 운영 DB 마이그레이션은 머지 전에 사용자가 브랜치 작업 공간의 `web/`에서 `node --env-file=/Users/parkhyunsik/파이썬/Final_project/web/.env.local --experimental-strip-types scripts/migrate.ts`로 적용하고 `applied:`를 확인한다. 에이전트는 운영 DB에 쓰지 않는다.
- 등급 하한은 기존 `gradeOf`(4.8 S, 4.0 A, 3.0 B, 2.0 C, 그 아래 D). 점수 없으면 `'E'`.
- 상위 % = `max(1, ceil((순위 − 1) / 전체 × 100))`, 순위 = 같은 산정식 버전에서 나보다 점수가 높은 사람 수 + 1. 최소 인원 없음.
- 산정식 v1 버전 문자열은 `'v1'`, 점수 = 공개됐고 가려지지 않은 프로젝트별 내 점수 평균(소수 첫째 자리 반올림), 없으면 `null`.
- 일괄 계산: 매일 03:00 KST = `vercel.json` cron `"0 18 * * *"`(UTC), 경로 `/api/internal/profile-scores`(GET), `Authorization: Bearer ${CRON_SECRET}`만 허용.
- 아이디: 앞뒤 공백 제거·소문자화 후 `^[a-z0-9_-]{3,20}$`, 예약어 `app, api, admin, u, new, settings, login, logout, me, profile, projectmate, www` 거절. 프로필 이름 1~30자.
- 공개 기본 꺼짐. 꺼졌거나 없는 아이디는 페이지·이미지 모두 404(존재 여부를 알리지 않음), 캐시하지 않는다(`dynamic = 'force-dynamic'`, `Cache-Control: no-store`).
- 공개 응답·카드에 팀원 이름·점수·개별 평가를 넣지 않는다. 숨긴 항목·참여 중단 프로젝트·'재확인 필요' 경험·진행 중 프로젝트는 넣지 않는다. 완료 근거는 업무마다 켠 것만.
- 화면 문구는 해요체. 구현하지 않은 것을 기능으로 설명하지 않는다.
- 커밋 끝줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. 공개를 끈 직후 같은 링크·미리보기 이미지·스토리 이미지가 바로 404가 되는지(캐시된 응답이 남지 않는지) — Task 6·7 테스트.
2. 숨김 목록에 남의 프로젝트·경험 id를 넣어 보내도 저장되지 않고 오류 없이 걸러지는지 — Task 4 테스트.
3. 공개 프로필 응답(JSON·HTML)에 팀원 표시 이름이 문자열로라도 들어가지 않는지 — Task 5 테스트.
4. 동률·혼자·다른 산정식 버전 저장값이 섞인 상위 % — Task 1·3 테스트.
5. `"  Harin "`처럼 대문자·공백이 섞인 아이디, 이미 쓰는 아이디, 동시 저장(같은 version 두 번) — Task 4 테스트.

---

### Task 1: 산정식과 상위 % (순수 함수)

**Files:**
- Create: `web/lib/profile-score.ts`
- Test: `web/tests/profile-score.test.ts`

**Interfaces:**
- Consumes: `gradeOf(score: number | null): Grade | null` (`lib/score.ts`)
- Produces:
  - `export const PROFILE_FORMULA = 'v1'`
  - `export type ProfileGrade = Grade | 'E'`
  - `export function profileScore(projects: { score: number | null }[]): number | null`
  - `export function profileGrade(score: number | null): ProfileGrade`
  - `export function topPercent(rank: number, total: number): number`

- [ ] **Step 1: 실패하는 테스트**

```ts
test('v1 점수: 공개된 프로젝트 점수 평균, 없으면 null', () => {
  assert.equal(profileScore([{ score: 4.5 }, { score: null }, { score: 4.0 }]), 4.3); // 4.25 → 반올림
  assert.equal(profileScore([{ score: null }]), null);
  assert.equal(profileScore([]), null);
});
test('등급: 기존 하한, 점수 없으면 E', () => {
  assert.equal(profileGrade(4.8), 'S'); assert.equal(profileGrade(4.5), 'A');
  assert.equal(profileGrade(1.5), 'D'); assert.equal(profileGrade(null), 'E');
});
test('상위 %: 1등은 1%, 동률은 같은 값, 꼴찌', () => {
  assert.equal(topPercent(1, 1), 1);
  assert.equal(topPercent(1, 100), 1);
  assert.equal(topPercent(13, 100), 12);
  assert.equal(topPercent(2, 2), 50);
  assert.equal(topPercent(100, 100), 99);
});
```

- [ ] **Step 2: 실행해 실패 확인** — `node --experimental-strip-types --test tests/profile-score.test.ts` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — 위 시그니처. `profileScore`는 null 아닌 점수 평균을 `Math.round(x * 10) / 10`.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat: 프로필 산정식 v1과 상위 % 계산`, 테스트 파일을 `package.json` test 목록에 추가해 함께 커밋.

### Task 2: 표 추가 (스키마·마이그레이션)

**Files:**
- Modify: `web/db/schema.ts` (끝에 추가)
- Create: `web/db/migrations/0015_public_profile.sql`, `web/db/migrations/meta/0015_snapshot.json`, `meta/_journal.json` 갱신(모두 `db:generate` 결과)
- Test: `web/tests/schema-migrations.test.mjs`(기존)

**Interfaces:**
- Produces 표:
  - `profile_scores(user_id text PK, score double precision NULL, grade text NOT NULL, formula_version text NOT NULL, computed_at timestamptz NOT NULL)`, 인덱스 `(formula_version, score)`.
  - `public_profiles(user_id text PK, handle text NOT NULL UNIQUE, display_name text NOT NULL, enabled boolean NOT NULL DEFAULT false, show_github boolean NOT NULL DEFAULT false, hidden_projects jsonb NOT NULL DEFAULT '[]', hidden_experiences jsonb NOT NULL DEFAULT '[]', shown_evidence jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL)`.
  - `public_profile_events(id text PK, user_id text NOT NULL, action text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())` — action: `create | update | enable | disable | handle`.
  - drizzle 이름: `profileScores`, `publicProfiles`, `publicProfileEvents`, 모두 `.enableRLS()`.

- [ ] **Step 1:** 스키마 작성 후 `npm run db:generate -- --name public_profile`.
- [ ] **Step 2:** `node --test tests/schema-migrations.test.mjs` PASS, 생성된 SQL에 `ENABLE ROW LEVEL SECURITY` 3개 확인.
- [ ] **Step 3: 커밋** — `feat: 프로필 점수·공개 프로필 표`.

### Task 3: 점수 요약을 userId로 계산하고 매일 일괄 저장

**Files:**
- Modify: `web/lib/projects.ts` — `listProjects`의 SELECT·변환을 `export async function projectRows(userId: string)`로 빼고, `listProjects(user)`는 `adoptLegacy(user)` 뒤 `projectRows(user.id)`를 돌려준다.
- Modify: `web/lib/score-store.ts` — `readMyScore` 본문을 `export async function scoreSummary(userId: string, now: Date)`로 빼고 `readMyScore(user, now)`는 `listProjects(user)`(이전 기록 가져오기) 뒤 `scoreSummary(user.id, now)` + 아래 `profile`을 돌려준다.
- Create: `web/lib/profile-store.ts`
- Create: `web/app/api/internal/profile-scores/route.ts`
- Modify: `web/vercel.json`
- Test: `web/tests/score-api.test.mjs`(확장)

**Interfaces:**
- Consumes: Task 1 함수, Task 2 표.
- Produces:
  - `scoreSummary(userId, now)` → 지금 `readMyScore` 결과와 같은 모양(`bestGrade, average, badges, history, …`).
  - `export async function refreshAllProfileScores(now: Date): Promise<{ users: number }>` — `SELECT DISTINCT user_id FROM project_members`의 모든 사용자에 대해 `scoreSummary`의 history 점수로 `profileScore` → `profile_scores` upsert(`grade = profileGrade`, `formula_version = PROFILE_FORMULA`, `computed_at = now`). 사용자별 순차 처리(`// ponytail: 순차, 사용자가 많아지면 묶음 병렬`).
  - `export async function profileStanding(userId: string): Promise<ProfileStanding | null>` — 같은 버전 저장값 없으면 null. `type ProfileStanding = { score: number | null; grade: ProfileGrade; percentile: number | null; total: number; computedAt: string }` (점수 null이면 percentile null).
  - `readMyScore` 결과에 `profile: ProfileStanding | null` 추가.
  - 내부 경로 `GET /api/internal/profile-scores`: `CRON_SECRET` 미설정·불일치면 401(`reminders` 경로의 `sameSecret` 방식), 성공 `{ users }`, 실패 503. `export const maxDuration = 300`.
  - `vercel.json`: `"crons": [{ "path": "/api/internal/profile-scores", "schedule": "0 18 * * *" }]`.

- [ ] **Step 1: 실패하는 테스트(score-api)** — 완주 팀 테스트 끝에:

```js
// 일괄 계산 전에는 profile이 없다.
assert.equal((await me('lead')).profile, null);
const run = await api.cronGET(new Request('https://test.local/api/internal/profile-scores', { headers: { authorization: 'Bearer test-cron' } }));
assert.equal(run.status, 200);
const p = (await me('lead')).profile;
assert.equal(p.score, 4.5); assert.equal(p.grade, 'A');
assert.ok(p.percentile >= 1 && p.total >= 2);
assert.equal((await me('m1')).profile.percentile, 1); // 이 팀에서 최고점(4.8)
assert.equal((await me('m3')).profile.score, null); // 참여 중단: 점수 없음
assert.equal((await me('m3')).profile.percentile, null);
// 비밀값이 없거나 틀리면 401
assert.equal((await api.cronGET(new Request('https://test.local/api/internal/profile-scores'))).status, 401);
```

  테스트 상단에 `process.env.CRON_SECRET = 'test-cron'`, 번들 진입점에 `export { GET as cronGET } from './app/api/internal/profile-scores/route';` 추가. 동률·버전 테스트: `run('UPDATE profile_scores SET formula_version=? WHERE user_id=?', 'v0', 'm2')` 뒤 `profileStanding`의 total이 1 줄어드는지, 같은 점수 두 명의 percentile이 같은지.
  결과가 가려진 사용자(기존 '내지 않은 사람은 결과가 가려지고' 테스트의 미제출자)의 `profile.score === null`.
- [ ] **Step 2:** `node --experimental-strip-types --test tests/score-api.test.mjs` FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 같은 명령 PASS, `node --experimental-strip-types --test tests/hub.test.mjs tests/teams.test.mjs` PASS(`listProjects` 리팩터 확인).
- [ ] **Step 5: 커밋** — `feat: 프로필 점수 매일 일괄 계산과 상위 %`.

### Task 4: 공개 프로필 설정 API

**Files:**
- Modify: `web/lib/profile-store.ts`
- Create: `web/app/api/profile/route.ts`
- Test: `web/tests/profile-api.test.mjs`(새로, `score-api.test.mjs`의 번들·헤더·팀 만들기 도우미를 같은 방식으로)

**Interfaces:**
- Produces:
  - `export function normalizeHandle(value: unknown): string` — trim·소문자, 규칙 위반·예약어면 `PolicyError('아이디는 영문 소문자·숫자·-·_ 3~20자로 정해주세요.', 400)` / `PolicyError('쓸 수 없는 아이디예요.', 400)`.
  - `export async function readProfileSettings(user: Identity)` → `{ settings: { handle, displayName, enabled, showGithub, hiddenProjects: string[], hiddenExperiences: string[], shownEvidence: string[], version } | null, defaults: { displayName: user.name }, github: string | null, projects: { id, title }[] /* 완주·참여 중 */, experiences: { id, title }[] /* valid */ }`.
  - `export async function saveProfileSettings(user: Identity, b: Record<string, unknown>)` → 저장된 settings. `b.version`이 현재와 다르면(새로 만들 때는 0) `Conflict`(409 '다른 곳에서 바뀌었어요. 다시 불러와 주세요.'). 아이디 중복은 409 '이미 쓰는 아이디예요.'. 숨김·근거 id는 `readProfileSettings`의 projects·experiences에 있는 것만 남긴다(나머지는 조용히 버림). `showGithub`은 연결된 계정이 있을 때만 true로 저장. 설정 변경과 `public_profile_events` 기록을 한 트랜잭션(batch)으로.
  - `GET /api/profile`, `POST /api/profile { action: 'save', … }` — 로그인 필수, Origin 검사·JSON 형식 검사는 `app/api/score/route.ts` POST와 같은 방식.

- [ ] **Step 1: 실패하는 테스트** — 이름·단언:
  - `'아이디는 정리해 저장하고 형식·예약어·중복을 거절한다'`: `"  Harin "` → `harin`; `'ab'`, `'한글'`, `'admin'` → 400; 다른 사용자가 `harin` → 409.
  - `'숨김 목록은 내 것만 남긴다'`: 남의 프로젝트 id·없는 경험 id를 섞어 보내면 저장값에 내 id만 있다, 상태 200.
  - `'같은 version으로 두 번 저장하면 두 번째는 409'`.
  - `'GitHub을 연결하지 않았으면 showGithub은 false로 저장된다'`.
  - `'저장하면 기록이 남는다'`: `public_profile_events`에 `create`, 켜면 `enable`, 아이디 바꾸면 `handle`.
  - `'로그인하지 않으면 401, 다른 Origin이면 403'`.
- [ ] **Step 2:** `node --experimental-strip-types --test tests/profile-api.test.mjs` FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: 커밋** — `feat: 공개 프로필 설정 API`, 테스트를 `package.json`에 추가.

### Task 5: 공개 프로필 데이터

**Files:**
- Modify: `web/lib/profile-store.ts`
- Test: `web/tests/profile-api.test.mjs`

**Interfaces:**
- Produces: `export async function readPublicProfile(handle: string, now: Date): Promise<PublicProfile | null>` — 아이디가 없거나 `enabled=false`면 null.

```ts
type PublicProfile = {
  handle: string; displayName: string; target: string /* TARGETS 이름, 없으면 '' */;
  github: string | null;               // showGithub && 연결된 경우만
  standing: ProfileStanding | null;    // Task 3 저장값
  finished: number; streak: number; dates: string[]; // learningStats(…) 최근 84일
  badges: { id: string; label: string; count: number }[]; // 받은 것만
  projects: { id: string; title: string; startedAt: string | null; deadlineAt: string | null; members: number; role: 'owner' | 'member' | 'solo'; grade: Grade | null }[];
  experiences: { id: string; projectTitle: string | null; title: string; bullet: string; skills: string[]; evidence: string | null }[];
};
```

  projects = `scoreSummary(userId).history` 중 `lifecycle==='completed' && !left && !hidden`, `members`는 참여 중 인원, 1명이면 role `'solo'`. experiences = `readExperiences` 중 `valid && !hidden`, `evidence`는 `shownEvidence`에 있을 때만. 학습 기록은 `hub_records`의 checkin으로 `learningStats`.

- [ ] **Step 1: 실패하는 테스트**
  - `'꺼진 프로필과 없는 아이디는 null'`.
  - `'완주한 프로젝트만, 참여 중단·진행 중·숨긴 프로젝트는 빠진다'`.
  - `'재확인 필요 경험과 숨긴 경험은 빠지고, 근거는 켠 것만 보인다'`.
  - `'팀원 표시 이름은 응답 어디에도 없다'`: `JSON.stringify(profile)`에 팀원 이름 문자열이 없다(`assert.doesNotMatch`).
  - `'숫자는 저장값(standing)과 같다'`: 일괄 계산 후 `profile.standing`이 `me()`의 `profile`과 같다.
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: 커밋** — `feat: 공개 프로필 데이터`.

### Task 6: 공개 프로필 페이지 `/u/<아이디>`

**Files:**
- Create: `web/components/public-profile.tsx` — `export function PublicProfileView({ profile, now }: { profile: PublicProfile; now: Date })` (마이페이지 `studyCalendar`·`stateLabel` 재사용, `app.css` 토큰 사용)
- Create: `web/app/u/[handle]/page.tsx` — `dynamic = 'force-dynamic'`, `readPublicProfile` null이면 `notFound()`. `generateMetadata`: 제목 `"<이름> · ProjectMate"`, 설명 "7일 스프린트 기록", `robots: { index: false }`(검색 노출은 막고 링크 공유만).
- Create: `web/app/u/u.css`
- Test: `web/tests/public-profile-render.test.mjs`(새로)

- [ ] **Step 1: 실패하는 렌더 테스트**
  - 요약: 이름·목표·등급 글자·`4.5 / 5`·`상위 12%`·완주 수·연속 학습·`11월 17일 03:00 기준`.
  - standing null이면 `매일 새벽에 계산돼요`, 점수 null이면 등급 `E`·상위 % 없음.
  - 프로젝트 줄: 이름·기간·`3인 팀`/`솔로`·`팀장`·등급.
  - 경험: 문장·역량 이름, 근거 null이면 `완료 근거` 없음.
  - github 있으면 `@login`, 없으면 없음.
  - 하단 `나도 7일 스프린트 시작하기` 링크(`/`).
- [ ] **Step 2–4:** FAIL → 구현 → PASS.
- [ ] **Step 5: 커밋** — `feat: 공개 프로필 페이지`.

### Task 7: 카드 이미지 (미리보기·스토리)

**Files:**
- Create: `web/components/profile-card.tsx` — `export function ProfileCard({ profile, size }: { profile: PublicProfile; size: 'og' | 'story' })`. satori 제약(flex만, grid 없음). 시안 A(큰 등급 글자) + 결승선 체크무늬 + 완주 수, `점수 · 상위 N%`, 뱃지 최대 4개, 로고와 `/u/<아이디>`. 점수 없으면 `E`와 `평가를 받으면 상위 %가 나와요`.
- Create: `web/lib/card-font.ts` — `export async function cardFonts()` 모듈 범위에서 한 번 읽음.
- Create: `web/assets/fonts/` 한글 글꼴 + `LICENSE` — **Pretendard(OFL 1.1) Bold·ExtraBold의 KS X 1001 부분 글꼴(otf/ttf)**. 다운로드는 파일명·출처·크기를 사용자에게 알리고 허락받은 뒤에 한다. KS X 1001 밖 글자(드문 음절)는 대체 글꼴로 보일 수 있다(설명만 남김).
- Create: `web/app/u/[handle]/opengraph-image.tsx` — 1200×630, `runtime = 'nodejs'`.
- Create: `web/app/u/[handle]/card/route.tsx` — `GET` 1080×1920 PNG, `Content-Disposition: attachment; filename="projectmate-<아이디>.png"`, `Cache-Control: no-store`.
- Test: `web/tests/public-profile-render.test.mjs`(카드 JSX 렌더), `web/tests/profile-api.test.mjs`(404)

- [ ] **Step 1: 실패하는 테스트**
  - `renderToString(ProfileCard…)`에 등급 글자·`상위 12%`·이름·`/u/harin`이 있고 팀원 이름이 없다.
  - 꺼진 프로필의 `card` GET이 404(ImageResponse까지 가지 않음).
- [ ] **Step 2–4:** FAIL → 구현 → PASS. 실제 PNG는 Task 10 브라우저 확인에서 본다.
- [ ] **Step 5: 커밋** — `feat: 프로필 카드 이미지`.

### Task 8: 마이페이지 — 프로필 등급·상위 %, 공유 시트, 공개 프로필 설정

**Files:**
- Modify: `web/components/my-page.tsx`
  - `MyScore`에 `profile: ProfileStanding | null`. `MySummary`의 `최고 등급` → `프로필 등급`(`profile?.grade ?? 'E'`), 통계에 `상위 N%`(없으면 `—`), 아래 작은 글씨 `<날짜> 기준` 또는 `매일 새벽에 계산돼요`. `동료평가 평균` 칸은 `프로필 점수`(`profile.score`)로 바꾼다.
  - `export function ShareSheet({ handle, enabled, onSettings, onClose })` — 꺼져 있으면 `공개 프로필을 켜면 공유할 수 있어요` + `설정에서 켜기`; 켜져 있으면 `<img src="/u/<handle>/card">` 미리보기, `이미지 저장`(`<a download href="/u/<handle>/card">`), `링크 복사`(clipboard, 실패 시 주소 선택 안내), `프로필 보기`. `navigator.share`가 있으면 `공유하기` 버튼도.
  - `export function PublicProfileSettings({ data, busy, onSave })` — 켜기 토글, 아이디·프로필 이름 입력, GitHub 보이기(연결 없으면 비활성 + 안내), 프로젝트·경험 숨김 체크, 경험별 근거 보이기, 저장. 오류(400/409) 문구를 그대로 보인다.
- Modify: `web/components/unified-app.tsx` — 요약 카드에 `내 프로필 공유` 버튼, `?share=1`이면 처음에 공유 시트를 연다. 설정 탭에서 `/api/profile` GET/POST로 `PublicProfileSettings`.
- Modify: `web/app/app/app.css`
- Test: `web/tests/my-page-render.test.mjs`(확장)

- [ ] **Step 1: 실패하는 테스트** — `MySummary`에 `프로필 등급`·`상위 12%`·`11월 17일 03:00 기준`; profile null이면 `E`·`매일 새벽에 계산돼요`; `ShareSheet` 꺼짐/켜짐 각각의 버튼과 `/u/harin/card`; `PublicProfileSettings`가 GitHub 미연결이면 체크박스 disabled, 숨김·근거 체크 목록을 그린다.
- [ ] **Step 2–4:** FAIL → 구현 → PASS. 기존 my-page 렌더 테스트의 `최고 등급` 단언은 `프로필 등급`으로 바꾼다.
- [ ] **Step 5: 커밋** — `feat: 마이페이지 프로필 등급·공유·공개 프로필 설정`.

### Task 9: 결과 화면의 공유 링크와 문서

**Files:**
- Modify: `web/components/peer-review.tsx` — `Result` 아래 `프로필에 반영돼요 · 프로필 공유하기` 링크(`/app?tab=activity&share=1`, 상수로 둔 href). "반영돼요"인 이유: 반영은 다음 새벽 일괄 계산 뒤라서.
- Modify: `CLAUDE.md`, `docs/unified-app.md`, `docs/features.md` — 바뀐 원칙(공개 프로필 링크 있음, 본인이 켠 공개 프로필의 점수 공개, 프로필 등급은 매일 일괄 계산), `CRON_SECRET` 운영 설정 필요.
- Test: `web/tests/peer-review-render.test.mjs`

- [ ] **Step 1–4:** 결과가 있을 때만 링크가 보이는 테스트 FAIL → 구현 → PASS.
- [ ] **Step 5: 커밋** — `feat: 결과 화면 프로필 공유 링크, 문서 갱신`.

### Task 10: 전체 확인

- [ ] `npm test`, tsc, 바꾼 파일 oxlint, `git diff --check` 모두 통과(수치 기록).
- [ ] 로컬 PGlite(`workspace-ui`, 브랜치 작업 공간으로 잠시 지정)에서: 하린 계정으로 내부 경로를 `CRON_SECRET`과 함께 호출 → 마이페이지 프로필 등급·상위 %·기준 시각, 공개 프로필 켜기·아이디 저장, `/u/<아이디>` 로그아웃 상태로 열림, `opengraph-image`·`card` PNG(한글 확인), 끄면 세 주소 모두 404, 375px 화면.
- [ ] 운영 전 사용자 할 일 정리: Vercel에 `CRON_SECRET` 설정, 운영 DB 0015 마이그레이션.

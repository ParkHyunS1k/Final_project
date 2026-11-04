# ProjectMate 로컬 LLM 실행과 어댑터 학습

2026-11-04 업데이트: **Qwen3 4B Instruct의 MLX 4bit 모델로 첫 QLoRA 학습과 실제 생성 평가를 완료했다.** 두 PDF의 기술 발췌 30개를 검수해 학습 21개, 검증 3개, 회귀 평가 6개로 나눴다. 대화 템플릿의 정답 형식 문제를 수정한 뒤 100스텝을 다시 학습했고, 검증 손실로 60스텝 어댑터를 선택했다. 약 1.31MB의 어댑터는 실험용으로 보관한다.

학습 모델의 회귀 응답 6개는 모두 앱 검증을 통과했지만, 앱 처리 후 역량과 경험 구분의 집합이 정답과 정확히 일치한 것은 1개다. 미래 계획의 수행 경험 오인, API 사용과 개발의 혼동, 중복 역량 및 근거 범위 오류가 남았다. 개인 이력서 전체에서도 API 개발 경험을 과대 해석했다. **앱 기본값은 학습 전 로컬 모델로 유지했다.** 기본 모델도 같은 종류의 오류가 있어 결과는 검토가 필요한 초안이다. 외부 분석은 `CAREERFLOW_AI_PROVIDER=openai`를 명시할 때만 선택한다.

실험 기록은 Git에서 제외되는 `runs/resume-pilot-20261104/`, 선택한 어댑터는 `adapters/resume-pilot-20261104-json-selected/`에 있다. 평가 6개는 첫 형식 오류 진단에서 확인했으므로 새로운 비공개 평가 세트로 간주하지 않는다. 첫 실험 실패와 수정 후 실험 기록을 모두 보존했으며, 이 결과만으로 일반 성능 향상을 주장하지 않는다.

## 로컬 모델 실행

Python 3.12 가상환경에 설치한 버전은 MLX-LM 0.32.2, MLX 0.32.4, Transformers 5.22.1이다. 기본 가중치의 고정 리비전은 `50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b`이다. 모델 가중치는 약 2.3GB다. 아래 명령은 `local-llm/`에서 실행한다.

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-mlx.txt
.venv/bin/python scripts/download_model.py
.venv/bin/python scripts/serve_local.py
```

이미 설치한 환경에서 실행할 때는 마지막 명령만 사용한다. 모델 서버는 `127.0.0.1:8089`에서만 열고 오프라인 모드로 실행한다. 다운로드 명령은 공개 모델 파일만 받으며 문서를 업로드하지 않는다. 원문이나 전체 응답을 로그에 기록하지 않도록 DEBUG 로그를 사용하지 않는다.

별도 터미널의 `web/`에서 다음처럼 실행한다. 기존 데이터가 있는 로컬 DB를 사용하려면 `DATABASE_PATH`를 그 경로로 맞춘다. 그 DB를 사용하는 서버가 있다면 먼저 종료한다.

```sh
DATABASE_URL= DATABASE_PATH=.data/career-local-llm npm run db:migrate
DATABASE_URL= DATABASE_PATH=.data/career-local-llm AUTH_DEV_HEADERS=1 \
  CAREERFLOW_AI_PROVIDER=local \
  CAREERFLOW_LOCAL_MODEL=models/qwen3-4b-instruct-4bit \
  CAREERFLOW_LOCAL_URL=http://127.0.0.1:8089 \
  npm run dev -- --webpack --port 3286
```

로컬 개발 계정으로 화면을 확인하려면 다른 터미널의 `web/`에서 `node scripts/dev-as.mjs 3287 local-llm-user 로컬모델검증 3286`을 실행하고 `http://127.0.0.1:3287/app?tab=profile`로 접속한다. 개발 신원 헤더는 운영에서 사용할 수 없다. Vercel의 localhost는 사용자 Mac이 아니므로 이 구성을 그대로 운영 배포에 연결할 수 없다.

앱은 이력서와 공고를 별도 요청으로 분석하고 각 원문 줄 번호를 전달한다. 공고의 응답은 공고 요건에만 반영하며 개인 역량으로 저장하지 않는다. 모델이 역량, 경험 구분과 근거의 시작 및 끝 번호를 선택하면 앱이 해당 원문 구간을 복원해 검사한다. 기술명 키워드로 로컬 모델의 답을 대체하지 않는다. 잘못된 범위, 잘린 JSON, 미등록 역량 ID는 저장하지 않으며 외부 API로 자동 재시도하지 않는다. 원문 일치는 의미적 판단의 정확성을 보장하지 않는다.

현재 입력 상한은 이력서와 공고를 합해 16,000자, 모델 응답 제한은 180초다. 프로필 쓰기 선점은 300초로 유지해 추론 중 중복 저장을 막는다. 로컬 모델에도 동시 저장 보호와 하루 분석 한도를 적용한다. 실패한 분석은 한도를 돌려준다. 원문과 분석 결과는 개인 프로필에 저장하고 사용한 제공자와 모델명을 함께 표시한다.

2026-11-04 실제 개발 사례 한 건에서 브라우저 분석, 로컬 모델 응답, 프로필 저장, 새로고침 후 유지와 추천 연결을 확인했다. 그러나 기술 목록을 직접 구현 경험으로 과대 해석하거나 공고의 필수 및 우대 구분을 잘못 판단하는 오류가 남아 있다. 이 사례는 프롬프트 조정에 사용했으므로 독립 평가 세트가 아니다. 출력은 분석 초안으로 표시하며, 구조 검사를 통과했다는 사실을 의미적 정확도나 채용 적합성 검증으로 해석하지 않는다.

## 검수 데이터로 학습 재현

기존 초안은 그대로 보존한다. 2026-11-04 검수본은 두 원본 PDF의 해시와 10쪽의 이미지를 대조하고, 기술 발췌 30개를 사례 단위로 학습 21개, 검증 3개, 평가 6개로 나눴다. 학습에는 두 PDF의 사례가 모두 포함된다. 이름과 연락처를 포함하는 개인 이력서 전체는 학습에 넣지 않는다. 정답 검수자는 Codex이며 사람의 독립 검수를 받은 정답은 아니다. 원본의 이름이 가려져 있어 동일인 여부를 완전히 입증할 수 없다는 제한도 검수 기록에 남겼다.

현재 앱은 `startLine`, `endLine` 형식을 사용한다. 과거 `dataset_tool.py export`의 직접 인용 형식 대신 아래 내보내기를 사용한다. 이 명령은 기존 검수 조건, 분할과 중복 검사를 통과해야 하며 실제 앱의 프롬프트, 역량 목록과 줄 분리 함수를 재사용한다. 출력 폴더가 있으면 새 이름을 사용한다.

```sh
node scripts/app_dataset.mjs \
  data/pilot-lora-20261104/annotations.reviewed.jsonl \
  data/pilot-lora-20261104/audit.json \
  data/pilot-lora-20261104/chat

.venv/bin/python scripts/train_adapter.py --config examples/lora-pilot.yaml

.venv/bin/python scripts/select_adapter.py \
  --data data/pilot-lora-20261104/chat \
  --model models/qwen3-4b-instruct-4bit \
  --checkpoints adapters/resume-pilot-20261104-json \
  --output adapters/resume-pilot-20261104-json-selected

.venv/bin/python scripts/evaluate_adapter.py \
  --data data/pilot-lora-20261104/chat \
  --model models/qwen3-4b-instruct-4bit \
  --adapter adapters/resume-pilot-20261104-json-selected \
  --split test --output runs/pilot-new-evaluation
```

이 데이터와 가중치는 Git에서 제외되므로 새 체크아웃에는 없다. 위 명령은 검수본이 있는 로컬 환경을 기준으로 한다. 다시 학습할 때는 설정의 `adapter_path`와 출력 폴더를 새 이름으로 바꾼다. 선택기는 검증 데이터만 읽으며 평가 정답으로 체크포인트를 고르지 않는다. 평가기의 엄격한 JSON 준수, 역량과 경험 구분의 일치 및 근거 줄 범위 점수는 요약 내용의 정확성이나 채용 적합도를 측정하지 않는다.

고정한 MLX 배포본의 완성 대화 템플릿이 정답 앞에 빈 생각 블록을 붙이는 것을 확인했다. [Qwen 공식 모델 카드](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)는 이 Instruct 모델을 생각 블록을 출력하지 않는 모델로 설명한다. `train_adapter.py`는 실제 추론과 같은 입력 토큰 뒤에 정답 JSON과 종료 토큰만 붙이고, 정답 토큰만 손실에 반영한다. 이 학습은 기본 가중치를 고정한 4bit QLoRA이며 마지막 4개 층의 q/v 투영에 rank 8 어댑터를 추가한다.

어댑터를 앱에서 시험할 때는 기본 모델 서버를 실행한 상태에서 앱 서버에 `CAREERFLOW_LOCAL_ADAPTER`를 어댑터 폴더의 절대 경로로 설정한다. `CAREERFLOW_LOCAL_MODEL`은 위 실행 예시처럼 실제 모델 경로를 사용한다. 앱은 MLX 요청의 `adapters` 필드로 이력서 분석에만 어댑터를 선택하고, 공고 분석은 기본 모델로 요청한다. 결과에는 어댑터 폴더 이름을 함께 기록한다. 이 옵션을 비우면 기존 기본 모델을 사용한다.

MLX-LM 0.32.2에서 서버의 `--adapter-path` 옵션은 요청 모델이 `default_model`일 때만 자동 연결된다. 따라서 서버 옵션만 바꾸고 앱에 실제 모델 경로를 보내면 어댑터가 빠질 수 있다. 앱에서는 명시적인 `CAREERFLOW_LOCAL_ADAPTER` 설정을 사용한다. 실험 어댑터의 생성, 선택과 앱 기본값 채택은 서로 다른 단계다.

첫 실험의 목표는 이력서·경험에서 **역량, 수행/학습/언급 여부, 원문 근거**를 추출하는 것이다. 목표 공고와의 비교 및 프로젝트·역할 추천은 추출 결과를 기존 앱의 규칙과 연결한다. PDF에 없는 프로젝트 적합도 정답이나 합격 확률을 만들어 학습하지 않는다.

## 2026-10-30 준비 당시의 환경과 자료

| 항목 | 확인 결과 |
| --- | --- |
| 컴퓨터 | Apple M3 Pro, 통합 메모리 18 GiB |
| PDF 1 | `2026 이력서,자기소개서.pdf`, 241쪽 |
| PDF 2 | `2026 일학습병행 참여사례집.pdf`, 191쪽 |
| 기존 텍스트 추출 | 총 432쪽, 543,828문자 |
| IT 키워드 검토 후보 | 74쪽. 키워드 탐색 결과이며 학습 사례 수가 아님 |
| 기존 OCR | 기술명·한글 오인식과 표 읽기 순서 문제 확인 |
| 로컬 OCR | macOS Vision으로 두 PDF에서 선정한 10쪽 처리 및 페이지 이미지 대조 완료 |
| 첫 정답 후보 | 발췌 30개, 임시 사례 그룹 10개, 역량 13종. 최종 검수 전 초안 |
| Ollama | 설치 및 두 모델의 manifest 확인. 서버 중지 상태이며 모델 실행은 미검증 |
| MLX | 학습 환경과 모델 미설치 |

목차·본문이 파일명과 엇갈린다. PDF 1의 3쪽은 일학습병행 직무별 목차이고 100쪽은 정보기술 자기소개서다. PDF 2의 3쪽은 우수 이력서·자기소개서·합격후기 목차다. 원본 이름은 유지하고, 본문과 사례 경계를 기준으로 분류해야 한다. 여기서 쪽수는 PDF의 1부터 시작하는 페이지 번호이며 인쇄된 쪽수와 다를 수 있다.

기존 OCR에서 `파이썬`, `RESTful API`, `Figma`가 깨져 있었고, 시험한 Vision OCR에서는 해당 표기가 개선되었다. 다른 오인식은 남아 있다. 한 페이지의 관찰이며 전체 정확도나 문자 오류율을 측정한 결과가 아니다.

## 단계별 진행

1. **사례 정리:** IT 관련 후보 페이지에서 한 사람의 사례 시작·끝을 묶는다. 표·본문의 읽는 순서를 보존하고 원본 이미지와 비교해 OCR을 교정한다. 이름, 연락처, 학번 및 식별 가능한 불필요한 항목을 제거한다.
2. **정답 기준 맞추기:** 우선 서로 다른 사례에서 약 30개 입력/정답 쌍을 만든다. 같은 사례에서 잘라낸 여러 문장은 하나의 `case_id`로 관리한다. 첫 묶음은 데이터 형식을 확인하는 실험용이며 성능을 입증하는 규모로 보지 않는다.
3. **분리와 기준 성능 측정:** 사람·사례 및 유사 중복을 같은 그룹으로 묶어 학습/검증/평가 세트를 분리한다. 페이지 무작위 분할은 하지 않는다. 파인튜닝 전 모델을 같은 평가 입력으로 먼저 측정한다.
4. **맥에서 시험 학습:** 4bit 양자화 모델에 작은 LoRA 어댑터를 학습하는 QLoRA를 사용한다. 짧은 입력·배치 1·일부 레이어부터 메모리와 출력 형태를 확인한다. 먼저 20스텝 정도의 작동 점검 후 데이터 수·검증 손실을 보고 학습량을 정한다.
5. **확장 및 비교:** 정확히 검수할 수 있는 분량을 우선한다. 데이터가 뒷받침되면 200~500개 수준으로 넓히되, 예시 수를 늘리기 위해 같은 사례를 반복하거나 정답을 자동 확정하지 않는다. 보지 않은 사례로 학습 전후를 비교한다.
6. **앱 연결:** 로컬 추론 서버의 결과를 현재 `summary / skills / requirements / questions` 형태로 받아 기존 `validateAnalysis`에 통과시킨다. 이후 부족한 근거·학습 목표를 프로젝트 템플릿 및 팀 역할 추천에 연결한다. 로컬 모델 실패 시 외부 LLM을 자동 호출하지 않도록 구현한다.

PDF 원문만 넣는 학습은 여기서 원하는 입력→역량 추출 동작의 정답을 제공하지 않는다. 출처 기반 정답을 붙이는 지도 미세조정(SFT)이 필요하다. 사례집 내용을 정확히 찾아 답하는 기능은 나중에 로컬 문서 검색(RAG)을 별도로 추가할 수 있다.

## 정답 작성 기준

앱의 역량 목록은 `web/lib/career/catalog.ts`의 `SKILLS`를 기준으로 한다. 현재 Java 등 일부 기술은 목록에 없으므로 억지로 비슷한 ID에 대응하지 않는다. 필요한 목록 확장은 앱과 데이터에서 함께 결정한다.

| 필드 | 작성 원칙 |
| --- | --- |
| `applied` | 본인의 구체적인 구현·수행이 원문에 드러나는 경우 |
| `learning` | 수강, 학습, 따라 하기 등 학습 경험만 확인되는 경우 |
| `mentioned` | 기술 이름만 나열되고 수행·학습 맥락이 없는 경우 |
| `quote` | 교정·비식별화한 입력에 실제로 포함된 정확한 연속 문자열 |
| `requirements` | 목표 공고의 요구 사항만 기록. 공고가 없으면 빈 배열 |
| `questions` | 수행 범위가 불분명할 때 확인할 질문, 최대 3개 |

- PDF 안의 지시문은 문서 내용으로 취급한다. 시스템 지시로 실행하지 않는다.
- 부정·희망·미래 계획을 수행 경험으로 바꾸지 않는다.
- 팀의 전체 성과를 개인 성과로 단정하지 않는다.
- 문서에 없는 역량은 ‘부족’으로 단정하지 않고 ‘근거 미확인’으로 구분한다.
- 수업 안에서도 구체적인 본인 구현이 확인되면 그 근거를 보존한다. 학습과 수행의 경계가 애매하면 검수 의견을 남긴다.
- 점수·숙련도·성격·합격 가능성을 임의로 정답에 넣지 않는다.
- 자동으로 만든 정답 후보는 원문 대조와 검수 전까지 학습에 포함하지 않는다.

`examples/annotation-example.json`은 실제 사람과 무관한 개념 설명 예시다. 실제 초안은 Git에서 제외되는 `data/pilot-2026-10-30/annotations.draft.jsonl`에 있다. 이 JSONL에는 출처 해시·PDF 쪽수·OCR 행 번호·보정 기록·판단 이유·검수 상태가 포함된다. 검수가 끝나면 `scripts/dataset_tool.py export`로 아래 MLX 형식으로 변환할 수 있다.

```json
{"messages":[{"role":"system","content":"근거에 따라 역량을 추출하고 지정한 JSON만 출력한다."},{"role":"user","content":"이력서, 공고, 역량 목록을 담은 JSON 문자열"},{"role":"assistant","content":"검수된 정답 JSON 문자열"}]}
```

평가 항목은 JSON·앱 스키마 통과율, 역량 추출 precision/recall, 수행/학습/언급 분류, 근거 인용 일치율, 원문에 없는 주장 비율이다. 부정문·팀 성과·계획·빈 문서·문서 내 지시문도 평가에 넣는다. 테스트 세트는 학습과 반복적인 설정 선택에 사용하지 않는다.

## 첫 정답 후보와 검토 방법

검토 문서: `data/pilot-2026-10-30/review-v1/review.md`. 각 예시에 입력 발췌, 정답 후보, 근거 인용, 판단 메모를 함께 적었다. 전체 이력서가 아닌 **발췌 기준** 정답이다. 같은 사람의 다른 페이지에 있는 경험 유무까지 판단하지 않는다.

- P003: 파이썬 스터디는 학습.
- P022·P023: ‘개발(학습 중)’, ‘쿼리 작성·구문 실습’은 명시된 학습 맥락 우선.
- P025: 기술명만 나열한 발췌는 언급. 실제 프로젝트 설명과 합쳐 읽을 때는 수준이 달라질 수 있음.
- P008·P014: 서버 구축→API 개발, 디자인 관리→UI·UX 설계 대응의 범위가 애매해 별도 검토 필요.
- P029: API를 호출한 대시보드 구현과 API 서버 개발은 구별.

총 30개 입력에 역량 근거 43개가 있다(수행 28, 학습 9, 언급 6). 역량을 추출하지 않는 예시도 3개 포함했다. RAG·품질 평가·TypeScript·사용자 검증·요구사항 기획은 이 묶음에서 다루지 못했다. 부정문 및 문서 내 지시문에 대한 별도 평가 사례도 더 필요하다. 30개만으로 앱 전체 입력을 대표하거나 성능을 검증했다고 판단하지 않는다.

동일 페이지의 발췌는 같은 임시 그룹으로 묶었다. 이는 사람별 중복 검수가 끝난 10명이라는 뜻이 아니다. 인접 페이지의 사례 경계, 두 문서 간 동일인·유사 사례를 확인해 `leakage_group_id`를 확정해야 한다. 확정 전에는 학습/검증/평가 분할을 하지 않았다.

2026-10-30 초안의 `review.source_checked=true`는 **Codex가 페이지 이미지와 대조했다**는 기록이다. 사용자 검수를 받았다는 뜻이 아니다. 이 초안 파일은 `review.labels=draft`, `review.privacy=excerpt_minimized_pending_review`, `review.identity_groups=unverified`, `training_eligible=false`로 보존했다. 2026-11-04에는 원문 재대조와 정답 수정, 개인정보 및 사례 검토를 거친 별도 검수본을 만들었다. 사람이 승인했다는 의미로 상태를 바꾸지 않는다.

다음 명령도 `local-llm/`에서 실행한다. Python 표준 라이브러리만 사용하는 검사 도구다.

```sh
python3 scripts/dataset_tool.py check data/pilot-2026-10-30/annotations.draft.jsonl \
  --audit data/intake-2026-10-29/audit.json

python3 scripts/dataset_tool.py review data/pilot-2026-10-30/annotations.draft.jsonl \
  --audit data/intake-2026-10-29/audit.json \
  --output data/pilot-2026-10-30/review-new

python3 -m unittest discover -s tests -v
```

검사 항목은 현재 앱의 역량 ID, JSON 구조, 정확한 원문 인용, PDF 해시·쪽수, 그룹 및 같은 입력의 분할 중복이다. 의미적으로 올바른 정답인지, 완전한 비식별화인지, 유사 사례가 없는지는 자동 검사만으로 보장하지 않는다.

정답·개인정보·사례 그룹을 실제 검토한 후 각각의 상태를 `reviewed`로 기록하고, `training_eligible=true` 및 그룹 단위의 `split`(`train`, `valid`, `test`)을 지정해야 내보내기가 가능하다. `export`는 검수 미완료 행 하나라도 있으면 전체를 거부한다. 통과하면 `train.jsonl`, `valid.jsonl`, `test.jsonl`, 출처를 별도로 보존하는 `manifest.json`과 요약을 새 폴더에 만든다. 원본·기존 출력을 덮어쓰지 않는다.

## 도구와 재현

현재 전처리는 Python 3.12.14와 `pypdf==6.10.0`으로 실행했다. 루트 Python 프로젝트 및 `web/` 의존성과 별도 환경을 사용한다.

아래 명령은 `local-llm/`에서 실행한다. 이미 생성한 `data/intake-2026-10-29`는 덮어쓰지 않는다. 새 실행에는 새 출력 폴더 이름을 준다.

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-intake.txt
.venv/bin/python scripts/audit_pdfs.py \
  '/Users/dongseong/Downloads/2026 이력서,자기소개서.pdf' \
  '/Users/dongseong/Downloads/2026 일학습병행 참여사례집.pdf' \
  --output data/intake-new

swift -module-cache-path /private/tmp/projectmate-swift-cache \
  scripts/ocr_page.swift \
  '/Users/dongseong/Downloads/2026 이력서,자기소개서.pdf' \
  100 data/intake-new/source_01.p100.vision.json
```

`audit_pdfs.py`는 기존 문자 레이어를 읽어 페이지별 JSONL, 요약 `audit.json`, IT 후보 큐를 만든다. 원문 SHA-256과 PDF 페이지를 보존한다. `ocr_page.swift`는 한 페이지를 macOS Vision으로 OCR한다. 두 스크립트에는 외부 LLM 호출이 없다. Vision은 제한된 샌드박스에서 실패했으며 일반 macOS 실행 권한에서는 성공했다.

현재 모델은 [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)의 MLX 4bit 배포본이다. M3 Pro 18GB에서 실제 실행과 학습 기록을 `runs/`에 보관한다. 기본 모델 실행 성공과 학습 후 한국어 추출 품질 향상은 구분한다.

학습 환경은 [MLX-LM 공식 LoRA 문서](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md)의 `mlx-lm[train]`을 별도 가상환경에 설치하고, 검증된 버전을 고정한다. 모델·패키지 다운로드에는 인터넷이 필요하다. 문서 전송은 필요하지 않으며 학습·추론은 다운로드가 완료된 로컬 파일로 실행하도록 구성한다. 외부 실험 추적 서비스는 사용하지 않는다.

현재 재현 명령은 위의 `train_adapter.py` 절차를 따른다. 이 실행기는 정답 토큰의 왕복 일치와 길이를 확인하고, 20스텝 시점에는 검증 사례로 실제 JSON 생성도 점검한다. 단순한 손실 감소로 출력 형식이나 의미적 정확성을 통과 처리하지 않는다. MLX 어댑터는 먼저 MLX에서 직접 검증하며 Ollama에 그대로 가져올 수 있다고 가정하지 않는다.

## 로컬 데이터 보관

원본 PDF는 Downloads에 그대로 두었다. 추출문·검수 데이터는 `data/` 아래에 있고, 생성 디렉터리는 소유자만 접근(700), 파일은 소유자만 읽기/쓰기(600)로 만들었다. PDF·데이터·모델·어댑터·실행 기록·환경 파일은 이 폴더의 `.gitignore`로 제외한다.

Git 제외는 암호화나 모든 유출 방지를 뜻하지 않는다. 일반 커밋 대상에서 빠지는 것을 확인했으며 강제 추가나 별도 공유는 보호하지 않는다. 정규식으로 표시한 연락처 후보만으로 비식별화가 끝났다고 판단하지 않는다. 검수본, 학습 어댑터와 실행 기록도 모두 Git 제외 경로에 보관한다.

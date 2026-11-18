# 로컬 모델 파인튜닝 실험 보고 (gpt-6.1-sol 라벨)

개인 실험이며 제품 기능이 아니다. ProjectMate 앱의 운영 모델 gpt-6.1-sol(기본 effort low)의 응답으로 Qwen3.5 4B를 LoRA 학습하고, 같은 모델과 비교한 기록이다(2026-11-19). 요약은 [README.md](README.md)에 있다.

## 고정값

### 장비와 서빙

| 항목 | 값 |
|---|---|
| GPU | NVIDIA GeForce RTX 4070, 12282 MiB. 드라이버 621.01, CUDA 13.5 |
| 서빙 | llama.cpp b12184 `llama-b12184-bin-win-cuda-13.5-x64.zip` (sha256 `2a2592623a239f0cdb29377f5c9ef5537d54ff027113e9a2e8873939a2da691a`) |
| 4비트 기본 모델 | `unsloth/Qwen3.5-4B-GGUF` 리비전 `e87f176479d0855a907a41277aca2f8ee7a09523`의 `Qwen3.5-4B-Q4_K_M.gguf`(2.7GB), sha256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
| 8비트 기본 모델 | 학습 원본을 `convert_hf_to_gguf.py --outtype q8_0`으로 변환한 `Qwen3.5-4B-Q8_0.gguf`(4.6GB). 253건의 입력 토큰 수가 4비트와 같다 |
| 서버 옵션 | `--ctx-size 8192 --parallel 1 -ngl 99 --jinja`, 요청에 `chat_template_kwargs.enable_thinking=false`, temperature 0, seed 7, max_tokens 1024 |
| 연결 | 맥 → Tailscale → Windows OpenSSH → `ssh -L` 터널. 서버 포트는 방화벽에서 열지 않는다 |

### 학습 환경

- Windows Python 3.12.2 venv: torch 2.14.1+cu130, transformers 5.17.0, trl 1.15.0, peft 0.21.3, unsloth 2026.11.4.
- 학습 원본: `Qwen/Qwen3.5-4B` 리비전 `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`(safetensors, 9.3GB, Apache-2.0).
- 방식: bf16 LoRA r=16, lr 2e-4, 배치 1×8, 3 epoch. 손실은 응답 JSON에만 건다. 검증 손실이 가장 낮은 epoch의 체크포인트를 시험 전에 고른다.
- 어댑터 변환: llama.cpp b12184 소스의 `convert_lora_to_gguf.py --outtype f16`.
- 학습 prompt는 llama-server `/apply-template`(사고 모드 끔)로 렌더링해, 학습과 서빙의 템플릿 문자열이 같다.

### 프롬프트·스키마

| 파일 | sha256 |
|---|---|
| `evals/github-timeline-state-change-2026-09-11/prompt.md` | `06a84c7d41f06cd4fe77fa55ae33644b9194dab1b0f929c0c5dd4a43b2e484ab` |
| `evals/github-timeline-state-change-2026-09-11/schema.json` | `6f7b3a41eefe8ec45b4fb4dc4a18efd4de090a4c92585716e6de9565d964cf6e` |

### 시험지와 답안지

- **보류 A:** GitHub 타임라인 253건. 학습·검증 데이터와 사례 id·저장소가 모두 겹치지 않는다. 분할은 `make_split.py --split`(seed 7)이 결정적으로 만든다(split.json sha256 `cc7b667fc70e6a6621289e288d1830b47d2da64634fca84be9ea2a0c96ab8afc`).
- **GPT 답안지:** `run.py --variant sol61-low`(`gpt-6.1-sol`, reasoning low)로 보류 A를 실행한 응답이다. 253건 모두 `success`, 입력 419,452 / 출력 29,659 토큰, 지연 중앙값 4.8초·p95 9.4초.
- **Claude 답안지:** 실험 전에 고정한 Claude 블라인드 라벨 253건이다(`labels/claude-blind-v1.jsonl`).

## 판정 규칙

실험 전에 정한 규칙을 sol 6.1 low 대비로 적용한다. 답안지는 Claude 라벨이다.

| 구간 (로컬 − sol 6.1, 사례 단위 짝 부트스트랩 10,000회, 양측 90%) | 표현 |
|---|---|
| 하한 ≥ −6%p | **비열등** |
| 상한 < −6%p | **미달** |
| 그 외 | **판정 불가** |

| 게이트 | 지표 | sol 6.1 값 | 기준 |
|---|---|---:|---|
| G1 | 결정 일치 | 73.5% | 위 3단계 판정 |
| G2 | 변경 F1 (합산) | 72.8% | 위 3단계 판정 |
| S1 | 금지 변경 사례 | 3건 | ≤ 6건 |
| S2 | 없는 업무 참조 | 0건 | ≤ 2건 |

- G1·G2가 비열등이고 S1·S2를 통과할 때만 "평가 형식, Claude 라벨 기준 sol 6.1 low에 비열등"이라고 쓴다. 그 밖에는 게이트별 판정을 그대로 쓴다.
- 라벨 일치 지표이므로 이 결론만으로 "GPT만큼"이나 "앱에서 쓸 만하다"고 쓰지 않는다.
- sol 6.1의 Claude 답안지 세부: 확인 필요 재현 22/46, 무변경 104/121, 변경 제안 60/86, 무작업 오제안 8.4%.

## 학습 데이터 라벨링

- `make_split.py --relabel-queue`가 학습 1000건과 검증 40건의 id를 모아 `out/queue-relabel.jsonl`(1040건)을 만든다.
  - 학습 1000건: 학습 대기열 402건(역할 분담 2 : 타임라인 3으로 섞음), 앞선 학습에서 로컬 모델이 틀린 사례 447건, 같은 분포 추가 151건.
  - 검증 40건: 타임라인 32 / 역할 분담 8.
- `run.py --variant sol61-low`로 1040건을 라벨링했다. 모두 `success`, 입력 1,905,232 / 출력 138,514 토큰이다.
- `make_split.py --relabel out/gpt61-labels/relabel`이 sol 6.1 응답을 그대로 학습 정답으로 쓴다. 요약·확인 사유 문장도 sol 6.1이 쓴 그대로다. 건너뛴 사례는 없다.
- 결정 분포(학습 1000건): no_change 443, propose_changes 369, needs_clarification 188.
- 변경 종류: complete 212, status 110, createTask 75, assignee 19, dueAt 7.

| 파일 | sha256 |
|---|---|
| `out/train-messages-1000-sol61.jsonl` | `fdc63b38f80d84adb5d8d436d7a457c93fbb5c8493d7dc52301b4ee809e9b9cf` |
| `out/dev-messages-all-sol61.jsonl` | `09ecb8bb261e4cb8fa49c27bdbd185a9f83d2b6108583dc12bca514eeb230bf7` |
| `out/queue-relabel.jsonl` | `b3854fac63e2c1cb79ff382ee10be9e165b20a1c6fa2385f564f7a67bae73575` |

**해석:** LoRA는 sol 6.1을 따라 하도록 학습된다(증류). 기대할 수 있는 최선은 대체로 sol 6.1 수준이다. Claude 답안지는 학습에 쓰지 않았으므로, Claude 답안지로 '학생(LoRA) vs 선생(sol 6.1)'을 같은 기준에서 비교한다.

## 학습

seed 7·8·9로 세 번 학습했다(`C:\train\run8s{7,8,9}`). 세 seed 모두 epoch 2의 dev 손실이 가장 낮았다.

| seed | dev 손실 e1 / e2 / e3 | 학습 시간 | 최대 VRAM | 어댑터 (epoch 2) sha256 |
|---|---|---:|---:|---|
| 7 | 0.3929 / **0.3825** / 0.3977 | 3,248초 | 9.92GiB | `1bdf24ab86d7292816c63a2a2fe6adac4476c66d556196ceea7919c4ce007186` |
| 8 | 0.3954 / **0.3703** / 0.3870 | 3,022초 | 9.92GiB | `936a23719a47d596d2a446c6557ada9665e9247299d6c383f08dc401e9a98a6c` |
| 9 | 0.3890 / **0.3666** / 0.3912 | 3,015초 | 9.91GiB | `06cdcf9d0da459fd69037ca18995ac419a2410da9b6ee93d1f12792c13c67b36` |

학습 로그 원본: `evidence/train-logs/run8s{7,8,9}-summary.json`.

## 평가

어댑터마다 4비트·8비트 기본 모델에 올려 보류 A 253건을 실행했다. 6개 변형 모두 253건 `success`, 재시도 0이다.

- 평가 직전 llama-server의 `/props`·`/lora-adapters`로 기본 모델 경로와 어댑터·배율을 확인했다(`evidence/compare/server-check-*.json`).
- `compare.py`는 사례별 prompt·schema 해시가 GPT 답안지와 같은지, 결과의 어댑터 해시가 서버 확인과 같은지 검사한다.

### 지표 (괄호는 seed 7 / 8 / 9)

| | sol 6.1 답안지 G1 | sol 6.1 답안지 G2 | Claude 답안지 G1 | Claude 답안지 G2 | S1 | S2 | 지연 중앙값 / p95 |
|---|---|---|---|---|---|---|---|
| 파인튜닝 전 (4비트) | 45.5 | 35.1 | 42.7 | 29.4 | 57 | 3 | 3.2 / 4.4초 |
| 4비트 평균 | 75.8 (75.9 / 76.7 / 74.7) | 64.3 (67.2 / 61.5 / 64.1) | 66.1 (67.2 / 64.0 / 67.2) | 50.9 (54.3 / 48.6 / 49.7) | 6 / 10 / 13 | 0 / 0 / 2 | 1.2 / 1.8초 |
| 8비트 평균 | 75.2 (77.9 / 74.3 / 73.5) | 62.8 (62.2 / 63.9 / 62.3) | 65.7 (66.0 / 68.8 / 62.5) | 51.3 (51.3 / 53.7 / 48.8) | 6 / 11 / 16 | 0 / 0 / 0 | 1.5 / 2.3초 |
| sol 6.1 low | 100 | 100 | 73.5 | 72.8 | 3 | 0 | 4.8 / 9.4초 |

**Claude 답안지 결정별 재현 (seed 7 / 8 / 9)**

| | no_change (121) | propose_changes (86) | needs_clarification (46) |
|---|---|---|---|
| 4비트 | 112 / 100 / 103 | 45 / 49 / 51 | 13 / 13 / 16 |
| 8비트 | 111 / 107 / 96 | 42 / 52 / 46 | 14 / 15 / 16 |
| sol 6.1 | 104 | 60 | 22 |

### seed 평균끼리의 비교 (`pool.py --baseline sol61-low`, 짝 부트스트랩 90% 구간)

| 비교 | sol 6.1 답안지 G1 | sol 6.1 답안지 G2 | Claude 답안지 G1 | Claude 답안지 G2 |
|---|---|---|---|---|
| 4비트 − 파인튜닝 전 | +30.3 [+24.2, +36.4] | +29.2 [+23.3, +35.1] | +23.5 [+17.3, +29.5] | +21.5 [+15.6, +27.1] |
| 8비트 − 파인튜닝 전 | +29.8 [+23.8, +35.7] | +27.7 [+21.2, +34.1] | +23.1 [+17.0, +29.1] | +21.9 [+15.9, +27.8] |
| 8비트 − 4비트 | −0.5 [−2.8, +1.7] | −1.5 [−4.6, +1.7] | −0.4 [−2.5, +1.7] | +0.4 [−2.3, +3.1] |

- **파인튜닝 효과 확인:** 모든 구간의 하한이 0보다 크다.
- 4비트 평균은 sol 6.1과의 차이 중 G1 약 56%, G2 약 45%를 메웠다.
- 4비트와 8비트는 구별되지 않는다.

### sol 6.1 대비 판정 (Claude 답안지)

| 변형 | G1 | G2 | S1 | S2 |
|---|---|---|---:|---:|
| 4비트 seed 7 | −6.3 [−11.1, −1.6] 판정 불가 | −18.5 [−26.2, −11.1] 미달 | 6 | 0 |
| 4비트 seed 8 | −9.5 [−13.8, −4.7] 판정 불가 | −24.3 [−31.8, −16.9] 미달 | 10 | 0 |
| 4비트 seed 9 | −6.3 [−11.1, −1.6] 판정 불가 | −23.1 [−30.3, −16.1] 미달 | 13 | 2 |
| 8비트 seed 7 | −7.5 [−12.3, −2.8] 판정 불가 | −21.5 [−29.5, −13.8] 미달 | 6 | 0 |
| 8비트 seed 8 | −4.7 [−9.9, +0.4] 판정 불가 | −19.2 [−26.5, −11.9] 미달 | 11 | 0 |
| 8비트 seed 9 | −11.1 [−15.8, −6.3] 미달 | −24.0 [−31.4, −16.8] 미달 | 16 | 0 |

**결론:** G2는 모든 변형이 미달이다. S1은 6개 중 2개만 통과한다. "sol 6.1 low에 비열등"이라고 쓸 수 없다.

출력: `evidence/compare/compare-run8-{claude,gpt}.json`, `evidence/compare/pool-61-*.txt`.

### 세부 변경 (새 업무·담당자·마감)

- sol 6.1이 보류 A에서 낸 세부 변경은 10개다(createTask 6, dueAt 3, assignee 1). 나머지는 완료·상태 변경이다.
- 로컬은 변형마다 세부 변경을 2~13개 냈고, sol 6.1과 종류·대상이 맞은 것은 0~2개다.
- 맞은 마감 변경 1개도 날짜 값이 달랐다.
- `score_case`는 제목·담당자·마감 값을 채점하지 않으므로 이 약점은 G2에 드러나지 않는다.

## 혼합 방식: 로컬이 거르고 GPT가 쓴다

**질문:** 변경이 필요한지는 로컬 모델이 판단하고, 구체적인 변경 내용은 GPT가 쓰면 어떤가.

- 새 호출 없이 저장된 결과로 계산했다(`hybrid.py --baseline sol61-low`, 출력 `evidence/compare/hybrid-run8-sol61-claude.txt`).
- **gate:** 로컬이 `no_change`면 GPT를 부르지 않고 무변경으로 끝낸다. 그 밖(변경 제안, 확인 필요)은 sol 6.1 응답을 그대로 쓴다.
- **gate-propose:** 로컬이 `propose_changes`일 때만 GPT를 부른다. 확인 필요는 로컬 응답을 쓴다.
- 답안지는 Claude 라벨이다. GPT 답안지는 sol 6.1 자신과 비교하게 되어 쓰지 않는다.
- **한계:** 저장된 GPT 응답을 재사용했다. 실제로 다시 부를 때 생기는 응답 편차는 빠져 있다.

| 6개 변형 평균 (Claude 답안지) | G1 | G2 | S1 | S2 | GPT 호출 |
|---|---:|---:|---:|---:|---:|
| 로컬 단독 | 65.9% | 51.1% | 6~16 | 0~2 | 0% |
| gate | 69.8% | 64.1% | **3** | **0** | 37~49% (93~124/253) |
| gate-propose | 67.8% | 59.8% | 1~2 | 0 | 21~30% (54~75/253) |
| sol 6.1 단독 | 73.5% | 72.8% | 3 | 0 | 100% |

**gate의 sol 6.1 대비 판정**

| 변형 | G1 | G2 | GPT 호출 |
|---|---|---|---:|
| 4비트 seed 7 | −5.1 [−9.1, −1.2] 판정 불가 | −10.1 [−15.9, −4.8] 판정 불가 | 93 |
| 4비트 seed 8 | −4.7 [−7.5, −2.0] 판정 불가 | −6.6 [−11.1, −2.6] 판정 불가 | 119 |
| 4비트 seed 9 | −1.6 [−4.7, +1.6] **비열등** | −7.4 [−12.0, −3.3] 판정 불가 | 118 |
| 8비트 seed 7 | −2.8 [−6.3, +1.2] 판정 불가 | −7.9 [−12.8, −3.3] 판정 불가 | 100 |
| 8비트 seed 8 | −4.7 [−8.3, −1.2] 판정 불가 | −11.9 [−18.1, −6.2] 미달 | 104 |
| 8비트 seed 9 | −3.6 [−6.3, −0.4] 판정 불가 | −8.7 [−13.8, −4.0] 판정 불가 | 124 |

**로컬이 무변경으로 거른 사례의 Claude 라벨**
- 로컬은 129~159건을 무변경으로 걸렀다. 그중 실제 무변경은 96~112건이다.
- 변경 제안은 15~21건이다. Claude 라벨의 변경 제안 86건 가운데 17~24%를 GPT에 보내지 못하고 놓친다.
- 확인 필요는 16~27건이다. 확인 필요 46건 가운데 35~59%다.

**읽는 법**
- **금지 변경(S1)이 가장 크게 좋아졌다.** 로컬 단독은 6~16건인데 gate는 6개 변형 모두 3건으로 기준을 통과한다. 세부 변경을 GPT가 쓰기 때문이다. S2도 모두 0이다.
- **변경 F1은 평균 +13.0%p 오른다.** 로컬 단독 51.1%에서 64.1%로, sol 6.1과의 차이가 21.7%p에서 8.7%p로 준다.
- **GPT 호출은 51~63% 준다.**
- **남은 차이는 로컬이 거른 사례에서 나온다.** 로컬이 무변경으로 넘긴 변경 제안·확인 필요는 GPT도 볼 수 없다. 로컬이 확신할 때만 거르도록 무변경 확률에 문턱을 두는 방법이 있다. 아직 재지 않았다.
- **gate-propose는 gate보다 낫지 않다.** 로컬의 확인 필요 판단이 약해서다.
- **비열등이 나온 칸은 골라 읽지 않는다.** 6개 중 1개 변형·1개 지표만 비열등이다.

## 남는 한계

- Claude 라벨 일치도이지 정확도가 아니다. sol 6.1도 Claude 답안지와 결정이 73.5%만 일치한다.
- 사례당 1회 실행이다. GPT는 비결정적이다.
- 학습 한 번의 결과가 seed에 따라 크게 흔들린다(G2 최대 5.7%p, S1 6~16건). seed 3회 평균으로 비교했다.
- `score_case`는 새 업무 제목·담당자·마감·공수·근거를 채점하지 않는다.
- 보류 A를 여러 번 봤다. 고른 설정을 확인할 새 시험지가 필요하다.
- GitHub 댓글 성능이 계획서·체크인 성능을 보장하지 않는다. 앱에서 실제로 붙여 넣는 원문 표본으로는 평가하지 않았다.
- 인젝션 fixture 게이트는 이번 변형들로 다시 재지 않았다.

## 결론

- 파인튜닝은 sol 6.1을 따라 하는 정도를 크게 올렸다(결정 일치 45.5% → 75.8%).
- 하지만 Claude 답안지로 sol 6.1에 비열등하지 않다. 변경 F1이 모든 변형에서 미달이고, 금지 변경이 대부분 기준을 넘는다.
- 앱에는 넣지 않는다. 로컬이 무변경을 거르고 GPT가 변경을 쓰는 혼합 방식이 가장 쓸모 있어 보이지만, 실험 기록으로만 남긴다(2026-11-19 결정).

## 명령

```bash
# sol 6.1 답안지와 재라벨링
python3 evals/github-timeline-state-change-2026-09-11/run.py --variant sol61-low --all
python3 evals/local-model/make_split.py --relabel-queue
python3 evals/github-timeline-state-change-2026-09-11/run.py --variant sol61-low --all \
  --candidates evals/local-model/out/queue-relabel.jsonl --results-dir evals/local-model/out/gpt61-labels/relabel
python3 evals/local-model/make_split.py --relabel evals/local-model/out/gpt61-labels/relabel

# 학습 (데스크톱, seed 7·8·9)
python train.py --train train-messages-1000-sol61.jsonl --dev dev-messages-all-sol61.jsonl --out out --epochs 3 --seed 7
python convert_lora_to_gguf.py --base C:\train\Qwen3.5-4B --outtype f16 --outfile adapter-e2.gguf out\checkpoint-250

# 평가 (llama-server에 어댑터를 올리고 터널로 연결한 뒤)
EVAL_API_URL=http://127.0.0.1:8081/v1/chat/completions EVAL_API_KEY=local EVAL_ADAPTER_SHA=<sha16> \
  python3 evals/github-timeline-state-change-2026-09-11/run.py --variant local --all --workers 1 \
  --results-dir evals/github-timeline-state-change-2026-09-11/results/local-lora-<sha16>

# 비교
python3 evals/local-model/compare.py --baseline sol61-low --answer-key claude --results .../local-base --results .../local-lora-<sha16> ...
python3 evals/local-model/pool.py --baseline sol61-low --answer-key gpt --a .../local-base --b .../local-lora-<seed7> --b ... --b ...
python3 evals/local-model/hybrid.py --baseline sol61-low .../local-lora-<sha16> ...
```

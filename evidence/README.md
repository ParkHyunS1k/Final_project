# 실험 증거

로컬 모델(Qwen3.5 4B + LoRA) 실험을 실제로 했다는 기록이다. 결과 해석은 `../REPORT.md`, 흐름은 `../IMPROVEMENT.md`에 있다.

| 경로 | 내용 |
|---|---|
| `train-logs/<run>-summary.json` | 학습마다 step별 손실, epoch별 dev 손실, seed, 학습 시간, 최대 VRAM (데스크톱 `C:\train\<run>\out\summary.json` 원본) |
| `compare/compare-*.json` | `compare.py` 출력. 변형별 지표와 짝 부트스트랩 구간 |
| `compare/pool-*.txt` | `pool.py` 출력. seed 3회 평균끼리의 비교 |
| `compare/hybrid-claude.txt` | `hybrid.py` 출력. 로컬이 거르고 GPT가 변경을 쓰는 혼합 방식 |
| `compare/server-check-*.json` | 평가 직전 llama-server가 실제로 올린 기본 모델·어댑터·배율 기록 |
| `SHA256SUMS.txt` | 공개하지 않은 어댑터 11개와 학습·검증 데이터의 sha256 |
| `../results/local-*/` | 보류 A 253건에 대한 로컬 모델 응답. 각 파일에 어댑터 해시·프롬프트 해시·지연이 있다 |

**공개하지 않은 것**
- 학습 데이터와 어댑터는 올리지 않았다. 데이터에는 다른 사람의 GitHub 이슈 원문과 GPT 라벨이 들어 있고, 어댑터는 그 데이터로 학습했다. 저장소가 공개라서 해시만 올린다(사용자 결정 2026-11-19).
- 로컬 파일이 실험에 쓴 그 파일인지는 `shasum -a 256 <파일>`로 대조한다.
- 앱(web/)에 붙여 본 실험 코드도 이 브랜치에 없다. 운영 코드를 바꾸지 않기 위해서다.

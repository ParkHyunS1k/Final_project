"""seed 여러 개의 평균끼리 비교한다. 사례 단위 짝 부트스트랩(10,000회, seed 7, 양측 90%).

    python3 evals/local-model/pool.py --answer-key gpt \
      --a results/local-q8-lora-<seed7> --a ... --b results/local-q8-lora-<1000건 seed7> --b ...

- 모든 결과 폴더가 같은 253건이라 한 번 뽑은 사례 묶음을 양쪽 모든 seed에 함께 쓴다.
- 차이는 (B seed 평균) − (A seed 평균). 서버 확인·해시 검사는 compare.py와 같다.
"""
import argparse
import random
import statistics

import compare as c


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--a", type=c.Path, action="append", required=True)
    p.add_argument("--b", type=c.Path, action="append", required=True)
    p.add_argument("--answer-key", choices=("claude", "gpt"), default="claude")
    args = p.parse_args()
    baseline = c.load(c.TL / "results" / "sol-low")
    labels = c.gpt_key(baseline) if args.answer_key == "gpt" else c.LABELS

    def cases(d):
        records = c.load(d)
        c.check_local(records, d, baseline)
        return c.per_case(records, labels)

    a, b = [cases(d) for d in args.a], [cases(d) for d in args.b]
    mean = lambda runs, key, idx=None: statistics.mean(c.metrics(r, idx)[key] for r in runs)
    rng, n = random.Random(c.SEED), len(c.IDS)
    boot = {"G1": [], "G2": []}
    for _ in range(c.BOOT):
        idx = [rng.randrange(n) for _ in range(n)]
        for k in boot:
            boot[k].append(mean(b, k, idx) - mean(a, k, idx))
    for k, diffs in boot.items():
        diffs.sort()
        each = lambda runs: " / ".join(f"{100 * c.metrics(r)[k]:.1f}" for r in runs)
        print(f"{k}: A {100 * mean(a, k):.1f} ({each(a)})  B {100 * mean(b, k):.1f} ({each(b)})  "
              f"B−A {c.pct(mean(b, k) - mean(a, k))} [{c.pct(diffs[int(0.05 * c.BOOT)])}, {c.pct(diffs[int(0.95 * c.BOOT) - 1])}]")


if __name__ == "__main__":
    main()

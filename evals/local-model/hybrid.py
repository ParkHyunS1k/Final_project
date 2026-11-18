"""혼합 방식: 로컬이 무변경이라고 하면 GPT를 부르지 않고, 그 밖에는 GPT 응답을 쓴다. 저장된 결과로 계산한다.

    python3 evals/local-model/hybrid.py results/local-lora-<sha16> [...]

- 변형 gate: 로컬 no_change → 로컬 응답, 그 밖(propose_changes·needs_clarification) → GPT(sol low) 응답 그대로.
- 변형 gate-propose: 로컬 propose_changes일 때만 GPT, 그 밖은 로컬 응답(확인 필요도 로컬이 쓴다).
- 답안지는 Claude 라벨(7절). GPT 답안지는 GPT 자신과 비교하게 되어 쓰지 않는다.
- GPT 호출률과 sol low 대비 7절 판정을 함께 낸다. 저장된 GPT 응답을 재사용하므로 실제로 부를 때의 응답 편차는 빠진다.
"""
import argparse
import statistics

import compare as c


def mix(local, gpt, call):
    out = {}
    for cid in c.IDS:
        r = local.get(cid)
        d = r["response"]["decision"] if r and r["status"] == "success" else "failed"
        out[cid] = gpt[cid] if call(d) else r
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("results", type=c.Path, nargs="+")
    args = p.parse_args()
    gpt = c.load(c.TL / "results" / "sol-low")
    base = c.per_case(gpt)
    rules = {"gate": lambda d: d != "no_change", "gate-propose": lambda d: d == "propose_changes"}
    rows = {k: [] for k in ("local", *rules)}
    for d in args.results:
        local = c.load(d)
        c.check_local(local, d, gpt)
        variants = {"local": (local, None)} | {k: (mix(local, gpt, f), f) for k, f in rules.items()}
        for name, (records, f) in variants.items():
            cases = c.per_case(records)
            row = c.compare("sol-low", base, name, cases)
            calls = sum(f(local[i]["response"]["decision"]) for i in c.IDS) if f else 0
            a = c.score.aggregate(cases, list(records.values()))
            m = c.metrics(cases)
            rows[name].append(m)
            print(f"{d.name[-16:]} {name:12} G1 {100 * m['G1']:.1f} G2 {100 * m['G2']:.1f} "
                  f"S1 {a['forbidden_hit_cases']} S2 {a['invalid_task_refs']} GPT호출 {calls}/253 | "
                  f"G1 {row['G1']} {row['G1_verdict']} | G2 {row['G2']} {row['G2_verdict']}")
    for name, ms in rows.items():
        print(f"평균 {name:12} G1 {100 * statistics.mean(x['G1'] for x in ms):.1f} "
              f"G2 {100 * statistics.mean(x['G2'] for x in ms):.1f}")
    m = c.metrics(base)
    print(f"sol low      G1 {100 * m['G1']:.1f} G2 {100 * m['G2']:.1f}")


if __name__ == "__main__":
    main()

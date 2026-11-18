"""보류 A(타임라인 253건)에서 로컬 결과를 저장된 GPT 기준선과 비교한다. REPORT 7절(사전 고정 기준)을 계산한다.

    python3 evals/local-model/compare.py --baseline sol-low \
      --results evals/github-timeline-state-change-2026-09-11/results/local-base \
      --results evals/github-timeline-state-change-2026-09-11/results/local-lora-<sha16>

- score.py의 score_case·aggregate만 쓴다. main은 부르지 않아 scores.json을 건드리지 않는다.
- 실패·누락 사례는 빼지 않고 오답(결정 불일치, 변경 0건)으로 넣는다.
- 로컬 결과는 out/server-check-<변형>.json과 어댑터 해시가 맞아야 하고, 사례별 prompt·schema 해시가 기준선과 같아야 한다.
- 구간: 사례 단위 짝 부트스트랩 10,000회, seed 7, 양측 90%. 결정 부호 검정은 기존 REPORT 방식(한쪽만 맞은 수, 양측 이항).
- --results가 둘 이상이면 마지막 − 첫 번째를 '파인튜닝 효과'로 함께 낸다.
- --answer-key gpt: 기준선(GPT) 응답을 답안지로 놓고 '얼마나 GPT처럼 답하는가'를 잰다. 7절 판정과 별개의 분석이다.
  금지 변경은 GPT 답안지에 없어 S1은 0이다. 효과 쌍에는 'GPT와의 차이 중 학습으로 메운 비율'을 붙인다.
"""
import argparse
import importlib.util
import json
import math
import random
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TL = ROOT.parent / "github-timeline-state-change-2026-09-11"
MARGIN = -0.06
BOOT, SEED = 10_000, 7

spec = importlib.util.spec_from_file_location("tl_score", TL / "score.py")
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)


def jsonl(path):
    return [json.loads(x) for x in path.read_text().split("\n") if x]


LABELS = {r["id"]: r for r in jsonl(score.DATA / "labels/claude-blind-v1.jsonl")}
CASES = {r["id"]: r for r in jsonl(score.DATA / "candidates.jsonl")}
IDS = sorted(i for i, r in LABELS.items() if r["review_status"] == "reviewed")
assert len(IDS) == 253, len(IDS)
FAILED = {"decision": "failed", "changes": []}


def load(results_dir):
    records = {}
    for path in results_dir.glob("*.json"):
        r = json.loads(path.read_text())
        records[r["id"]] = r
    return records


def check_local(records, results_dir, baseline):
    """서버 기록·어댑터 해시·프롬프트 해시가 맞지 않으면 실패 종료한다."""
    variant = results_dir.name.removeprefix("local-")
    check = json.loads((ROOT / "out" / f"server-check-{variant}.json").read_text())
    adapter = check["adapter_sha256"][:16] if check["adapter_sha256"] else "base"
    loras = check["lora_adapters"]
    assert (adapter == "base") == (not loras), f"{variant}: 서버 LoRA 상태와 기록이 다르다"
    intended = check.get("intended_scales", [1.0] * len(loras))  # 어댑터 평균 변형만 1/N을 기록한다
    assert len(intended) == len(loras) and all(abs(x["scale"] - s) < 1e-4 for x, s in zip(loras, intended)), \
        f"{variant}: LoRA scale이 기록한 값과 다르다"
    for cid, r in records.items():
        assert r["adapter_sha256"] == adapter, f"{cid}: 결과 어댑터 {r['adapter_sha256']} ≠ 서버 기록 {adapter}"
        b = baseline[cid]
        assert (r["prompt_sha256"], r["schema_sha256"]) == (b["prompt_sha256"], b["schema_sha256"]), \
            f"{cid}: 프롬프트·스키마 해시가 기준선과 다르다"
    return check["model_path"], adapter


def gpt_key(baseline):
    """GPT 응답을 score_case가 읽는 라벨 형식으로 바꾼다."""
    return {cid: {"expected_decision": r["response"]["decision"], "forbidden_changes": [],
                  "expected_changes": [{"kind": c["kind"], "task_id": c["task_id"], "after": {"status": c["status"]}}
                                       for c in r["response"]["changes"]]}
            for cid, r in baseline.items() if cid in LABELS}


def per_case(records, labels=LABELS):
    out = []
    for cid in IDS:
        r = records.get(cid)
        response = r["response"] if r and r["status"] == "success" else FAILED
        tasks = {t["task_id"] for t in CASES[cid]["input"]["prior_project_state"]["tasks"]}
        out.append(score.score_case(labels[cid], response, tasks))
    return out


def metrics(cases, idx=None):
    cs = cases if idx is None else [cases[i] for i in idx]
    matched = sum(c["matched"] for c in cs)
    total = sum(c["expected"] + c["predicted"] for c in cs)
    return {
        "G1": sum(c["decision_match"] for c in cs) / len(cs),
        "G2": 2 * matched / total if total else 0.0,
        "two_class": sum((c["pred_decision"] == "propose_changes") == (c["label_decision"] == "propose_changes")
                         for c in cs) / len(cs),
    }


def interval(a, b, key):
    """b − a의 점 추정과 짝 부트스트랩 90% 구간."""
    rng = random.Random(SEED)
    n = len(a)
    diffs = []
    for _ in range(BOOT):
        idx = [rng.randrange(n) for _ in range(n)]
        diffs.append(metrics(b, idx)[key] - metrics(a, idx)[key])
    diffs.sort()
    return metrics(b)[key] - metrics(a)[key], diffs[int(0.05 * BOOT)], diffs[int(0.95 * BOOT) - 1]


def verdict(lo, hi):
    return "비열등" if lo >= MARGIN else "미달" if hi < MARGIN else "판정 불가"


def sign_test(a, b):
    only_a = sum(x["decision_match"] and not y["decision_match"] for x, y in zip(a, b))
    only_b = sum(y["decision_match"] and not x["decision_match"] for x, y in zip(a, b))
    n, k = only_a + only_b, min(only_a, only_b)
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0
    return only_a, only_b, round(p, 3)


def pct(x):
    return f"{100 * x:+.1f}"


def describe(name, records, cases):
    a = score.aggregate(cases, [r for r in records.values()])
    elapsed = sorted(r["elapsed_seconds"] for r in records.values())
    by_label = {}
    for c in cases:
        hit = by_label.setdefault(c["label_decision"], [0, 0])
        hit[0] += c["decision_match"]
        hit[1] += 1
    m = metrics(cases)
    return {
        "variant": name, "success": sum(r["status"] == "success" for r in records.values()), "missing": 253 - len(records),
        "G1": round(m["G1"], 3), "G2": round(m["G2"], 3), "two_class": round(m["two_class"], 3),
        "S1_forbidden_hit_cases": a["forbidden_hit_cases"], "S2_invalid_task_refs": a["invalid_task_refs"],
        "complete_precision": a["complete_precision"], "complete_recall": a["complete_recall"],
        "noop_false_positive_rate": a["noop_false_positive_rate"],
        "class_recall": {k: f"{v[0]}/{v[1]}" for k, v in sorted(by_label.items())},
        "latency": {"median": statistics.median(elapsed), "p95": elapsed[int(0.95 * len(elapsed)) - 1],
                    "max": elapsed[-1]} if elapsed else None,
        "confusion": a["confusion"],
    }


def compare(base_name, base, name, cases, effect=False):
    row = {"pair": f"{name} − {base_name}"}
    for key in ("G1", "G2", "two_class"):
        d, lo, hi = interval(base, cases, key)
        row[key] = f"{pct(d)} [{pct(lo)}, {pct(hi)}]"
        if key != "two_class":
            row[key + "_verdict"] = ("효과 확인" if lo > 0 else "이 표본에서 확인 못함") if effect else verdict(lo, hi)
    row["sign_test(앞쪽만, 뒤쪽만, p)"] = sign_test(cases, base)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", default="sol-low")
    parser.add_argument("--results", type=Path, action="append", required=True)
    parser.add_argument("--no-server-check", action="store_true", help="저장된 GPT 결과끼리 재현 확인할 때만")
    parser.add_argument("--answer-key", choices=("claude", "gpt"), default="claude")
    args = parser.parse_args()

    baseline = load(TL / "results" / args.baseline)
    assert set(IDS) <= set(baseline), "기준선 결과가 253건이 아니다"
    gpt = args.answer_key == "gpt"
    if gpt:
        assert all(baseline[i]["status"] == "success" for i in IDS), "답안지 GPT에 실패 사례가 있다"
    labels = gpt_key(baseline) if gpt else LABELS
    base_cases = per_case(baseline, labels)
    report = {"answer_key": args.answer_key, "baseline": describe(args.baseline, baseline, base_cases),
              "variants": [], "pairs": []}
    loaded = []
    for results_dir in args.results:
        records = load(results_dir)
        extra = set(records) - set(IDS)
        assert not extra, f"{results_dir.name}: 보류 A 밖 결과 {sorted(extra)[:3]}"
        local = results_dir.name.startswith("local-") and not args.no_server_check
        info = dict(zip(("model_path", "adapter"), check_local(records, results_dir, baseline))) if local else {}
        cases = per_case(records, labels)
        report["variants"].append(describe(results_dir.name, records, cases) | info)
        if not gpt:  # GPT 답안지에서 기준선 자신과의 비교는 늘 100%라 뺀다
            report["pairs"].append(compare(args.baseline, base_cases, results_dir.name, cases))
        loaded.append((results_dir.name, cases))
    if len(loaded) >= 2:
        (first, a), (last, b) = loaded[0], loaded[-1]
        row = compare(first, a, last, b, effect=True) | {"note": "파인튜닝 효과"}
        if gpt:
            ma, mb = metrics(a), metrics(b)
            row["gap_closed"] = {k: round((mb[k] - ma[k]) / (1 - ma[k]), 3) for k in ("G1", "G2")}
        report["pairs"].append(row)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

"""Offline, deterministic generation evaluation of the app's resume contract.

No external judge. Metrics compare reviewed skill/level labels and source ranges;
they do not measure summary quality, employment suitability or general accuracy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]


def score_response(text, expected, request, finish_reason="stop"):
    gold = {(s["skillId"], s["level"]): s for s in expected["skills"]}
    predicted, grounded, errors = set(), set(), []
    valid = False
    try:
        raw = json.loads(text)
        assert finish_reason == "stop", "truncated response"
        assert isinstance(raw, dict) and set(raw) == {"summary", "skills", "questions"}, "output keys"
        assert isinstance(raw["summary"], str) and 0 < len(raw["summary"]) <= 150, "summary"
        assert isinstance(raw["questions"], list) and len(raw["questions"]) <= 3 and all(isinstance(q, str) and q.strip() for q in raw["questions"]), "questions"
        assert isinstance(raw["skills"], list) and len(raw["skills"]) <= 8, "skills"
        vocabulary = {s["id"] for s in request["vocabulary"]}
        seen = set()
        for item in raw["skills"]:
            assert isinstance(item, dict) and set(item) == {"skillId", "level", "startLine", "endLine"}, "skill keys"
            sid, level = item["skillId"], item["level"]
            assert isinstance(sid, str) and sid in vocabulary and sid not in seen, "unknown or duplicate skill"
            assert level in ("applied", "learning", "mentioned"), "level"
            seen.add(sid)
            first, last = item["startLine"], item["endLine"]
            assert type(first) is int and type(last) is int and 1 <= first <= last <= len(request["resume"]), "range"
            # sourceLines can split one line at 240 UTF-16 code units.
            selected = request["resume"][first - 1:last]
            assert sum(len(s["text"].encode("utf-16-le", errors="surrogatepass")) // 2 for s in selected) <= 1200, "range length"
            pair = (sid, level)
            predicted.add(pair)
            target = gold.get(pair)
            if target and first <= target["startLine"] and last >= target["endLine"]:
                grounded.add(pair)
        valid = True
    except (AssertionError, ValueError, TypeError, KeyError) as error:
        errors.append(str(error))
        # Invalid JSON is rejected by the app, so it contributes no usable labels.
        predicted, grounded = set(), set()
    correct = predicted & gold.keys()
    return {
        "schema_valid": valid, "exact_skill_level_set": valid and predicted == gold.keys(),
        "tp": len(correct), "fp": len(predicted - gold.keys()), "fn": len(gold.keys() - predicted),
        "grounded_tp": len(grounded), "expected_count": len(gold),
        "errors": errors, "extra": sorted(predicted - gold.keys()), "missing": sorted(gold.keys() - predicted),
    }


def summarize(records):
    scores = [r["score"] for r in records]
    tp, fp, fn = (sum(s[k] for s in scores) for k in ("tp", "fp", "fn"))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "examples": len(scores), "schema_valid": sum(s["schema_valid"] for s in scores),
        "exact_skill_level_sets": sum(s["exact_skill_level_set"] for s in scores),
        "tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "grounded_tp": sum(s["grounded_tp"] for s in scores),
        "seconds": sum(r["seconds"] for r in records),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--split", choices=("valid", "test", "train"), default="test")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-tokens", type=int, default=2000)
    args = parser.parse_args()
    os.umask(0o077)
    destination = args.output.resolve()
    if not any(destination.is_relative_to(ROOT / name) for name in ("data", "runs")):
        parser.error("Private evaluation output must be inside local-llm/data or runs")
    if not args.model.is_dir() or (args.adapter and not args.adapter.is_dir()):
        parser.error("Only existing local model and adapter directories are accepted")
    manifest = json.loads((args.data / "manifest.json").read_text())
    for name, sha in manifest["files"].items():
        if hashlib.sha256((args.data / name).read_bytes()).hexdigest() != sha:
            parser.error("Dataset differs from frozen manifest")
    rows = [json.loads(line) for line in (args.data / f"{args.split}.jsonl").read_text().splitlines()]
    ids = [r["id"] for r in manifest["examples"] if r["split"] == args.split]
    assert len(ids) == len(rows)
    destination.mkdir(parents=True, mode=0o700, exist_ok=False)
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_IMPLICIT_TOKEN"):
        os.environ[key] = "1"
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler
    model, tokenizer = load(str(args.model.resolve()), adapter_path=str(args.adapter.resolve()) if args.adapter else None)
    records = []
    for key, row in zip(ids, rows, strict=True):
        mx.random.seed(42)
        messages = row["messages"]
        prompt = tokenizer.apply_chat_template(messages[:-1], add_generation_prompt=True, tokenize=False)
        start = time.monotonic()
        parts, last = [], None
        for last in stream_generate(model, tokenizer, prompt=prompt, max_tokens=args.max_tokens, sampler=make_sampler(temp=0)):
            parts.append(last.text)
        output = "".join(parts)
        score = score_response(output, json.loads(messages[-1]["content"]), json.loads(messages[1]["content"]), last.finish_reason if last else None)
        record = {"id": key, "response": output, "finish_reason": last.finish_reason if last else None,
                  "seconds": time.monotonic() - start, "score": score}
        records.append(record)
        with (destination / "predictions.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(json.dumps({"id": key, "score": score, "seconds": round(record["seconds"], 2)}), flush=True)
        mx.clear_cache()
    result = {"split": args.split, "model": str(args.model), "adapter": str(args.adapter) if args.adapter else None,
              "temperature": 0, "max_tokens": args.max_tokens, "manifest_sha256": hashlib.sha256((args.data / "manifest.json").read_bytes()).hexdigest(),
              "metrics": summarize(records)}
    (destination / "metrics.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["metrics"]), flush=True)


if __name__ == "__main__":
    main()

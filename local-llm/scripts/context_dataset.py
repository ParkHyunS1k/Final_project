"""Export reviewed, person-grouped experimental extraction examples privately."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

from context_contract import SYSTEM, validate

ROOT = Path(__file__).resolve().parents[1]


def export(rows, vocabulary, output):
    groups, seen, files = {}, set(), {}
    for row in rows:
        assert row["id"] not in seen, "duplicate example ID"
        seen.add(row["id"])
        group, split = row["leakage_group_id"], row["split"]
        assert split in ("train", "valid", "test")
        assert group not in groups or groups[group] == split, "person/family crosses splits"
        groups[group] = split
        assert row["review"]["source_checked"] and row["review"]["labels_checked"], "review required"
        blocks = row["blocks"]
        assert blocks and all(isinstance(b["text"], str) and b["text"].strip() for b in blocks)
        body = "\n".join(b["text"] for b in blocks)
        assert not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|01[016789][- ]?\d{3,4}[- ]?\d{4}|\d{6}[- ]?[1-4]\d{6}", body), "possible personal identifier"
        if row["kind"] == "source_context":
            assert all(b["source"]["source_id"] == row["source_id"] for b in blocks), "mixed source documents"
            a, b = row["case_pages"]
            assert all(a <= x["source"]["pdf_page"] <= b for x in blocks), "outside reviewed person boundary"
        elif row["kind"] != "synthetic":
            raise ValueError("Unknown provenance")
        request = {"resume": [{"id": i+1, "text": b["text"]} for i, b in enumerate(blocks)], "vocabulary": vocabulary}
        validate(row["expected"], request)
        row["messages"] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(request, ensure_ascii=False)}, {"role": "assistant", "content": json.dumps(row["expected"], ensure_ascii=False)}]
    for split in ("train", "valid", "test"):
        selected = [r for r in rows if r["split"] == split]
        assert selected, "all splits required"
        files[f"{split}.jsonl"] = "".join(json.dumps({"messages": r["messages"]}, ensure_ascii=False) + "\n" for r in selected)
    def sha(value):
        return hashlib.sha256(value.encode()).hexdigest()
    manifest = {"schema": "person-context-technologies-v2", "app_compatible": False,
                "system_prompt_sha256": sha(SYSTEM), "files": {k: sha(v) for k, v in files.items()},
                "examples": [{k: r[k] for k in ("id", "kind", "leakage_group_id", "split", "review")} for r in rows],
                "groups": groups, "human_adjudicated": False,
                "scope": "Selected technical context across related pages, not all pages or people in the books."}
    output = output.resolve()
    assert output.is_relative_to((ROOT / "data").resolve()), "private output directory required"
    os.umask(0o077)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    for name, value in files.items():
        (output / name).write_text(value)
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("annotations", type=Path)
    parser.add_argument("vocabulary", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = [json.loads(x) for x in args.annotations.read_text().splitlines()]
    export(rows, json.loads(args.vocabulary.read_text()), args.output)
    print(json.dumps({"examples": len(rows), "splits": {s: sum(r["split"] == s for r in rows) for s in ("train", "valid", "test")}}))

"""Train answer-only JSON SFT without injecting reasoning/tool markup into labels."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


class JsonAnswerDataset:
    def __init__(self, rows, tokenizer):
        self.rows, self.tokenizer = rows, tokenizer

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        return self.rows[index]

    def process(self, row):
        messages = row["messages"]
        if [m["role"] for m in messages] != ["system", "user", "assistant"]:
            raise ValueError("Expected one system/user/assistant example")
        answer = messages[-1]["content"]
        decoded = json.loads(answer)
        if not isinstance(decoded, dict) or set(decoded) not in ({"summary", "skills", "questions"}, {"summary", "skills", "technologies", "questions"}):
            raise ValueError("Expected a resume JSON answer")
        # Rendering a completed chat can insert an empty reasoning block in the
        # pinned community template. Reuse the actual inference prefix instead.
        prefix = self.tokenizer.apply_chat_template(messages[:-1], add_generation_prompt=True, return_dict=False)
        completion = self.tokenizer.encode(answer, add_special_tokens=False)
        if self.tokenizer.decode(completion) != answer:
            raise ValueError("Answer does not round-trip through the tokenizer")
        eos = self.tokenizer.eos_token_id
        if not isinstance(eos, int):
            raise ValueError("A concrete EOS token is required")
        return prefix + completion + [eos], len(prefix)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_IMPLICIT_TOKEN"):
        os.environ[key] = "1"
    import yaml
    import numpy as np
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.lora import CONFIG_DEFAULTS, train_model
    from mlx_lm.sample_utils import make_sampler
    from mlx_lm.tuner.trainer import TrainingCallback
    from evaluate_adapter import score_response

    cfg = {**CONFIG_DEFAULTS, **yaml.safe_load(args.config.read_text())}
    if cfg.get("completion_format") not in ("plain-json-v1", "context-json-v2") or not cfg["mask_prompt"]:
        parser.error("This runner requires a JSON contract and answer-only loss")
    model_path, data, output = (Path(cfg[k]).resolve() for k in ("model", "data", "adapter_path"))
    if not model_path.is_dir() or not data.is_relative_to(ROOT / "data") or not output.is_relative_to(ROOT / "adapters"):
        parser.error("Use local model, data and adapter directories")
    manifest = json.loads((data / "manifest.json").read_text())
    datasets = {}
    for split in ("train", "valid"):
        raw = (data / f"{split}.jsonl").read_bytes()
        if hashlib.sha256(raw).hexdigest() != manifest["files"][f"{split}.jsonl"]:
            parser.error("Dataset changed after review/export")
        datasets[split] = [json.loads(line) for line in raw.decode().splitlines()]
    cfg["report_to"] = None
    np.random.seed(cfg["seed"])
    model, tokenizer = load(str(model_path))
    train, valid = (JsonAnswerDataset(datasets[s], tokenizer) for s in ("train", "valid"))
    lengths = []
    for dataset in (train, valid):
        for row in dataset.rows:
            tokens, offset = dataset.process(row)
            assert 0 < offset < len(tokens) <= cfg["max_seq_length"], "Refusing to truncate a training example"
            assert tokenizer.decode(tokens[offset:-1]) == row["messages"][-1]["content"]
            lengths.append(len(tokens))
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    (output / "preflight.json").write_text(json.dumps({"completion_format": cfg["completion_format"], "train_examples": len(train), "valid_examples": len(valid), "maximum_tokens": max(lengths), "exact_answer_roundtrip": True}, indent=2))

    class Callback(TrainingCallback):
        def on_train_loss_report(self, info):
            with (output / "training-metrics.jsonl").open("a") as handle:
                handle.write(json.dumps({"kind": "train", **info}) + "\n")

        def on_val_loss_report(self, info):
            with (output / "training-metrics.jsonl").open("a") as handle:
                handle.write(json.dumps({"kind": "valid", **info}) + "\n")
            # Format smoke test on validation only, never on final-test cases.
            if info["iteration"] == 19:
                row = datasets["valid"][0]
                prompt = tokenizer.apply_chat_template(row["messages"][:-1], add_generation_prompt=True, tokenize=False)
                parts, last = [], None
                for last in stream_generate(model, tokenizer, prompt=prompt, max_tokens=2000, sampler=make_sampler(temp=0)):
                    parts.append(last.text)
                response = "".join(parts)
                score = score_response(response, json.loads(row["messages"][-1]["content"]), json.loads(row["messages"][1]["content"]), last.finish_reason if last else None)
                (output / "validation-format-smoke.json").write_text(json.dumps({"iteration": 19, "response": response, "score": score}, ensure_ascii=False, indent=2))
                print(json.dumps({"validation_format_smoke": score}), flush=True)
                model.train()
                mx.clear_cache()

    train_model(SimpleNamespace(**cfg), model, train, valid, Callback())


if __name__ == "__main__":
    main()

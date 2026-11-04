"""Select a saved adapter by validation loss only, without reading test examples."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--checkpoints", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if not args.output.resolve().is_relative_to(ROOT / "adapters"):
        parser.error("Selected adapter must be inside local-llm/adapters")
    if not args.model.is_dir() or not args.checkpoints.is_dir():
        parser.error("Model and checkpoint directories must already exist locally")
    manifest = json.loads((args.data / "manifest.json").read_text())
    data_bytes = (args.data / "valid.jsonl").read_bytes()
    if hashlib.sha256(data_bytes).hexdigest() != manifest["files"]["valid.jsonl"]:
        parser.error("Validation data changed after export")
    checkpoints = sorted(args.checkpoints.glob("[0-9]*_adapters.safetensors"))
    if not checkpoints:
        parser.error("No saved checkpoints")
    if args.output.exists():
        parser.error("Output already exists; refusing to overwrite")
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_IMPLICIT_TOKEN"):
        os.environ[key] = "1"
    import mlx.core as mx
    from mlx_lm import load
    from mlx_lm.tuner.datasets import ChatDataset, CacheDataset
    from mlx_lm.tuner.trainer import evaluate
    from mlx_lm.tuner.utils import linear_to_lora_layers
    from train_adapter import JsonAnswerDataset
    config = json.loads((args.checkpoints / "adapter_config.json").read_text())
    model, tokenizer = load(str(args.model.resolve()))
    rows = [json.loads(line) for line in data_bytes.decode().splitlines()]
    dataset = CacheDataset(JsonAnswerDataset(rows, tokenizer) if config.get("completion_format") == "plain-json-v1" else ChatDataset(rows, tokenizer, mask_prompt=True))

    def validation_loss():
        value = evaluate(model, dataset, batch_size=1, num_batches=-1, max_seq_length=2048)
        if not math.isfinite(value):
            raise ValueError("Non-finite validation loss")
        mx.clear_cache()
        return value

    baseline = validation_loss()
    model.freeze()
    linear_to_lora_layers(model, config["num_layers"], config["lora_parameters"])
    results = []
    for checkpoint in checkpoints:
        model.load_weights(str(checkpoint), strict=False)
        record = {"checkpoint": checkpoint.name, "validation_loss": validation_loss()}
        results.append(record)
        print(json.dumps(record), flush=True)
    selected = min(results, key=lambda r: r["validation_loss"])
    args.output.mkdir(parents=True, mode=0o700)
    shutil.copy2(args.checkpoints / selected["checkpoint"], args.output / "adapters.safetensors")
    shutil.copy2(args.checkpoints / "adapter_config.json", args.output / "adapter_config.json")
    report = {"criterion": "lowest answer-only validation loss; test data not read", "validation_examples": len(rows),
              "baseline_validation_loss": baseline, "candidates": results, "selected": selected,
              "adapter_sha256": hashlib.sha256((args.output / "adapters.safetensors").read_bytes()).hexdigest(),
              "manifest_sha256": hashlib.sha256((args.data / "manifest.json").read_bytes()).hexdigest()}
    (args.output / "selection.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()

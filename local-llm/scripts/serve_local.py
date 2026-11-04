"""Run MLX with local files and a loopback listener. No cloud inference fallback."""

import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8089)
    parser.add_argument("--adapter", type=Path)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Use a port between 1024 and 65535.")
    model = ROOT / "models/qwen3-4b-instruct-4bit"
    if not (model / "model.safetensors").is_file():
        parser.error("Run scripts/download_model.py first.")
    command = [
        sys.executable,
        "-m",
        "mlx_lm.server",
        "--model",
        "models/qwen3-4b-instruct-4bit",
        "--host",
        "127.0.0.1",
        "--port",
        str(args.port),
        "--log-level",
        "WARNING",
        "--allowed-origins",
        "http://127.0.0.1:3287",
    ]
    if args.adapter:
        adapter = args.adapter.resolve()
        if (
            not (adapter / "adapters.safetensors").is_file()
            or not (adapter / "adapter_config.json").is_file()
        ):
            parser.error("Adapter weights and adapter_config.json are required.")
        command += ["--adapter-path", str(adapter)]
    env = {
        **os.environ,
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
    }
    os.chdir(ROOT)
    os.execve(sys.executable, command, env)


if __name__ == "__main__":
    main()

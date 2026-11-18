"""Download pinned public weights without uploading documents or using saved tokens."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = "mlx-community/Qwen3-4B-Instruct-2507-4bit"
REVISION = "50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b"


def main():
    os.umask(0o077)
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HOME"] = str(ROOT / "cache/huggingface")
    from huggingface_hub import snapshot_download

    target = ROOT / "models/qwen3-4b-instruct-4bit"
    snapshot_download(
        repo_id=REPO,
        revision=REVISION,
        local_dir=target,
        allow_patterns=[
            "*.json",
            "*.safetensors",
            "*.txt",
            "*.jinja",
            "README.md",
            "LICENSE*",
        ],
        max_workers=4,
        token=False,
    )
    (ROOT / "models/download-manifest.json").write_text(
        json.dumps(
            {
                "repository": REPO,
                "revision": REVISION,
                "local_path": str(target.resolve()),
            },
            indent=2,
        )
    )
    print("Local model download complete.")


if __name__ == "__main__":
    main()

"""Qwen3.5 4B bf16 LoRA 학습(데스크톱 Windows, Unsloth). 맥에서 만든 *-messages.jsonl을 복사해 실행한다.

    C:\\train\\venv\\Scripts\\python.exe train.py --train train-messages.jsonl --dev dev-messages.jsonl --out run1 --epochs 3

입력 행은 {"id", "prompt", "completion"}이다. prompt는 llama-server가 렌더링한 템플릿 문자열(사고 모드 끔)이라
학습과 서빙 템플릿이 같다. 손실은 completion(응답 JSON)에만 건다.
설정은 계획 1단계-5: LoRA r=16, lr 2e-4, batch 1 + 누적 8, 최대 3 epoch, max_seq 4096, seed 7.
"""
import argparse
import json
import time
from pathlib import Path

from unsloth import FastLanguageModel  # trl·transformers보다 먼저 import한다(Unsloth 패치)
import torch
from datasets import Dataset
from trl import SFTConfig, SFTTrainer

parser = argparse.ArgumentParser()
parser.add_argument("--model", default=r"C:\train\Qwen3.5-4B")
parser.add_argument("--train", type=Path, required=True)
parser.add_argument("--dev", type=Path)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--epochs", type=float, default=3)
parser.add_argument("--seed", type=int, default=7)
parser.add_argument("--resume", action="store_true", help="out의 마지막 체크포인트(옵티마이저·RNG 포함)에서 이어 학습")
args = parser.parse_args()


def rows(path):
    lines = [x for x in path.read_text(encoding="utf-8").split("\n") if x]  # U+2028 때문에 splitlines() 금지
    return Dataset.from_list([{k: json.loads(x)[k] for k in ("prompt", "completion")} for x in lines])


model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=args.model, max_seq_length=4096, load_in_4bit=False, load_in_16bit=True, full_finetuning=False)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0, bias="none", random_state=args.seed,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth")

train, dev = rows(args.train), rows(args.dev) if args.dev else None
trainer = SFTTrainer(
    model=model, processing_class=tokenizer, train_dataset=train, eval_dataset=dev,
    args=SFTConfig(
        output_dir=str(args.out), num_train_epochs=args.epochs, learning_rate=2e-4,
        per_device_train_batch_size=1, gradient_accumulation_steps=8, max_length=4096,
        optim="adamw_8bit", lr_scheduler_type="linear", warmup_ratio=0.05, bf16=True,
        logging_steps=1, eval_strategy="epoch" if dev else "no", save_strategy="epoch",
        completion_only_loss=True, packing=False, dataset_num_proc=1, seed=args.seed, report_to="none"))

torch.cuda.reset_peak_memory_stats()
t0 = time.time()
trainer.train(resume_from_checkpoint=True if args.resume else None)
args.out.mkdir(parents=True, exist_ok=True)
model.save_pretrained(args.out / "adapter")
tokenizer.save_pretrained(args.out / "adapter")
summary = {
    "train": len(train), "dev": len(dev) if dev else 0, "epochs": args.epochs, "seed": args.seed,
    "seconds": round(time.time() - t0), "peak_vram_gib": round(torch.cuda.max_memory_allocated() / 2**30, 2),
    "log": trainer.state.log_history,
}
(args.out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: v for k, v in summary.items() if k != "log"}))

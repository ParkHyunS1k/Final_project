"""GitHub 기록 후보(상태형)로 모델 설정을 평가한다. 사례마다 OpenAI Responses API를 한 번 호출한다.

기준은 AI가 쓴 블라인드 라벨(사람 검토 전)이다. 라벨이 제외한 사례는 실행하지 않는다.
API 키는 프로젝트 루트 .env의 OPENAI_API_KEY에서 읽고 결과·로그에 남기지 않는다.
도구는 넘기지 않고, 응답은 JSON Schema strict로 받는다. store=false.

    python3 run.py --variant luna-low --all --workers 6

local 변형은 llama-server 같은 OpenAI 호환 Chat Completions 서버를 부른다. OpenAI 키는 쓰지 않는다.

    EVAL_API_URL=http://127.0.0.1:8080/v1/chat/completions EVAL_API_KEY=local EVAL_ADAPTER_SHA=base \\
      python3 run.py --variant local --candidates smoke.jsonl --all --workers 1
"""
import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
DATA = PROJECT / "datasets/github-timeline-candidates-v1"
LABELS = DATA / "labels/claude-blind-v1.jsonl"
API_URL = "https://api.openai.com/v1/responses"
VARIANTS = {
    "luna-low": ("gpt-5.6-luna", "low"),
    "luna-medium": ("gpt-5.6-luna", "medium"),
    "terra-low": ("gpt-5.6-terra", "low"),
    "sol-low": ("gpt-5.6-sol", "low"),
    "local": ("local", None),
}
LOCAL_SAMPLING = {"temperature": 0, "seed": 7, "max_tokens": 1024}


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def api_key():
    for line in (PROJECT / ".env").read_text().splitlines():
        name, _, value = line.strip().removeprefix("export ").partition("=")
        if name == "OPENAI_API_KEY" and value.strip():
            return value.strip().strip('"').strip("'")
    raise SystemExit(".env에 OPENAI_API_KEY가 없다")


def local_target():
    """local 변형의 (URL, 키, 어댑터 해시). 하나라도 없으면 요청 전에 멈춘다. OpenAI 키로 대체하지 않는다."""
    values = {name: os.environ.get(name, "").strip() for name in ("EVAL_API_URL", "EVAL_API_KEY", "EVAL_ADAPTER_SHA")}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise SystemExit(f"local 변형에는 {', '.join(missing)}가 필요하다")
    return values["EVAL_API_URL"], values["EVAL_API_KEY"], values["EVAL_ADAPTER_SHA"]


def chat_to_responses(raw):
    """Chat Completions 응답을 run_case가 읽는 Responses 모양으로 옮긴다."""
    if "http_error" in raw:
        return raw
    choice = (raw.get("choices") or [{}])[0]
    finish = choice.get("finish_reason")
    usage = raw.get("usage") or {}
    return {
        "status": "completed" if finish == "stop" else "incomplete",
        "incomplete_details": None if finish == "stop" else {"reason": finish},
        "model": raw.get("model"),
        "output": [{"type": "message", "content": [
            {"type": "output_text", "text": (choice.get("message") or {}).get("content") or ""}]}],
        "usage": {"input_tokens": usage.get("prompt_tokens", 0), "output_tokens": usage.get("completion_tokens", 0)},
    }


def build_model_input(row):
    i = row["input"]
    return {
        "id": row["id"],
        "as_of": i["as_of"],
        "thread": {"url": i["thread_url"], "title_as_of": i["thread_title_as_of"]},
        "thread_task_id": "issue-" + i["thread_url"].rsplit("/", 1)[1],
        "anchor_excerpt_index": row["provenance"]["anchor_excerpt_index"],
        "excerpts": [
            {"index": k, "author_login": e["author_login"], "author_account_type": e["author_account_type"],
             "created_at": e["created_at"], "text": e["text"]}
            for k, e in enumerate(i["excerpts"])
        ],
        "current_tasks": i["prior_project_state"]["tasks"],
        "members": i["member_directory"]["logins"],
    }


def call_api(body, key, url=API_URL):
    """429·5xx·네트워크 오류는 지수 백오프로 최대 5번 시도한다."""
    data = json.dumps(body).encode()
    for attempt in range(5):
        request = urllib.request.Request(url, data=data, method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response), attempt
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:1000]
            if error.code != 429 and error.code < 500:
                return {"http_error": error.code, "detail": detail}, attempt
        except (urllib.error.URLError, TimeoutError) as error:
            detail = str(error)
        time.sleep(2 ** attempt * 3)
    return {"http_error": "retries_exhausted", "detail": detail}, attempt


def run_case(variant, row, key, results_dir, candidates_path, target=None):
    """target은 local 변형의 (URL, 키, 어댑터 해시). 없으면 OpenAI Responses API를 key로 부른다."""
    model, effort = VARIANTS[variant]
    cid = row["id"]
    destination = results_dir / f"{cid}.json"
    instructions = (ROOT / "prompt.md").read_text()
    user_input = "CASE DATA:\n" + json.dumps(build_model_input(row), ensure_ascii=False)
    schema_text = (ROOT / "schema.json").read_text()
    prompt_sha = digest(instructions + "\n" + user_input)
    adapter = target[2] if target else None
    if destination.exists():
        old = json.loads(destination.read_text())
        if old["status"] == "success" and old["prompt_sha256"] == prompt_sha \
                and old["schema_sha256"] == digest(schema_text) and old.get("adapter_sha256") == adapter:
            return cid, "cached", old["elapsed_seconds"]
        if old["status"] == "success":
            raise RuntimeError(f"{cid}: 입력이나 어댑터가 바뀌었다. 새 실행 디렉터리를 쓴다.")

    schema = json.loads(schema_text)
    started = datetime.now(timezone.utc).isoformat()
    t0 = time.monotonic()
    if target:
        body = {
            "model": model,
            "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": user_input}],
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "state_change_proposal", "schema": schema, "strict": True}},
            "chat_template_kwargs": {"enable_thinking": False},
            **LOCAL_SAMPLING,
        }
        raw, retries = call_api(body, target[1], target[0])
        raw = chat_to_responses(raw)
    else:
        body = {
            "model": model,
            "reasoning": {"effort": effort},
            "instructions": instructions,
            "input": user_input,
            "text": {"format": {"type": "json_schema", "name": "state_change_proposal",
                                "schema": schema, "strict": True}},
            "store": False,
        }
        raw, retries = call_api(body, key)
    texts = [part.get("text") for item in raw.get("output", []) if item.get("type") == "message"
             for part in item.get("content", []) if part.get("type") == "output_text"]
    refusal = any(part.get("type") == "refusal" for item in raw.get("output", [])
                  for part in item.get("content", []))
    used_tools = [item.get("type") for item in raw.get("output", []) if item.get("type") not in ("message", "reasoning")]
    response, parse_error = None, None
    try:
        response = json.loads(texts[-1]) if texts else None
    except json.JSONDecodeError as error:
        parse_error = str(error)
    usage = raw.get("usage") or {}
    success = raw.get("status") == "completed" and response is not None and response.get("id") == cid \
        and not used_tools and not refusal
    record = {
        "id": cid, "variant": variant, "model_requested": model, "model_reported": raw.get("model"),
        "reasoning_effort": effort,
        "runner": "local_chat_completions" if target else "openai_responses_api",
        "authentication": "eval_api_key" if target else "api_key_from_dotenv",
        "adapter_sha256": adapter, "sampling": LOCAL_SAMPLING if target else None,
        "started_at": started, "elapsed_seconds": round(time.monotonic() - t0, 3), "retries": retries,
        "status": "success" if success else "failed", "api_status": raw.get("status"),
        "incomplete_details": raw.get("incomplete_details"), "http_error": raw.get("http_error"),
        "error_detail": raw.get("detail"), "refusal": refusal,
        "prompt_sha256": prompt_sha, "schema_sha256": digest(schema_text),
        "candidates_sha256": hashlib.sha256(candidates_path.read_bytes()).hexdigest(),
        "usage": {
            "input_tokens": usage.get("input_tokens", 0),
            "cached_input_tokens": (usage.get("input_tokens_details") or {}).get("cached_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "reasoning_output_tokens": (usage.get("output_tokens_details") or {}).get("reasoning_tokens", 0),
        },
        "tool_calls": used_tools, "response": response, "parse_error": parse_error,
    }
    destination.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    return cid, record["status"], record["elapsed_seconds"]


def eligible_rows():
    labels = {r["id"]: r for r in map(json.loads, LABELS.read_text().splitlines())}
    rows = [json.loads(x) for x in (DATA / "candidates.jsonl").read_text().splitlines()]
    return [r for r in rows if labels[r["id"]]["review_status"] == "reviewed"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", required=True, choices=VARIANTS)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ids", nargs="+")
    group.add_argument("--sample", type=Path, help="사례 ID 목록 JSON")
    group.add_argument("--all", action="store_true")
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--candidates", type=Path, help="이 후보 파일의 모든 행을 쓴다(라벨 필터 없음)")
    parser.add_argument("--results-dir", type=Path)
    args = parser.parse_args()
    if args.variant == "local":
        target, key = local_target(), None
        default_dir = ROOT / "results" / f"local-{target[2]}"
    else:
        target, key = None, api_key()
        default_dir = ROOT / "results" / args.variant
    results_dir = args.results_dir or default_dir
    results_dir.mkdir(parents=True, exist_ok=True)
    candidates_path = args.candidates or DATA / "candidates.jsonl"
    # JSONL은 \n으로만 나눈다. 원문의 U+2028을 splitlines()가 줄바꿈으로 본다.
    rows = [json.loads(x) for x in args.candidates.read_text().split("\n") if x] if args.candidates else eligible_rows()
    ids = {r["id"] for r in rows}
    selected = ids if args.all else set(args.ids or json.loads(args.sample.read_text())["ids"])
    assert selected <= ids, f"제외됐거나 없는 사례: {sorted(selected - ids)[:5]}"
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = [pool.submit(run_case, args.variant, row, key, results_dir, candidates_path, target)
                for row in rows if row["id"] in selected]
        for job in as_completed(jobs):
            print(*job.result(), flush=True)


if __name__ == "__main__":
    main()

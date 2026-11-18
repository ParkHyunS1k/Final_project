"""로컬 모델 실험의 입력 파일을 만든다.

    python3 evals/local-model/make_split.py --smoke   # 스모크 3건
    python3 evals/local-model/make_split.py --split   # 검증·학습 라벨링 대기열 (저장소 단위 분리)
    python3 evals/local-model/make_split.py --check   # 분할 재현·분리 조건·REPORT 해시 확인
    python3 evals/local-model/make_split.py --build-train [--labels out/labels-human.jsonl | --gpt-labels out/gpt-labels]
        # 사용자 라벨 → 학습·검증 예제. 8080 llama-server로 템플릿 렌더링·토큰 수를 잰다.

대기열 순서대로 라벨링하고 목표(TARGET)를 채우면 멈춘다. 제외한 사례는 다음 사례로 채운다.
역할 분담이 모자라면 타임라인으로 채우고 대체 건수를 REPORT에 적는다.
"""
import argparse
import hashlib
import importlib.util
import json
import random
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
DATASETS = ROOT.parents[1] / "datasets"
TL = DATASETS / "github-timeline-candidates-v1"
RD = DATASETS / "github-role-division-candidates-v1"
HELD_OUT = TL / "candidates.jsonl"
POOL = TL / "runs/pre2025/candidates.jsonl"
SOURCES = {
    "held_a": TL / "candidates.jsonl", "held_a_labels": TL / "labels/claude-blind-v1.jsonl",
    "held_b": RD / "candidates.jsonl", "held_b_labels": RD / "labels/claude-blind-v1.jsonl",
    "tl_pre2025": POOL, "tl_all_years": TL / "runs/all-years/candidates.jsonl",
    "rd_search": RD / "runs/search-2026-09-11/candidates.jsonl",
}
SMOKE_IDS = ["GH-TL-1001835448", "GH-TL-1007234121", "GH-TL-1018048681"]
SEED = 7
TARGET = {"dev": {"tl": 32, "rd": 8}, "train": {"tl": 60, "rd": 40}}
DEV_QUEUE = {"tl": 39, "rd": 10}  # 목표 + 제외율 16% 여유. 남은 저장소는 모두 학습 대기열
HELD_COUNTS = {"held_a": 253, "held_b": 48}
TL_EVAL = ROOT.parent / "github-timeline-state-change-2026-09-11"
SERVER = "http://127.0.0.1:8080"
MAX_SEQ = 4096


def load(path):
    return [json.loads(x) for x in path.read_text().split("\n") if x]  # U+2028이 든 원문 때문에 splitlines() 금지


def repo(row):
    return row["provenance"]["repository"].lower()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def round_robin(repos, by_repo):
    """저장소를 정해진 순서로 돌며 한 건씩 꺼낸다. 앞쪽 사례가 여러 저장소에 퍼진다."""
    queues = [list(by_repo[r]) for r in repos]
    out = []
    while any(queues):
        out += [q.pop(0) for q in queues if q]
    return out


def split(tl_rows, rd_rows, held_ids, held_repos, seed=SEED):
    """저장소 단위로 검증·학습을 나눈다. 두 풀에 모두 있는 사례는 역할 분담(rd)으로 센다."""
    cases = {}
    for pool, rows in (("tl", tl_rows), ("rd", rd_rows)):
        for r in rows:
            if r["id"] not in held_ids and repo(r) not in held_repos:
                cases[r["id"]] = {"id": r["id"], "pool": pool, "repo": repo(r)}
    by_repo = {}
    for c in sorted(cases.values(), key=lambda c: c["id"]):
        by_repo.setdefault(c["repo"], []).append(c)
    repos = sorted(by_repo)
    random.Random(seed).shuffle(repos)

    dev_repos, train_repos, filled = [], [], {"tl": 0, "rd": 0}
    for r in repos:
        pools = {c["pool"] for c in by_repo[r]}
        want = filled["rd"] < DEV_QUEUE["rd"] if "rd" in pools else filled["tl"] < DEV_QUEUE["tl"]
        (dev_repos if want else train_repos).append(r)
        if want:
            for c in by_repo[r]:
                filled[c["pool"]] += 1

    train = round_robin(train_repos, by_repo)
    rd = [c for c in train if c["pool"] == "rd"]
    tl = [c for c in train if c["pool"] == "tl"]
    merged = []
    while rd or tl:  # 목표 비율 40:60에 맞춰 2:3으로 섞는다
        merged += rd[:2] + tl[:3]
        rd, tl = rd[2:], tl[3:]
    return {"dev": round_robin(dev_repos, by_repo), "train": merged}


def held_out():
    rows = {k: load(SOURCES[k]) for k in ("held_a", "held_b")}
    for key in rows:
        labels = {r["id"]: r for r in load(SOURCES[key + "_labels"])}
        reviewed = sum(labels[r["id"]]["review_status"] == "reviewed" for r in rows[key])
        assert reviewed == HELD_COUNTS[key], f"{key} 채점 대상 {reviewed}건, 기대 {HELD_COUNTS[key]}건"
    every = rows["held_a"] + rows["held_b"]
    return {r["id"] for r in every}, {repo(r) for r in every}


def build():
    held_ids, held_repos = held_out()
    tl = {}
    for key in ("tl_pre2025", "tl_all_years"):
        for r in load(SOURCES[key]):
            tl.setdefault(r["id"], r)
    rd = load(SOURCES["rd_search"])
    rows = {**tl, **{r["id"]: r for r in rd}}
    texts = [e["text"] for r in rows.values() for e in r["input"]["excerpts"]]
    assert not any(t.startswith("(원문은 원본 링크") for t in texts), "원문이 지워진 데이터다"
    result = split(list(tl.values()), rd, held_ids, held_repos)
    for name in ("dev", "train"):
        ids, repos = {c["id"] for c in result[name]}, {c["repo"] for c in result[name]}
        assert not ids & held_ids and not repos & held_repos, f"{name}이 보류 세트와 겹친다"
    assert not {c["repo"] for c in result["dev"]} & {c["repo"] for c in result["train"]}, "검증·학습 저장소가 겹친다"
    doc = {
        "seed": SEED, "target": TARGET, "dev_queue": DEV_QUEUE,
        "sources": {k: {"path": str(p.relative_to(DATASETS.parent)), "sha256": sha256(p)} for k, p in SOURCES.items()},
        "held_out": {"ids": len(held_ids), "repos": len(held_repos)},
        "dev": result["dev"], "train": result["train"],
    }
    return doc, rows


def queue_text(doc, rows, name):
    return "".join(json.dumps(rows[c["id"]], ensure_ascii=False) + "\n" for c in doc[name])


def summary(doc):
    for name in ("dev", "train"):
        cs = doc[name]
        pools = {p: sum(c["pool"] == p for c in cs) for p in ("tl", "rd")}
        print(f"{name}: {len(cs)}건, 저장소 {len({c['repo'] for c in cs})}개, {pools}")


def write_split():
    doc, rows = build()
    OUT.mkdir(exist_ok=True)
    (OUT / "split.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    observed = {}
    for key in ("tl_pre2025", "tl_all_years", "rd_search"):
        for r in load(SOURCES[key].with_name("observed.jsonl")):
            observed.setdefault(r["id"], r)
    for name in ("dev", "train"):
        (OUT / f"queue-{name}.jsonl").write_text(queue_text(doc, rows, name))
        # review.html이 판단 뒤에 열어 보는 실제 변경. 라벨에는 쓰지 않는다.
        (OUT / f"queue-{name}-observed.jsonl").write_text(queue_text(doc, observed, name))
    summary(doc)
    print("split.json sha256:", sha256(OUT / "split.json"))


def check():
    """분할을 다시 만들어 저장본·대기열·REPORT 머리말의 해시와 같은지 본다."""
    doc, rows = build()
    saved = json.loads((OUT / "split.json").read_text())
    assert saved == doc, "split.json이 원천 데이터에서 다시 만든 분할과 다르다"
    for name in ("dev", "train"):
        assert (OUT / f"queue-{name}.jsonl").read_text() == queue_text(doc, rows, name), f"queue-{name}.jsonl이 다르다"
    report = (ROOT / "REPORT.md").read_text()
    found = re.search(r"split\.json sha256: `([0-9a-f]{64})`", report)
    assert found and found.group(1) == sha256(OUT / "split.json"), "REPORT.md의 split.json 해시가 다르다"
    summary(doc)
    print("check ok")


def load_run():
    spec = importlib.util.spec_from_file_location("tl_run", TL_EVAL / "run.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def target(label, row):
    """사용자 라벨 → schema.json 응답. 규칙은 계획 4절 '학습 예제 변환 규칙'."""
    decision, notes = label["expected_decision"], label.get("notes", "").strip()
    evidence = sorted(label["evidence_excerpt_indices"])
    changes = []
    for x in label["expected_changes"] if decision == "propose_changes" else []:
        kind, after = x["kind"], x.get("after", {})
        assert kind != "remaining", f"{label['id']}: remaining 라벨은 변환 규칙에 없다(값을 만들지 않는다). 사용자 확인 필요"
        changes.append({
            "kind": kind,
            "task_id": None if kind == "createTask" else x["task_id"],
            "status": after.get("status") if kind == "status" else None,
            "person": (after.get("person") or None) if kind in ("assignee", "createTask") else None,
            "remaining_hours": None,
            "due_at": (after.get("dueAt") or None) if kind == "dueAt" else None,
            "title": after.get("title") if kind == "createTask" else None,
            "basis": "fact" if evidence else "estimate",
            "evidence_excerpt_indices": evidence,
        })
    return {
        "id": row["id"],
        "summary_ko": notes,
        "decision": decision,
        "clarification_reason_ko": notes if decision == "needs_clarification" else None,
        "changes": changes,
    }


def check_target(t, row, validator):
    errors = [e.message for e in validator.iter_errors(t)]
    tasks = {x["task_id"] for x in row["input"]["prior_project_state"]["tasks"]}
    members = set(row["input"]["member_directory"]["logins"])
    n = len(row["input"]["excerpts"])
    for c in t["changes"]:
        if c["kind"] != "createTask" and c["task_id"] not in tasks:
            errors.append(f"없는 task_id {c['task_id']}")
        if c["person"] is not None and c["person"] not in members:
            errors.append(f"참여자 목록에 없는 person {c['person']}")
        if any(not 0 <= i < n for i in c["evidence_excerpt_indices"]):
            errors.append("범위 밖 근거 번호")
    if t["decision"] != "propose_changes" and t["changes"]:
        errors.append("변경 제안이 아닌데 변경이 있다")
    return errors


def post(path, body):
    request = urllib.request.Request(SERVER + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def render(system, user, answer):
    """서버(llama-server --jinja)와 같은 템플릿으로 학습 문자열을 만든다. 학습=서빙 템플릿을 보장한다."""
    prompt = post("/apply-template", {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "chat_template_kwargs": {"enable_thinking": False},
    })["prompt"]
    completion = json.dumps(answer, ensure_ascii=False) + "<|im_end|>\n"
    tokens = len(post("/tokenize", {"content": prompt + completion})["tokens"])
    return prompt, completion, tokens


def gpt_answers(gpt_dir):
    """run.py 결과 디렉터리(dev/, train/)의 성공 응답. 응답은 이미 schema.json 형식이다."""
    answers = {}
    for path in sorted(gpt_dir.glob("*/*.json")):
        record = json.loads(path.read_text())
        if record["status"] == "success":
            answers[record["id"]] = (record["response"], None)
    return answers


def example(cid, row, answer, run, system, validator, skipped, strict=False):
    """정답 하나를 학습 예제로 렌더링한다. 검증 실패·길이 초과는 skipped에 적고 None을 돌려준다."""
    errors = check_target(answer, row, validator)
    if errors:
        assert not strict, f"{cid}: {errors}"  # 사람 라벨 오류는 고쳐야 한다
        skipped.append((cid, errors[0]))
        return None
    user = "CASE DATA:\n" + json.dumps(run.build_model_input(row), ensure_ascii=False)
    prompt, completion, tokens = render(system, user, answer)
    if tokens > MAX_SEQ:
        skipped.append((cid, f"토큰 {tokens}"))
        return None
    return {"id": cid, "row": row, "prompt": prompt, "completion": completion, "tokens": tokens}


def build_train(labels_path, gpt_dir=None, all_train=False):
    """라벨 → 학습·검증 예제. 대기열 순서대로 TARGET(저장소 풀별 목표)을 채우면 멈춘다.

    all_train: 학습 목표 없이 학습 대기열을 모두 쓴다(검증은 같다). 결과 파일 이름에 -all을 붙인다."""
    import jsonschema

    run = load_run()
    system = (TL_EVAL / "prompt.md").read_text()
    validator = jsonschema.Draft202012Validator(json.loads((TL_EVAL / "schema.json").read_text()))
    doc, rows = build()
    if gpt_dir:
        answers = gpt_answers(gpt_dir)
    else:
        answers = {r["id"]: (target(r, rows[r["id"]]), r.get("decision_seconds"))
                   for r in load(labels_path) if r["review_status"] == "reviewed" and r["id"] in rows}
    skipped = []
    target, suffix = TARGET, ""
    if all_train:
        target, suffix = TARGET | {"train": {"tl": 10**9, "rd": 10**9}}, "-all"
    for name in ("dev", "train"):
        items, counts, filled = [], {}, {"tl": 0, "rd": 0}
        for c in doc[name]:
            if c["id"] not in answers or filled[c["pool"]] >= target[name][c["pool"]]:
                continue
            answer, seconds = answers[c["id"]]
            item = example(c["id"], rows[c["id"]], answer, run, system, validator, skipped, strict=not gpt_dir)
            if not item:
                continue
            filled[c["pool"]] += 1
            items.append(item | {"seconds": seconds})
            for k in [x["kind"] for x in answer["changes"]] or [answer["decision"]]:
                counts[k] = counts.get(k, 0) + 1
        (OUT / f"{name}-messages{suffix}.jsonl").write_text("".join(
            json.dumps({"id": x["id"], "prompt": x["prompt"], "completion": x["completion"], "tokens": x["tokens"]},
                       ensure_ascii=False) + "\n" for x in items))
        (OUT / f"{name}{suffix}.jsonl").write_text("".join(json.dumps(x["row"], ensure_ascii=False) + "\n" for x in items))
        seconds = [x["seconds"] for x in items if x["seconds"] is not None]
        print(f"{name}: {len(items)}건 {filled}, 토큰 최대 {max((x['tokens'] for x in items), default=0)}, 종류 {counts}"
              + (f", 결정 시간 평균 {sum(seconds) / len(seconds):.0f}초({len(seconds)}건)" if seconds else ""))
    print("건너뜀:", skipped or "없음")

REPEAT = {"no_change": 1, "propose_changes": 2, "needs_clarification": 3}  # 3차 학습: 결정 비율 맞추기(최대 3배)


def balance(src=OUT / "train-messages-all.jsonl", dst=OUT / "train-messages-bal.jsonl"):
    """결정이 적은 사례를 복제해 학습 결정 비율을 맞춘다. 검증 세트는 건드리지 않는다."""
    lines = [x for x in src.read_text().split("\n") if x]
    out, counts = [], {}
    for line in lines:
        decision = json.loads(json.loads(line)["completion"].removesuffix("<|im_end|>\n"))["decision"]
        out += [line] * REPEAT[decision]
        counts[decision] = counts.get(decision, 0) + REPEAT[decision]
    assert len(out) == sum(counts.values())
    dst.write_text("".join(x + "\n" for x in out))
    print(dst.name, len(lines), "→", len(out), counts)


def subset(n):
    """학습 곡선용. 1차 100건을 모두 넣고 나머지는 train-messages-all 순서(대기열 순)로 n건까지 채운다."""
    first = [x for x in (OUT / "train-messages.jsonl").read_text().split("\n") if x]
    rest = [x for x in (OUT / "train-messages-all.jsonl").read_text().split("\n") if x and x not in first]
    out = first + rest[:n - len(first)]
    assert len(out) == n == len(set(out)), (len(out), n)
    (OUT / f"train-messages-{n}.jsonl").write_text("".join(x + "\n" for x in out))
    print(f"train-messages-{n}.jsonl", n)


COLLECT_HARD = OUT / "collect-hard/candidates.jsonl"
QUEUE_HARD = OUT / "queue-hard.jsonl"


def hard_queue(src=COLLECT_HARD, dst=QUEUE_HARD, also=()):
    """새로 모은 후보에서 기존 후보 1,140건(보류 포함)과 also 파일들의 ID·저장소가 겹치는 것을 빼고 대기열을 쓴다."""
    held_ids, held_repos = held_out()
    old = [r for k in ("tl_pre2025", "tl_all_years", "rd_search", "held_a", "held_b") for r in load(SOURCES[k])]
    old += [r for path in also for r in load(path)]
    old_ids, old_repos = {r["id"] for r in old} | held_ids, {repo(r) for r in old} | held_repos
    rows, seen = [], set()
    for r in load(src):
        if r["id"] in old_ids or repo(r) in old_repos or r["id"] in seen:
            continue
        seen.add(r["id"])
        rows.append(r)
    dst.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    print(dst.name, f"{len(rows)}건, 저장소 {len({repo(r) for r in rows})}개")


def build_hard(local_dir):
    """GPT가 '변경 없음'이 아니라고 했거나 로컬 모델이 GPT와 다르게 답한 새 사례만 2차 학습 402건에 더한다."""
    import jsonschema

    run = load_run()
    system = (TL_EVAL / "prompt.md").read_text()
    validator = jsonschema.Draft202012Validator(json.loads((TL_EVAL / "schema.json").read_text()))
    rows = {r["id"]: r for r in load(QUEUE_HARD)}
    answers = {k: v for k, (v, _) in gpt_answers(OUT / "gpt-labels").items() if k in rows}
    local = {}
    for path in local_dir.glob("*.json"):
        r = json.loads(path.read_text())
        local[r["id"]] = r["response"]["decision"] if r["status"] == "success" else "failed"
    reasons, items, skipped = {}, [], []
    for cid in rows:  # 대기열 순서
        if cid not in answers:
            continue
        gpt = answers[cid]["decision"]
        why = "gpt_not_no_change" if gpt != "no_change" else "local_disagrees" if local.get(cid) != gpt else None
        if not why:
            continue
        item = example(cid, rows[cid], answers[cid], run, system, validator, skipped)
        if item:
            reasons[why] = reasons.get(why, 0) + 1
            items.append(item)
    base = (OUT / "train-messages-all.jsonl").read_text()
    (OUT / "train-messages-hard.jsonl").write_text(base + "".join(
        json.dumps({k: x[k] for k in ("id", "prompt", "completion", "tokens")}, ensure_ascii=False) + "\n"
        for x in items))
    decisions = {}
    for x in items:
        d = json.loads(x["completion"].removesuffix("<|im_end|>\n"))["decision"]
        decisions[d] = decisions.get(d, 0) + 1
    print(f"새 후보 {len(rows)}건, GPT 라벨 {len(answers)}건, 로컬 결과 {len(local)}건 → 어려운 사례 {len(items)}건 {reasons} {decisions}")
    print("건너뜀:", skipped or "없음")


QUEUE_NOOP = OUT / "queue-noop.jsonl"


def used_ids(path):
    return {json.loads(x)["id"] for x in path.read_text().split("\n") if x}


def noop_queue():
    """새 후보 중 GPT가 '변경 없음'이라 했고 5차 학습에 안 쓴 사례."""
    answers = gpt_answers(OUT / "gpt-labels")
    used = used_ids(OUT / "train-messages-hard.jsonl")
    rows = [r for r in load(QUEUE_HARD)
            if r["id"] in answers and answers[r["id"]][0]["decision"] == "no_change" and r["id"] not in used]
    QUEUE_NOOP.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    print(QUEUE_NOOP.name, f"{len(rows)}건")


def build_noop(local_dir):
    """queue-noop 중 로컬 모델이 '변경 없음'이 아니라고 답한 사례만 5차 학습 797건에 더한다."""
    import jsonschema

    run = load_run()
    system = (TL_EVAL / "prompt.md").read_text()
    validator = jsonschema.Draft202012Validator(json.loads((TL_EVAL / "schema.json").read_text()))
    answers = gpt_answers(OUT / "gpt-labels")
    local = {}
    for path in local_dir.glob("*.json"):
        r = json.loads(path.read_text())
        local[r["id"]] = r["response"]["decision"] if r["status"] == "success" else "failed"
    rows = load(QUEUE_NOOP)
    assert set(local) == {r["id"] for r in rows}, "로컬 결과가 queue-noop과 다르다"
    wrong, items, skipped = {}, [], []
    for row in rows:
        d = local[row["id"]]
        if d == "no_change":
            continue
        wrong[d] = wrong.get(d, 0) + 1
        item = example(row["id"], row, answers[row["id"]][0], run, system, validator, skipped)
        if item:
            items.append(item)
    base = (OUT / "train-messages-hard.jsonl").read_text()
    (OUT / "train-messages-noop.jsonl").write_text(base + "".join(
        json.dumps({k: x[k] for k in ("id", "prompt", "completion", "tokens")}, ensure_ascii=False) + "\n"
        for x in items))
    print(f"무작업 후보 {len(rows)}건 중 로컬이 틀린 {sum(wrong.values())}건 {wrong} → 추가 {len(items)}건")
    print("건너뜀:", skipped or "없음")


def smoke():
    held = {json.loads(x)["id"] for x in HELD_OUT.read_text().splitlines()}
    rows = {r["id"]: r for r in map(json.loads, POOL.read_text().splitlines())}
    assert not held & set(SMOKE_IDS), "스모크 사례가 보류 세트에 있다"
    assert set(SMOKE_IDS) <= rows.keys(), f"풀에 없는 스모크 사례: {sorted(set(SMOKE_IDS) - rows.keys())}"
    texts = [e["text"] for i in SMOKE_IDS for e in rows[i]["input"]["excerpts"]]
    assert not any(t.startswith("(원문은 원본 링크") for t in texts), "원문이 지워진 데이터다"
    OUT.mkdir(exist_ok=True)
    path = OUT / "smoke.jsonl"
    path.write_text("".join(json.dumps(rows[i], ensure_ascii=False) + "\n" for i in SMOKE_IDS))
    print(path, len(SMOKE_IDS))


COLLECT_MORE = OUT / "collect-more/candidates.jsonl"
QUEUE_MORE = OUT / "queue-more.jsonl"


def quota(counts, n):
    """counts 비율대로 n을 나눈다(최대 나머지 방식). 합은 정확히 n."""
    total = sum(counts.values())
    raw = {k: n * v / total for k, v in counts.items()}
    out = {k: int(v) for k, v in raw.items()}
    for k in sorted(raw, key=lambda k: raw[k] - out[k], reverse=True)[:n - sum(out.values())]:
        out[k] += 1
    return out


def build_more(n, base_path=OUT / "train-messages-noop.jsonl"):
    """queue-more 중 GPT 라벨이 있는 사례를 결정별로 섞어(seed 7) 기존 학습셋과 같은 결정 비율로 n건 더한다."""
    import jsonschema

    run = load_run()
    system = (TL_EVAL / "prompt.md").read_text()
    validator = jsonschema.Draft202012Validator(json.loads((TL_EVAL / "schema.json").read_text()))
    base = base_path.read_text()
    have = {}
    for x in base.split("\n"):
        if x:
            d = json.loads(json.loads(x)["completion"].removesuffix("<|im_end|>\n"))["decision"]
            have[d] = have.get(d, 0) + 1
    want = quota(have, n)
    rows = {r["id"]: r for r in load(QUEUE_MORE)}
    answers = {k: v for k, (v, _) in gpt_answers(OUT / "gpt-labels").items() if k in rows}
    by = {}
    for cid in sorted(answers):
        by.setdefault(answers[cid]["decision"], []).append(cid)
    rng = random.Random(SEED)
    items, skipped = [], []
    for d, k in want.items():
        pool = by.get(d, [])
        rng.shuffle(pool)
        got = []
        for cid in pool:
            if len(got) == k:
                break
            item = example(cid, rows[cid], answers[cid], run, system, validator, skipped)
            if item:
                got.append(item)
        assert len(got) == k, f"{d}: {k}건 필요, {len(got)}건뿐(라벨 {len(pool)}건)"
        items += got
    out = OUT / f"train-messages-{len(base.split(chr(10))) - 1 + n}.jsonl"
    out.write_text(base + "".join(
        json.dumps({k: x[k] for k in ("id", "prompt", "completion", "tokens")}, ensure_ascii=False) + "\n"
        for x in items))
    print(f"기존 {have} + 추가 {want} → {out.name}, 라벨 {len(answers)}건 { {d: len(v) for d, v in by.items()} }")
    print("건너뜀:", skipped or "없음")


QUEUE_RELABEL = OUT / "queue-relabel.jsonl"
RELABEL_SETS = {"train-messages-1000.jsonl": "train-messages-1000-sol61.jsonl",
                "dev-messages-all.jsonl": "dev-messages-all-sol61.jsonl"}


def source_rows():
    """학습·검증 메시지 파일에 쓴 사례의 원본 행(id → 행)."""
    rows = {}
    for path in (OUT / "train-all.jsonl", OUT / "dev-all.jsonl", QUEUE_HARD, QUEUE_NOOP, QUEUE_MORE):
        for r in load(path):
            rows.setdefault(r["id"], r)
    return rows


def relabel_queue():
    """1000건 학습셋과 검증 40건의 원본 행을 run.py --candidates용 대기열로 쓴다(라벨 모델 교체용)."""
    rows = source_rows()
    ids = [i for src in RELABEL_SETS for i in used_ids_ordered(OUT / src)]
    QUEUE_RELABEL.write_text("".join(json.dumps(rows[i], ensure_ascii=False) + "\n" for i in ids))
    print(QUEUE_RELABEL.name, f"{len(ids)}건")


def used_ids_ordered(path):
    return [json.loads(x)["id"] for x in path.read_text().split("\n") if x]


def relabel(gpt_dir):
    """같은 사례·같은 순서로, gpt_dir의 GPT 응답을 정답으로 다시 렌더링한다. 검증 실패·실패 응답은 빼고 적는다."""
    import jsonschema

    run = load_run()
    system = (TL_EVAL / "prompt.md").read_text()
    validator = jsonschema.Draft202012Validator(json.loads((TL_EVAL / "schema.json").read_text()))
    rows, answers = source_rows(), gpt_answers(gpt_dir)
    for src, dst in RELABEL_SETS.items():
        items, skipped, decisions = [], [], {}
        for cid in used_ids_ordered(OUT / src):
            if cid not in answers:
                skipped.append((cid, "GPT 응답 실패"))
                continue
            item = example(cid, rows[cid], answers[cid][0], run, system, validator, skipped)
            if item:
                items.append(item)
                d = answers[cid][0]["decision"]
                decisions[d] = decisions.get(d, 0) + 1
        (OUT / dst).write_text("".join(
            json.dumps({k: x[k] for k in ("id", "prompt", "completion", "tokens")}, ensure_ascii=False) + "\n"
            for x in items))
        print(f"{src} → {dst}: {len(items)}건 {decisions}, 건너뜀 {len(skipped)}건 {skipped[:5]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--smoke", action="store_true")
    mode.add_argument("--split", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--build-train", action="store_true")
    mode.add_argument("--balance", action="store_true", help="train-messages-all → train-messages-bal(결정 비율 맞춤)")
    mode.add_argument("--subset", type=int, help="학습 곡선용 n건(1차 100건 포함)")
    mode.add_argument("--hard-queue", action="store_true", help="out/collect-hard → out/queue-hard.jsonl(기존 후보 제외)")
    mode.add_argument("--build-hard", type=Path, metavar="LOCAL_RESULTS", help="어려운 사례만 402건에 더한다")
    mode.add_argument("--noop-queue", action="store_true", help="학습에 안 쓴 GPT '변경 없음' 사례 → out/queue-noop.jsonl")
    mode.add_argument("--build-noop", type=Path, metavar="LOCAL_RESULTS", help="로컬이 틀린 무작업 사례만 797건에 더한다")
    mode.add_argument("--more-queue", action="store_true", help="out/collect-more → out/queue-more.jsonl(queue-hard까지 제외)")
    mode.add_argument("--build-more", type=int, metavar="N", help="queue-more의 GPT 라벨에서 849건과 같은 결정 비율로 N건을 더한다")
    mode.add_argument("--relabel-queue", action="store_true", help="1000건 학습셋·검증 40건 원본 → out/queue-relabel.jsonl")
    mode.add_argument("--relabel", type=Path, metavar="GPT_DIR", help="같은 사례를 GPT_DIR(run.py 결과 */*.json) 정답으로 다시 렌더링")
    parser.add_argument("--labels", type=Path, default=OUT / "labels-human.jsonl")
    parser.add_argument("--gpt-labels", type=Path, help="run.py 결과 디렉터리(dev/, train/). 사람 라벨 대신 쓴다")
    parser.add_argument("--all-train", action="store_true", help="학습 대기열의 라벨을 모두 쓴다")
    args = parser.parse_args()
    if args.build_train:
        build_train(args.labels, args.gpt_labels, args.all_train)
    elif args.hard_queue:
        hard_queue()
    elif args.build_hard:
        build_hard(args.build_hard)
    elif args.noop_queue:
        noop_queue()
    elif args.build_noop:
        build_noop(args.build_noop)
    elif args.more_queue:
        hard_queue(COLLECT_MORE, QUEUE_MORE, also=(COLLECT_HARD,))
    elif args.build_more:
        build_more(args.build_more)
    elif args.relabel_queue:
        relabel_queue()
    elif args.relabel:
        relabel(args.relabel)
    elif args.subset:
        subset(args.subset)
    elif args.balance:
        balance()
    else:
        smoke() if args.smoke else write_split() if args.split else check()

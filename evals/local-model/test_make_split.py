"""make_split.py의 분할 규칙을 합성 데이터로 확인한다.

    python3 -m unittest evals/local-model/test_make_split.py
"""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("make_split", Path(__file__).with_name("make_split.py"))
ms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ms)


def row(cid, repo):
    return {"id": cid, "provenance": {"repository": repo}}


def pools(n_tl=200, n_rd=40):
    tl = [row(f"T{i}", f"o/tl{i // 2}") for i in range(n_tl)]       # 저장소당 2건
    rd = [row(f"R{i}", f"o/rd{i}") for i in range(n_rd)]
    return tl, rd


class SplitTest(unittest.TestCase):
    def test_held_out_ids_and_repos_are_excluded(self):
        tl, rd = pools()
        tl.append(row("H1", "o/new"))
        out = ms.split(tl, rd, held_ids={"H1"}, held_repos={"o/tl0", "o/rd0"})
        ids = {c["id"] for s in ("dev", "train") for c in out[s]}
        self.assertNotIn("H1", ids)
        self.assertFalse({"T0", "T1", "R0"} & ids)

    def test_dev_and_train_share_no_repo(self):
        out = ms.split(*pools(), held_ids=set(), held_repos=set())
        dev = {c["repo"] for c in out["dev"]}
        self.assertFalse(dev & {c["repo"] for c in out["train"]})

    def test_dev_fills_quota_with_spares(self):
        out = ms.split(*pools(), held_ids=set(), held_repos=set())
        count = lambda p: sum(c["pool"] == p for c in out["dev"])
        self.assertGreaterEqual(count("rd"), ms.DEV_QUEUE["rd"])
        self.assertGreaterEqual(count("tl"), ms.DEV_QUEUE["tl"])

    def test_case_in_both_pools_counts_as_role_division(self):
        tl, rd = pools()
        tl.append(row("R5", "o/rd5"))
        out = ms.split(tl, rd, held_ids=set(), held_repos=set())
        both = [c for s in ("dev", "train") for c in out[s] if c["id"] == "R5"]
        self.assertEqual([c["pool"] for c in both], ["rd"])

    def test_deterministic(self):
        self.assertEqual(ms.split(*pools(), set(), set()), ms.split(*pools(), set(), set()))

    def test_train_queue_interleaves_two_rd_per_three_tl(self):
        out = ms.split(*pools(), held_ids=set(), held_repos=set())
        self.assertEqual([c["pool"] for c in out["train"][:5]], ["rd", "rd", "tl", "tl", "tl"])


if __name__ == "__main__":
    unittest.main()


class TargetTest(unittest.TestCase):
    """라벨 → 학습 응답 변환(계획 4절 규칙)."""
    case = {"id": "C1", "input": {
        "excerpts": [{"text": "a"}, {"text": "b"}],
        "prior_project_state": {"tasks": [{"task_id": "issue-1"}]},
        "member_directory": {"logins": ["kim"]},
    }}

    def label(self, decision, changes, notes="", evidence=(1,)):
        return {"id": "C1", "expected_decision": decision, "expected_changes": changes,
                "evidence_excerpt_indices": list(evidence), "notes": notes}

    def check(self, t):
        import json
        import jsonschema
        schema = json.loads((ms.TL_EVAL / "schema.json").read_text())
        return ms.check_target(t, self.case, jsonschema.Draft202012Validator(schema))

    def test_propose_fields(self):
        t = ms.target(self.label("propose_changes", [
            {"kind": "complete", "task_id": "issue-1", "after": {}},
            {"kind": "createTask", "task_id": None, "after": {"title": "배포", "person": ""}},
        ], notes="완료 보고"), self.case)
        self.assertEqual(list(t), ["id", "summary_ko", "decision", "clarification_reason_ko", "changes"])
        self.assertEqual(t["summary_ko"], "완료 보고")
        self.assertIsNone(t["clarification_reason_ko"])
        self.assertEqual(t["changes"][1]["person"], None)  # review.html의 '' → null
        self.assertEqual(t["changes"][1]["title"], "배포")
        self.assertEqual({c["basis"] for c in t["changes"]}, {"fact"})
        self.assertEqual(self.check(t), [])

    def test_clarification_and_no_change(self):
        t = ms.target(self.label("needs_clarification", [], evidence=()), self.case)
        self.assertEqual(t["clarification_reason_ko"], "")
        t = ms.target(self.label("no_change", [], notes="질문"), self.case)
        self.assertIsNone(t["clarification_reason_ko"])
        self.assertEqual(self.check(t), [])

    def test_invalid_task_and_remaining(self):
        t = ms.target(self.label("propose_changes", [{"kind": "complete", "task_id": "issue-9", "after": {}}]), self.case)
        self.assertTrue(self.check(t))
        with self.assertRaises(AssertionError):
            ms.target(self.label("propose_changes", [{"kind": "remaining", "task_id": "issue-1", "after": {"remaining": 2}}]), self.case)

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from context_contract import score_context_response, validate
from context_dataset import export
from evaluate_adapter import summarize
from train_adapter import JsonAnswerDataset
from test_training_format import SyntheticTokenizer


class ContextChecks(unittest.TestCase):
    def setUp(self):
        self.request = {"resume": [{"id": 1, "text": "본인 담당: 데이터 정제"}, {"id": 2, "text": "사용 기술: Python, pandas, SQL"}], "vocabulary": [{"id": "python"}, {"id": "sql"}]}
        self.answer = {"summary": "데이터 정제를 수행했다.", "skills": [{"skillId": "python", "level": "applied", "startLine": 1, "endLine": 2}], "technologies": [{"name": "pandas", "level": "applied", "startLine": 1, "endLine": 2}], "questions": []}

    def test_pandas_survives_independently_of_competency_vocabulary(self):
        score = score_context_response(json.dumps(self.answer), self.answer, self.request)
        self.assertTrue(score["exact_technology_level_set"])
        self.assertEqual(score["technology_grounded_tp"], 1)
        self.assertEqual(summarize([{"score": score, "seconds": 1}])["technologies"]["f1"], 1)

    def test_name_without_source_and_duplicates_are_rejected(self):
        for change in (lambda x: x["technologies"][0].update(name="Docker"), lambda x: x["technologies"].append(copy.deepcopy(x["technologies"][0]))):
            answer = copy.deepcopy(self.answer)
            change(answer)
            with self.assertRaises(AssertionError):
                validate(answer, self.request)

    def test_evidence_without_role_context_does_not_get_grounding_credit(self):
        answer = copy.deepcopy(self.answer)
        answer["technologies"][0]["startLine"] = 2
        score = score_context_response(json.dumps(answer), self.answer, self.request)
        self.assertEqual(score["technology_tp"], 1)
        self.assertEqual(score["technology_grounded_tp"], 0)

    def test_role_level_error_and_truncation_are_not_success(self):
        answer = copy.deepcopy(self.answer)
        answer["technologies"][0]["level"] = "mentioned"
        score = score_context_response(json.dumps(answer), self.answer, self.request)
        self.assertEqual((score["technology_fp"], score["technology_fn"]), (1, 1))
        self.assertFalse(score_context_response(json.dumps(self.answer), self.answer, self.request, "length")["schema_valid"])

    def test_v2_answer_roundtrip_uses_exact_completion(self):
        answer = json.dumps(self.answer, ensure_ascii=False)
        row = {"messages": [{"role": "system", "content": "JSON"}, {"role": "user", "content": "text"}, {"role": "assistant", "content": answer}]}
        tokenizer = SyntheticTokenizer()
        tokens, offset = JsonAnswerDataset([row], tokenizer).process(row)
        self.assertEqual(tokenizer.decode(tokens[offset:-1]), answer)

    def test_related_person_cannot_cross_train_and_test(self):
        rows = [{"id": str(i), "leakage_group_id": "same-person", "split": split, "kind": "synthetic", "review": {"source_checked": True, "labels_checked": True}, "blocks": [{"text": x["text"]} for x in self.request["resume"]], "expected": self.answer} for i, split in enumerate(("train", "test"))]
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(AssertionError, "crosses splits"):
                export(rows, self.request["vocabulary"], Path(directory) / "out")


if __name__ == "__main__":
    unittest.main()

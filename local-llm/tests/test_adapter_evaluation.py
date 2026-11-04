"""Do not let format failures or unsupported labels inflate evaluation scores."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from evaluate_adapter import score_response


class EvaluationChecks(unittest.TestCase):
    def setUp(self):
        self.request = {"vocabulary": [{"id": "sql"}, {"id": "python"}], "resume": [{"id": 1, "text": "SQL 학습"}, {"id": 2, "text": "다른 문장"}]}
        self.gold = {"summary": "SQL 학습", "skills": [{"skillId": "sql", "level": "learning", "startLine": 1, "endLine": 1}], "questions": []}

    def test_wrong_level_counts_as_false_positive_and_false_negative(self):
        raw = json.loads(json.dumps(self.gold))
        raw["skills"][0]["level"] = "applied"
        score = score_response(json.dumps(raw), self.gold, self.request)
        self.assertEqual((score["tp"], score["fp"], score["fn"]), (0, 1, 1))

    def test_wrong_source_is_not_grounded_even_when_label_matches(self):
        raw = json.loads(json.dumps(self.gold))
        raw["skills"][0].update(startLine=2, endLine=2)
        score = score_response(json.dumps(raw), self.gold, self.request)
        self.assertEqual((score["tp"], score["grounded_tp"]), (1, 0))

    def test_truncated_or_duplicate_output_cannot_receive_credit(self):
        score = score_response(json.dumps(self.gold), self.gold, self.request, "length")
        self.assertFalse(score["schema_valid"])
        self.assertEqual(score["tp"], 0)
        raw = json.loads(json.dumps(self.gold))
        raw["skills"] *= 2
        self.assertFalse(score_response(json.dumps(raw), self.gold, self.request)["schema_valid"])


if __name__ == "__main__":
    unittest.main()

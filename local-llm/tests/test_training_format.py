"""Training labels must exactly match the JSON expected after the inference prefix."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from train_adapter import JsonAnswerDataset


class SyntheticTokenizer:
    eos_token_id = 0

    def apply_chat_template(self, messages, **kwargs):
        if any(m["role"] == "assistant" for m in messages):
            raise AssertionError("Do not render the completed chat template")
        return [1, 2, 3]

    def encode(self, text, **kwargs):
        return [ord(c) for c in text]

    def decode(self, tokens):
        return "".join(chr(t) for t in tokens)


class TrainingFormatChecks(unittest.TestCase):
    def test_completion_is_json_without_hidden_reasoning_or_tool_tags(self):
        answer = json.dumps({"summary": "학습 경험", "skills": [], "questions": []}, ensure_ascii=False)
        row = {"messages": [{"role": "system", "content": "JSON only"}, {"role": "user", "content": "source"}, {"role": "assistant", "content": answer}]}
        tokenizer = SyntheticTokenizer()
        tokens, offset = JsonAnswerDataset([row], tokenizer).process(row)
        self.assertEqual(tokens[:offset], [1, 2, 3])
        self.assertEqual(tokenizer.decode(tokens[offset:-1]), answer)
        self.assertEqual(tokens[-1], tokenizer.eos_token_id)


if __name__ == "__main__":
    unittest.main()

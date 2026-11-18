"""run.py의 local 변형을 가짜 Chat Completions 서버로 확인한다.

    python3 -m unittest evals/local-model/test_run_local.py
"""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

RUN = Path(__file__).resolve().parents[1] / "github-timeline-state-change-2026-09-11/run.py"
spec = importlib.util.spec_from_file_location("tl_run", RUN)
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

ROW = {
    "id": "T-1",
    "input": {
        "as_of": "2024-01-02T00:00:00Z",
        "thread_url": "https://github.com/o/r/issues/1",
        "thread_title_as_of": "t",
        "excerpts": [{"author_login": "a", "author_account_type": "User",
                      "created_at": "2024-01-01T00:00:00Z", "text": "merged"}],
        "prior_project_state": {"tasks": []},
        "member_directory": {"logins": ["a"]},
    },
    "provenance": {"anchor_excerpt_index": 0},
}


class FakeServer:
    """요청을 기록하고 지정한 content·finish_reason으로 답한다."""

    def __init__(self, content, finish="stop"):
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append({"auth": self.headers.get("Authorization"), "body": body})
                reply = json.dumps({
                    "model": "qwen-test",
                    "choices": [{"message": {"role": "assistant", "content": content},
                                 "finish_reason": finish}],
                    "usage": {"prompt_tokens": 11, "completion_tokens": 7},
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(reply)))
                self.end_headers()
                self.wfile.write(reply)

            def log_message(self, *args):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/v1/chat/completions"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


def ok_content(cid="T-1"):
    return json.dumps({"id": cid, "summary_ko": "", "decision": "no_change",
                       "clarification_reason_ko": None, "changes": []})


class LocalVariantTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.candidates = self.tmp / "cands.jsonl"
        self.candidates.write_text(json.dumps(ROW) + "\n")
        self.results = self.tmp / "out"

    def main(self, env, *extra):
        argv = ["run.py", "--variant", "local", "--candidates", str(self.candidates),
                "--results-dir", str(self.results), "--all", "--workers", "1", *extra]
        with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(sys, "argv", argv):
            for name in ("EVAL_API_URL", "EVAL_API_KEY", "EVAL_ADAPTER_SHA"):
                if name not in env:
                    os.environ.pop(name, None)
            run.main()

    def record(self):
        return json.loads((self.results / "T-1.json").read_text())

    def test_missing_eval_key_fails_without_request(self):
        server = FakeServer(ok_content())
        self.addCleanup(server.close)
        with self.assertRaises(SystemExit) as caught:
            self.main({"EVAL_API_URL": server.url, "EVAL_ADAPTER_SHA": "base",
                       "OPENAI_API_KEY": "sk-dummy-should-not-leave"})
        self.assertIn("EVAL_API_KEY", str(caught.exception.code))
        self.assertEqual(server.requests, [])

    def test_missing_adapter_sha_fails_without_request(self):
        server = FakeServer(ok_content())
        self.addCleanup(server.close)
        with self.assertRaises(SystemExit) as caught:
            self.main({"EVAL_API_URL": server.url, "EVAL_API_KEY": "local"})
        self.assertIn("EVAL_ADAPTER_SHA", str(caught.exception.code))
        self.assertEqual(server.requests, [])

    def test_success_records_adapter_and_sends_fixed_sampling(self):
        server = FakeServer(ok_content())
        self.addCleanup(server.close)
        self.main({"EVAL_API_URL": server.url, "EVAL_API_KEY": "local", "EVAL_ADAPTER_SHA": "base",
                   "OPENAI_API_KEY": "sk-dummy-should-not-leave"})
        rec = self.record()
        self.assertEqual(rec["status"], "success")
        self.assertEqual(rec["adapter_sha256"], "base")
        self.assertEqual(rec["response"]["decision"], "no_change")
        self.assertEqual(rec["usage"]["output_tokens"], 7)
        sent = server.requests[0]
        self.assertEqual(sent["auth"], "Bearer local")
        body = sent["body"]
        self.assertEqual((body["temperature"], body["seed"], body["max_tokens"]), (0, 7, 1024))
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertEqual(body["messages"][0]["content"], (run.ROOT / "prompt.md").read_text())
        self.assertNotIn("sk-dummy", json.dumps(sent))

    def test_truncated_output_is_failed(self):
        server = FakeServer(ok_content()[:20], finish="length")
        self.addCleanup(server.close)
        self.main({"EVAL_API_URL": server.url, "EVAL_API_KEY": "local", "EVAL_ADAPTER_SHA": "base"})
        self.assertEqual(self.record()["status"], "failed")

    def test_other_adapter_in_same_dir_is_refused(self):
        server = FakeServer(ok_content())
        self.addCleanup(server.close)
        env = {"EVAL_API_URL": server.url, "EVAL_API_KEY": "local", "EVAL_ADAPTER_SHA": "base"}
        self.main(env)
        self.main(env)
        self.assertEqual(len(server.requests), 1)  # 두 번째는 캐시
        with self.assertRaises(RuntimeError):
            self.main({**env, "EVAL_ADAPTER_SHA": "abc123"})


if __name__ == "__main__":
    unittest.main()

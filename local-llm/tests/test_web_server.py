import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from serve_web import Server, prepare, present

TEXT = '프로젝트: 고객 문의 분석\n담당 업무: 데이터 정제와 이탈 원인 분석을 직접 수행했습니다.\n사용 기술: Python, pandas, SQL'


class WebServerTest(unittest.TestCase):
    def test_preserves_source_names(self):
        req = prepare(TEXT)
        result = present(req, {'states': [0] * len(req['candidates'])})
        self.assertEqual([x['name'] for x in result['technologies']], ['Python', 'pandas', 'SQL'])
        for tech in result['technologies']:
            for m in tech['mentions']:
                self.assertIn(m['text'], TEXT)
                self.assertIn(m['quote'], m['text'])

    def test_rejects_oversize_without_truncation(self):
        for text in ('short', '가' * 12001, None):
            with self.assertRaises(ValueError):
                prepare(text)

    def test_auth_and_browser_origin_gate_before_inference(self):
        calls = []

        def predict(req):
            calls.append(req)
            return {'states': [0] * len(req['candidates'])}

        token = 'synthetic-test-token-with-32-characters'
        server = Server(0, token, predict)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/analyze'
        data = json.dumps({'text': TEXT}).encode()
        try:
            for headers in ({}, {'Authorization': f'Bearer {token}', 'Origin': 'https://example.invalid'}):
                with self.assertRaises(HTTPError) as context:
                    urlopen(Request(url, data=data, headers={'Content-Type': 'application/json', **headers}))
                self.assertEqual(context.exception.code, 403)
            self.assertEqual(len(calls), 0)
            with urlopen(Request(url, data=data, headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})) as response:
                result = json.load(response)
                self.assertEqual(len(result['technologies']), 3)
            self.assertEqual(len(calls), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()

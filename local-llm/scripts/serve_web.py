"""Authenticated loopback inference for ProjectMate. Inputs are never logged or saved."""
import argparse
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from queue import Queue
import secrets
import threading
import time

from evidence_contract import project, request
from focused_evidence import CATALOG, classify

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'Qwen3 4B + LoRA v6'
ADAPTER = 'resume-reviewed-20261107-selected'


def prepare(text):
    if not isinstance(text, str) or not 30 <= len(text.strip()) <= 12000:
        raise ValueError('Resume must contain 30 to 12000 characters')
    req = request([{'text': text}], CATALOG)
    if len(req['candidates']) > 64:
        raise ValueError('At most 64 technology candidates')
    return req


def present(req, prediction):
    result = project(req, prediction['states'], CATALOG)
    text = req['resume'][0]['text']
    technologies = []
    for item in result['decisions']:
        mentions = []
        for m in item['mentions']:
            start = text.rfind('\n', 0, m['start']) + 1
            end = text.find('\n', m['end'])
            end = len(text) if end < 0 else end
            mentions.append({'quote': m['quote'], 'text': text[start:end]})
        technologies.append({'name': item['name'], 'state': item['state'], 'mentions': mentions})
    return {'format': 'focused-state-v1', 'model': MODEL, 'adapter': ADAPTER,
            'technologies': technologies, 'skills': result['skills']}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, token, predict):
        super().__init__(('127.0.0.1', port), Handler)
        self.token, self.predict = token, predict
        self.lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def authorized(self):
        return (self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'
                and not self.headers.get('Origin')
                and secrets.compare_digest(self.headers.get('Authorization', ''), f'Bearer {self.server.token}'))

    def do_GET(self):
        if not self.authorized():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path == '/health':
            return self.reply(200, {'model': MODEL, 'adapter': ADAPTER, 'ready': True, 'busy': self.server.lock.locked()})
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if not self.authorized():
            return self.reply(403, {'error': 'Forbidden'})
        if self.path != '/analyze':
            return self.reply(404, {'error': 'Not found'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'JSON required'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 100000:
                return self.reply(413, {'error': 'Input too large'})
            self.connection.settimeout(15)
            body = json.loads(self.rfile.read(size))
            req = prepare(body.get('text') if isinstance(body, dict) else None)
        except (ValueError, UnicodeError, TimeoutError):
            return self.reply(422, {'error': 'Input limit exceeded or invalid format'})
        if not self.server.lock.acquire(blocking=False):
            return self.reply(409, {'error': 'Model busy'})
        try:
            started = time.monotonic()
            prediction = self.server.predict(req)
            self.reply(200, {**present(req, prediction), 'seconds': round(time.monotonic() - started, 2)})
        except ValueError:
            self.reply(422, {'error': 'Input exceeds 8192 tokens; no truncation performed'})
        except Exception as exc:
            print(json.dumps({'event': 'inference_error', 'type': type(exc).__name__}), flush=True)
            self.reply(503, {'error': 'Model unavailable'})
        finally:
            self.server.lock.release()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port', type=int, default=3291)
    p.add_argument('--token-file', type=Path, required=True)
    args = p.parse_args()
    if not 1024 <= args.port <= 65535:
        p.error('Invalid port')
    token = args.token_file.read_text().strip()
    if len(token) < 32:
        p.error('Token must contain at least 32 characters')
    for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY', 'HF_HUB_DISABLE_IMPLICIT_TOKEN'):
        os.environ[key] = '1'
    from mlx_lm import load
    model, tokenizer = load(str((ROOT / 'models/qwen3-4b-instruct-4bit').resolve()),
                            adapter_path=str((ROOT / 'adapters' / ADAPTER).resolve()))
    jobs = Queue()

    def predict(req):
        future = Future()
        jobs.put((req, future))
        return future.result()

    server = Server(args.port, token, predict)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(json.dumps({'ready': True, 'port': args.port, 'model': MODEL}), flush=True)
    try:
        # MLX loading and inference must run on the same thread.
        while True:
            req, future = jobs.get()
            try:
                future.set_result(classify(model, tokenizer, req))
            except Exception as exc:
                future.set_exception(exc)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()

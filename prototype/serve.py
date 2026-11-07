#!/usr/bin/env python3
"""Статический сервер для прототипа без кэширования (модули всегда свежие)."""
import http.server, sys, functools, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
root = os.path.dirname(os.path.abspath(__file__))
handler = functools.partial(NoCache, directory=root)
print(f'http://127.0.0.1:{port}/web/index.html')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()

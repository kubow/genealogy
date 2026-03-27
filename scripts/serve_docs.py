#!/usr/bin/env python3
"""Serve the generated docs/ site over HTTP for local preview."""

from __future__ import annotations

import argparse
import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve docs/ for local preview")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    args = parser.parse_args()

    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer((args.host, args.port), lambda *a, **kw: handler(*a, directory=str(DOCS_DIR), **kw)) as httpd:
        print(f"Serving {DOCS_DIR} at http://{args.host}:{args.port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()

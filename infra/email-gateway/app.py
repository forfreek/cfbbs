#!/usr/bin/env python3
"""Outbound-only transactional SMTP gateway for CFBBS.

This service is intentionally not a mailbox server: it has no inbound SMTP,
MX, IMAP, arbitrary From header, or arbitrary relay endpoint.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import smtplib
import sqlite3
import ssl
import threading
import time
from email.message import EmailMessage
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


KINDS = {"verify-email", "password-reset", "security-alert"}
EMAIL_RE = re.compile(r"^[^@\s]{1,160}@[A-Za-z0-9.-]{1,240}$")
MAX_BODY = 128 * 1024


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def redact_email(value: str) -> str:
    local, _, domain = value.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "[redacted]"


class State:
    def __init__(self, path: str):
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL)"
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS sends (bucket INTEGER PRIMARY KEY, count INTEGER NOT NULL)"
        )
        self.connection.commit()
        self.lock = threading.Lock()

    def begin_request(self, request_id: str) -> str | None:
        with self.lock:
            row = self.connection.execute(
                "SELECT status FROM requests WHERE request_id = ?", (request_id,)
            ).fetchone()
            if row:
                return str(row[0])
            self.connection.execute(
                "INSERT INTO requests (request_id, status, created_at) VALUES (?, 'pending', ?)",
                (request_id, int(time.time())),
            )
            self.connection.commit()
            return None

    def finish_request(self, request_id: str, status: str) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE requests SET status = ? WHERE request_id = ?",
                (status, request_id),
            )
            self.connection.commit()

    def consume(self, bucket: int, limit: int) -> bool:
        with self.lock:
            row = self.connection.execute(
                "SELECT count FROM sends WHERE bucket = ?", (bucket,)
            ).fetchone()
            count = int(row[0]) + 1 if row else 1
            if count > limit:
                return False
            self.connection.execute(
                "INSERT INTO sends (bucket, count) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET count = excluded.count",
                (bucket, count),
            )
            self.connection.commit()
            return True


class Gateway:
    def __init__(self):
        self.token = env("GATEWAY_TOKEN")
        self.smtp_host = env("SMTP_HOST")
        self.smtp_port = int(env("SMTP_PORT", "465"))
        self.smtp_security = env("SMTP_SECURITY", "ssl").lower()
        self.smtp_username = env("SMTP_USERNAME")
        self.smtp_password = env("SMTP_PASSWORD")
        self.smtp_from = env("SMTP_FROM")
        self.state = State(env("STATE_DB", "/var/lib/cfbbs-email-gateway/state.sqlite3"))

    @property
    def configured(self) -> bool:
        return bool(
            self.token
            and self.smtp_host
            and self.smtp_username
            and self.smtp_password
            and self.smtp_from
            and EMAIL_RE.fullmatch(self.smtp_from)
        )

    def send(self, payload: dict[str, Any]) -> str:
        request_id = str(payload["requestId"])
        existing = self.state.begin_request(request_id)
        if existing == "sent":
            return "duplicate"
        if not self.configured:
            self.state.finish_request(request_id, "failed")
            raise RuntimeError("SMTP gateway is not configured")
        if not self.state.consume(int(time.time() // 100), 200):
            self.state.finish_request(request_id, "failed")
            raise RuntimeError("gateway rate limit exceeded")
        if not self.state.consume(int(time.time() // 86400), 100):
            self.state.finish_request(request_id, "failed")
            raise RuntimeError("daily sender limit exceeded")

        message = EmailMessage()
        message["From"] = self.smtp_from
        message["To"] = str(payload["to"])
        message["Subject"] = str(payload["subject"])
        message.set_content(str(payload["text"]))
        message.add_alternative(str(payload["html"]), subtype="html")
        if self.smtp_security == "starttls":
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=15) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(self.smtp_username, self.smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP_SSL(
                self.smtp_host, self.smtp_port, context=ssl.create_default_context(), timeout=15
            ) as smtp:
                smtp.login(self.smtp_username, self.smtp_password)
                smtp.send_message(message)
        self.state.finish_request(request_id, "sent")
        return "sent"


gateway = Gateway()


class Handler(BaseHTTPRequestHandler):
    server_version = "CFBBSMailGateway/1.0"

    def json_response(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self.json_response(HTTPStatus.NOT_FOUND, {"ok": False})
            return
        self.json_response(HTTPStatus.OK, {"ok": True, "configured": gateway.configured})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/send":
            self.json_response(HTTPStatus.NOT_FOUND, {"ok": False})
            return
        expected = f"Bearer {gateway.token}" if gateway.token else ""
        if not hmac.compare_digest(self.headers.get("authorization", ""), expected):
            self.json_response(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.json_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "body too large"})
            return
        payload: dict[str, Any] = {}
        try:
            payload = json.loads(self.rfile.read(length))
            self.validate(payload)
            result = gateway.send(payload)
        except ValueError as error:
            self.json_response(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:  # never expose SMTP details to clients
            print(f"send failed kind={payload.get('kind', '[unknown]')} to={redact_email(str(payload.get('to', '')))} error={error}", flush=True)
            self.json_response(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": "smtp delivery failed"})
            return
        print(f"send {result} kind={payload['kind']} to={redact_email(payload['to'])}", flush=True)
        self.json_response(HTTPStatus.OK, {"ok": True, "status": result})

    @staticmethod
    def validate(payload: Any) -> None:
        if not isinstance(payload, dict):
            raise ValueError("JSON object required")
        required = ("requestId", "kind", "to", "from", "subject", "text", "html")
        if any(not isinstance(payload.get(key), str) for key in required):
            raise ValueError("invalid envelope")
        if payload["kind"] not in KINDS:
            raise ValueError("unsupported email kind")
        if not EMAIL_RE.fullmatch(payload["to"]):
            raise ValueError("invalid recipient")
        if payload["from"] != gateway.smtp_from:
            raise ValueError("from address is fixed")
        if not 1 <= len(payload["requestId"]) <= 200:
            raise ValueError("invalid request id")
        if not 1 <= len(payload["subject"]) <= 200:
            raise ValueError("invalid subject")
        if len(payload["text"]) > 50_000 or len(payload["html"]) > 100_000:
            raise ValueError("message too large")


def main() -> None:
    host = env("LISTEN_HOST", "127.0.0.1")
    port = int(env("LISTEN_PORT", "8788"))
    print(f"CFBBS email gateway listening on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()

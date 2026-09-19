"""Prototype authentication.

Deliberately not production-grade: every demo account shares one password from
SEED_PASSWORD (default "demo1234") and session tokens live in process memory.
Swapping in a real user store means replacing ``verify_password`` and ``Sessions``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Any

_USERS_PATH = Path(__file__).with_name("users.json")

SEED_PASSWORD = os.environ.get("SEED_PASSWORD", "demo1234")
_SEED_DIGEST = hashlib.sha256(SEED_PASSWORD.encode("utf-8")).digest()


def load_users() -> list[dict[str, Any]]:
    return json.loads(_USERS_PATH.read_text(encoding="utf-8"))["users"]


USERS: list[dict[str, Any]] = load_users()
USERS_BY_ID: dict[str, dict[str, Any]] = {u["id"]: u for u in USERS}
USERS_BY_USERNAME: dict[str, dict[str, Any]] = {u["username"]: u for u in USERS}


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    """User fields safe to send to the browser (no credentials live here anyway)."""
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "name": user["name"],
        "specialty": user.get("specialty"),
    }


def verify_password(password: str) -> bool:
    return hmac.compare_digest(
        hashlib.sha256(password.encode("utf-8")).digest(), _SEED_DIGEST
    )


class Sessions:
    """In-memory token store. A server restart logs everyone out."""

    def __init__(self) -> None:
        self._tokens: dict[str, str] = {}

    def issue(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        self._tokens[token] = user_id
        return token

    def resolve(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        return USERS_BY_ID.get(self._tokens.get(token, ""))

    def revoke(self, token: str | None) -> None:
        if token:
            self._tokens.pop(token, None)

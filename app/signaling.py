"""Signaling and presence. This server never carries audio or video.

It holds the doctor directory (who exists, who is available, who is busy) and
relays SDP/ICE between two browsers. Once ICE succeeds, media flows directly
between peers and this process is out of the path — killing it mid-call does
not drop the call.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import secrets
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from .auth import (
    SEED_PASSWORD,
    Sessions,
    USERS_BY_ID,
    USERS_BY_USERNAME,
    public_user,
    verify_password,
)

# Must match the client-side ring countdown, which is told this value on `incoming`.
RING_TIMEOUT = 30.0

STUN_URL = os.environ.get("STUN_URL", "stun:stun.l.google.com:19302")
TURN_URL = os.environ.get("TURN_URL", "")
TURN_USER = os.environ.get("TURN_USER", "")
TURN_PASS = os.environ.get("TURN_PASS", "")


def ice_config() -> dict[str, Any]:
    """ICE servers, resolved from server env so no TURN credentials sit in static files."""
    servers: list[dict[str, Any]] = [{"urls": STUN_URL}]
    if TURN_URL:
        servers.append(
            {"urls": TURN_URL, "username": TURN_USER, "credential": TURN_PASS}
        )
    return {"iceServers": servers}


@dataclass
class Call:
    id: str
    patient: str
    doctor: str
    state: str  # "ringing" | "active"
    timeout_task: asyncio.Task[None] | None = None

    def other(self, user_id: str) -> str:
        return self.doctor if user_id == self.patient else self.patient


class Connection:
    def __init__(self, user: dict[str, Any], websocket: WebSocket) -> None:
        self.user = user
        self.ws = websocket
        # Doctors opt in to being callable; patients are always reachable.
        self.available = user["role"] == "patient"

    @property
    def id(self) -> str:
        return self.user["id"]

    async def send(self, payload: dict[str, Any]) -> None:
        with contextlib.suppress(RuntimeError):
            await self.ws.send_json(payload)


class Hub:
    def __init__(self) -> None:
        self.sessions = Sessions()
        self._conns: dict[str, Connection] = {}
        self._calls: dict[str, Call] = {}
        self._call_of: dict[str, str] = {}  # user id -> call id
        self._tasks: set[asyncio.Task[None]] = set()

    def _spawn(self, coro: Any) -> None:
        """Fire-and-forget a send. The set keeps a strong reference — an
        unreferenced task can be garbage collected mid-flight."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ---------------------------------------------------------------- lifecycle

    async def serve(self, ws: WebSocket) -> None:
        await ws.accept()
        conn: Connection | None = None
        try:
            while True:
                message = await ws.receive_json()
                conn = await self._dispatch(conn, ws, message)
        except (WebSocketDisconnect, ValueError, KeyError):
            pass
        finally:
            if conn is not None:
                self._disconnect(conn)

    def _detach(self, conn: Connection) -> None:
        """Drop a socket without touching any call it may own."""
        if self._conns.get(conn.id) is conn:
            del self._conns[conn.id]

    def _disconnect(self, conn: Connection) -> None:
        # A reconnect (new socket, same user) supersedes the old one; the old
        # socket's close must not tear down a call the new socket owns, or every
        # network blip would kill the live consultation.
        if self._conns.get(conn.id) is not conn:
            return
        del self._conns[conn.id]
        call_id = self._call_of.get(conn.id)
        if call_id:
            self._end_call(call_id, "peer-gone", notify=True)
        self._broadcast_directory()

    # ------------------------------------------------------------------ dispatch

    async def _dispatch(
        self, conn: Connection | None, ws: WebSocket, msg: dict[str, Any]
    ) -> Connection | None:
        kind = msg.get("t")

        if kind == "accounts":
            await ws.send_json(
                {
                    "t": "accounts",
                    "accounts": [public_user(u) for u in USERS_BY_ID.values()],
                    # Published on purpose: this is a public demo and every seeded
                    # account shares the password from SEED_PASSWORD.
                    "demoPassword": SEED_PASSWORD,
                }
            )
            return conn

        if kind == "login":
            user = USERS_BY_USERNAME.get(str(msg.get("username", "")).strip().lower())
            if user is None or not verify_password(str(msg.get("password", ""))):
                await ws.send_json(
                    {"t": "login-err", "message": "Unknown username or wrong password."}
                )
                return conn
            token = self.sessions.issue(user["id"])
            await ws.send_json(
                {
                    "t": "login-ok",
                    "token": token,
                    "user": public_user(user),
                    "ice": ice_config(),
                }
            )
            return await self._attach(user, ws)

        if kind == "hello":
            user = self.sessions.resolve(msg.get("token"))
            if user is None:
                await ws.send_json({"t": "hello-err"})
                return conn
            await ws.send_json(
                {"t": "hello-ok", "user": public_user(user), "ice": ice_config()}
            )
            return await self._attach(user, ws)

        if conn is None:
            await ws.send_json({"t": "error", "message": "Authenticate first."})
            return conn

        if kind == "availability":
            if conn.user["role"] != "doctor":
                return conn
            conn.available = bool(msg.get("online"))
            self._broadcast_directory()
            return conn

        if kind == "directory":
            await conn.send({"t": "directory", "doctors": self._directory()})
            return conn

        if kind == "call":
            await self._on_call(conn, str(msg.get("to", "")))
            return conn

        if kind == "call-answer":
            await self._on_call_answer(conn, msg)
            return conn

        if kind == "signal":
            await self._on_signal(conn, msg)
            return conn

        if kind == "hangup":
            call_id = self._call_of.get(conn.id)
            if call_id:
                self._end_call(call_id, "ended", notify=True)
            return conn

        await conn.send({"t": "error", "message": f"Unknown message type: {kind!r}"})
        return conn

    async def _attach(self, user: dict[str, Any], ws: WebSocket) -> Connection:
        """Bind this socket to a user, replacing any older socket for that user."""
        previous = self._conns.get(user["id"])
        if previous is not None and previous.ws is not ws:
            # Reconnect or second tab. Hand the session over instead of ending it:
            # call ownership is keyed by user, so the new socket inherits any
            # consultation already in progress.
            self._detach(previous)
            with contextlib.suppress(RuntimeError):
                await previous.ws.close(code=4000)
        conn = Connection(user, ws)
        self._conns[conn.id] = conn
        self._broadcast_directory()
        return conn

    # --------------------------------------------------------------------- calls

    async def _on_call(self, conn: Connection, doctor_id: str) -> None:
        if conn.user["role"] != "patient":
            await conn.send(
                {"t": "call-error", "code": "role", "message": "Only patients place calls."}
            )
            return
        if conn.id in self._call_of:
            await conn.send(
                {"t": "call-error", "code": "busy-self", "message": "You are already in a call."}
            )
            return

        doctor = self._conns.get(doctor_id)
        if doctor is None or doctor.user["role"] != "doctor":
            await conn.send(
                {"t": "call-error", "code": "unknown", "message": "That doctor is not online."}
            )
            return
        if not doctor.available:
            await conn.send(
                {
                    "t": "call-error",
                    "code": "offline",
                    "message": f"{doctor.user['name']} is not accepting calls right now.",
                }
            )
            return
        if doctor_id in self._call_of:
            await conn.send(
                {
                    "t": "call-error",
                    "code": "busy",
                    "message": f"{doctor.user['name']} is in another consultation.",
                }
            )
            return

        call = Call(id=secrets.token_urlsafe(8), patient=conn.id, doctor=doctor_id, state="ringing")
        self._calls[call.id] = call
        self._call_of[call.patient] = call.id
        self._call_of[call.doctor] = call.id
        call.timeout_task = asyncio.create_task(self._ring_timeout(call.id))
        self._broadcast_directory()

        # The caller needs the id before any answer lands, otherwise it cannot
        # correlate call-answer / signal / hangup for this call.
        await conn.send(
            {
                "t": "call-placed",
                "callId": call.id,
                "to": {"id": doctor_id, "name": doctor.user["name"]},
            }
        )
        await doctor.send(
            {
                "t": "incoming",
                "callId": call.id,
                "from": {"id": conn.id, "name": conn.user["name"]},
                "timeout": RING_TIMEOUT,
            }
        )

    async def _ring_timeout(self, call_id: str) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(RING_TIMEOUT)
            self._end_call(call_id, "timeout", notify=True)

    async def _on_call_answer(self, conn: Connection, msg: dict[str, Any]) -> None:
        call = self._calls.get(str(msg.get("callId", "")))
        if call is None or call.state != "ringing" or call.doctor != conn.id:
            return
        if not msg.get("accept"):
            self._end_call(call.id, "declined", notify=True)
            return
        call.state = "active"
        if call.timeout_task is not None:
            call.timeout_task.cancel()
            call.timeout_task = None
        await self._send(call.patient, {"t": "call-answer", "callId": call.id, "accept": True})

    async def _on_signal(self, conn: Connection, msg: dict[str, Any]) -> None:
        call_id = str(msg.get("callId", ""))
        call = self._calls.get(call_id)
        if call is None or conn.id not in (call.patient, call.doctor):
            return
        data = msg.get("data")
        if not isinstance(data, dict):
            return
        await self._send(call.other(conn.id), {"t": "signal", "callId": call_id, "data": data})

    def _end_call(self, call_id: str, reason: str, *, notify: bool) -> None:
        call = self._calls.pop(call_id, None)
        if call is None:
            return
        if call.timeout_task is not None:
            call.timeout_task.cancel()
            call.timeout_task = None
        self._call_of.pop(call.patient, None)
        self._call_of.pop(call.doctor, None)
        if notify:
            payload = {"t": "hangup", "callId": call.id, "reason": reason}
            for user_id in (call.patient, call.doctor):
                self._spawn(self._send(user_id, payload))
        self._broadcast_directory()

    # ----------------------------------------------------------------- directory

    def _directory(self) -> list[dict[str, Any]]:
        doctors = []
        for user in USERS_BY_ID.values():
            if user["role"] != "doctor":
                continue
            conn = self._conns.get(user["id"])
            online = conn is not None and conn.available
            doctors.append(
                {
                    "id": user["id"],
                    "name": user["name"],
                    "specialty": user.get("specialty") or "General",
                    "online": online,
                    "busy": user["id"] in self._call_of,
                }
            )
        return doctors

    def _broadcast_directory(self) -> None:
        payload = {"t": "directory", "doctors": self._directory()}
        for conn in list(self._conns.values()):
            if conn.user["role"] == "patient":
                self._spawn(conn.send(payload))

    async def _send(self, user_id: str, payload: dict[str, Any]) -> None:
        conn = self._conns.get(user_id)
        if conn is not None:
            await conn.send(payload)

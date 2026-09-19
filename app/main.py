"""atf telehealth signaling server.

This process serves only the WebSocket signaling hub (plus a health check). The
frontend is a separate Next.js app in ``web/``, deployed to Vercel. It talks to
this server over ``wss://``; audio and video never pass through here.
"""

from __future__ import annotations

from fastapi import FastAPI, WebSocket

from .signaling import Hub

app = FastAPI(title="atf signaling", docs_url=None, redoc_url=None)
hub = Hub()


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    return {"ok": True, "service": "atf-signaling"}


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "atf-signaling",
        "websocket": "/ws",
        "frontend": "the Next.js app in web/ is deployed separately",
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.serve(websocket)
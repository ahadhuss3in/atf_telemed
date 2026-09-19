# atf telehealth

A telemedicine prototype: patients and doctors sign in, patients find a doctor
from a searchable live directory, and the two connect over a **peer-to-peer
WebRTC video call**.

- **Frontend** — Next.js 16 (App Router, TypeScript) in `web/`
- **Signaling server** — FastAPI, in `app/`

## How it is wired

```
Patient browser ──                        ┌── Doctor browser
                  ├── wss:// signaling ────┤
                  │   (presence + SDP/ICE) │
                  └══════ DTLS-SRTP ═══════┘
                      audio/video direct
```

The server holds the directory (who exists, who is available, who is busy) and
relays the SDP/ICE needed to set a call up — a few KB of JSON per call. Once ICE
completes, media flows **directly between the two browsers**: it does not pass
through the signaling server, and the server never sees a frame.

There is no way to remove signaling entirely. WebRTC requires an out-of-band
channel to exchange SDP before a peer connection can exist, and a searchable
"who is online" directory is a shared registry by definition.

## Run it locally

Two processes. **Terminal 1** — signaling server:

```sh
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

**Terminal 2** — frontend:

```sh
cd web
npm install
npm run dev
```

Open <http://localhost:3000>. The dev server reads `web/.env.local`, which points
the frontend at `ws://127.0.0.1:8000/ws`.

### Demo accounts

All seeded accounts share the password `demo1234` (override with `SEED_PASSWORD`).
The login page lists them and fills the form when you click one.

| Doctors | Specialty |
| --- | --- |
| `ayesha` | Dermatology |
| `rohan` | Cardiology |
| `sara` | Pediatrics |
| `imran` | General Medicine |
| `nadia` | Psychiatry |

Patients: `hamza`, `zara`.

## Test it yourself

Sessions live in `sessionStorage`, so **each browser tab is its own session** —
one browser with two tabs is enough to be both people. (Two separate browsers, or
one normal plus one private window, work too.)

1. **Tab A** → sign in as `ayesha` → you land on `/doctor`. Click **Go available**.
2. **Tab B** → sign in as `hamza` → you land on `/patient`. The directory now
   shows *Dr. Ayesha Khan — Available now*, with the other four doctors *Offline*
   and their **Call** buttons disabled.
3. Type `card` in the search box → only *Dr. Rohan Mehta* remains (he is offline,
   so his Call button stays disabled). Clear the search.
4. Click **Call** next to Dr. Ayesha Khan. Tab B shows *Calling Dr. Ayesha Khan…*
   and your own camera in the corner.
5. **Tab A** shows a ring prompt with *Hamza Raza* and a 30-second countdown.
   Click **Accept**.
6. Both tabs show **Live · 00:0x**. Each shows the *other* person's camera
   full-screen and its own camera in the small picture-in-picture.
7. Click **Mute** and **Camera off** in either tab — their audio and video stop
   for the other side. Click again to restore.
8. Click **End call** → Tab B returns to the directory with *Call ended.*

Other states worth exercising:

- **Decline** — dial again and click Decline: the caller gets *Call declined.*
- **No answer** — dial and just wait 30 seconds: *No answer — the doctor did not
  pick up.* Both sides clean up.
- **Busy** — start a call, then in a third tab sign in as `zara` and try to call
  the same doctor: *Dr. Ayesha Khan is in another consultation.*
- **Offline** — set the doctor to **Go offline**, then dial: *…is not accepting
  calls right now.*
- **Sign out** — the session is dropped and the token is revoked server-side.

### Confirming the call is genuinely peer-to-peer

Open `chrome://webrtc-internals` in each tab during a call. You will see one
`RTCPeerConnection` per side, and under `candidate-pair` the **selected pair** is
a direct host address pair (on one machine: two `127.0.0.1` ports; on a LAN: the
two machines' own addresses). That is the evidence that media is going straight
between the browsers. If it ever shows a relay candidate, you are going through a
TURN server instead.

Note that stopping the signaling server *does* close the call UI with *Lost the
signaling server…*. That is deliberate: the server ends any call owned by a
disconnected socket, and the client matches it rather than leaving a call screen
that looks alive but is not. The media path itself is independent of the
signaling server — the teardown here is a policy choice, not a media limitation.

### Testing between two devices (phone + laptop)

`getUserMedia` requires a **secure context**. `http://localhost` counts; a plain
`http://192.168.x.x:3000` does **not**, so the phone's browser will refuse camera
and microphone access — and an HTTPS page cannot open a plain `ws://` socket
(mixed content).

So the straightforward route for two-device testing is to **deploy** (below):
both services get HTTPS/WSS and it works from any device. Aiming a local dev
server at a phone needs TLS on *both* services plus a certificate the phone
trusts, which is real work for a prototype.

For reliable connections between two networks, also set TURN — see below.

## Deploying

Frontend on Vercel, signaling server on Railway. Vercel cannot host the signaling
server: its functions cannot hold a WebSocket open.

### Railway (signaling server)

Point a Railway service at this repo, with **no root directory**. It builds the
included `Dockerfile`, which uses the committed `uv.lock`. Railway injects
`PORT`; the container binds it.

Keep this service at **one replica**. Presence and call state are in process
memory, so a second replica would see a different half of the directory.

### Vercel (frontend)

Import the repo and set **Root Directory** to `web`. Add one environment
variable:

```
NEXT_PUBLIC_SIGNALING_URL = wss://<your-service>.up.railway.app/ws
```

It is baked in at build time, which is why it must be set before deploying.
Vercel detects Next.js automatically.

To point a deployed frontend at a different backend without rebuilding, append
`?server=wss://host/ws` — it is remembered in `localStorage`. On an HTTPS page it
must be `wss://`, not `ws://`.

## Configuration

Server (`app/signaling.py`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | Bind port (Railway sets this) |
| `SEED_PASSWORD` | `demo1234` | Password for every seeded account |
| `STUN_URL` | `stun:stun.l.google.com:19302` | STUN server |
| `TURN_URL` | *(unset)* | TURN server, e.g. `turn:turn.example.com:3478` |
| `TURN_USER` / `TURN_PASS` | *(unset)* | TURN credentials |

ICE configuration is sent to the browser over the WebSocket after login, so TURN
credentials are never baked into the frontend bundle.

Frontend (`web/.env.local`, see `web/.env.example`):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SIGNALING_URL` | Signaling server to connect to |

## Troubleshooting

- **Blank page or a permanent "Connecting…"** — check the browser console and the
  dev server log for `Blocked cross-origin request to Next.js dev resource`. In
  development Next only trusts `localhost` by default, so `127.0.0.1` and LAN IPs
  are allowlisted in `next.config.ts` via `allowedDevOrigins`. Add your own host
  there if you use a different one.
- **"Could not access your camera or microphone"** — the page is not a secure
  context. Use `localhost`, or serve over HTTPS.
- **"No signaling server configured"** banner — `NEXT_PUBLIC_SIGNALING_URL` is
  not set for this build. See `web/.env.example`.
- **"Connection failed — a TURN server may be required on this network"** — ICE
  completed but no candidate pair worked; set the TURN variables.
- **`EADDRINUSE` on port 3000** — something else is using it:
  `npm run dev -- -p 3100`.

## What is deliberately not production-grade

- **No TURN server by default.** Two peers on the same machine or same LAN always
  connect; STUN covers most home NATs. Between two visitors behind symmetric NAT
  or a strict corporate network, a call can fail to connect. Set `TURN_URL`,
  `TURN_USER`, and `TURN_PASS` to fix that — no code change needed.
- **Prototype authentication.** Every account shares one password, tokens live in
  process memory (a restart logs everyone out), and there is no rate limiting.
  This is not a substitute for a real identity provider.
- **In-memory state.** Calls, sessions, and presence vanish on restart, and the
  signaling service must run as a single replica.
- **No consultation record.** Nothing is recorded, stored, or persisted — which
  is also why there is no PHI to protect in this prototype.

## Layout

```
app/main.py             FastAPI app: /ws signaling, /healthz
app/signaling.py        directory, presence, and the call state machine
app/auth.py             seeded users and in-memory session tokens
app/users.json          the seeded accounts
Dockerfile              Railway build for the signaling server

web/app/page.tsx        login
web/app/patient/page.tsx  patient portal
web/app/doctor/page.tsx   doctor portal
web/lib/protocol.ts     typed wire protocol shared with app/signaling.py
web/lib/bus.ts          WebSocket transport (queue + reconnect)
web/lib/rtc.ts          RTCPeerConnection wrapper (ICE queue, media controls)
web/lib/call-session.ts the call state machine, framework-agnostic
web/hooks/              React bindings for the two controllers above
web/components/         presentation
```

The call logic is a plain class bound to React through `useSyncExternalStore`
rather than a pile of effects. It is driven by socket events and
`RTCPeerConnection` callbacks, and React 19 runs effects twice in development —
expressing it as effects would invite double-dial and double-subscribe bugs for
no gain.# atf_telemed

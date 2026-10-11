# MeetShare

A secure video meeting app where **every participant can share their screen at the same time**, with an AI copilot powered by Groq.

## Run
    npm install
    cp .env.example .env     # add your GROQ_API_KEY (https://console.groq.com/keys)
    npm start                # http://localhost:3000

Open the app, create an account, then open a second browser (or a private window) with another account and join the same meeting code.
Other devices need HTTPS for camera and screen sharing: deploy to Render/Railway, or use ngrok.

## Accounts and security
- Sign up / sign in with email and password. Meetings, chat and the AI copilot are only available to signed-in users.
- Passwords are hashed with scrypt and a unique salt; they are never stored in plain text.
- Sessions use random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on HTTPS). Only a hash of each token is stored on the server.
- Login attempts are rate limited per IP and account; sign-up is rate limited per IP.
- WebSocket connections require a valid session and a same-origin request; API writes are CSRF-protected.
- Security headers are set on every response (CSP, X-Frame-Options, nosniff, Referrer-Policy).
- Accounts are stored in `data/users.json` (set `DATA_DIR` to change). On hosts with an ephemeral disk, mount a persistent volume or accounts reset on each deploy.

## Features
- Video and microphone, gallery view, active-speaker highlight, pre-join preview
- Simultaneous multi-screen sharing (with system audio); click a screen to enlarge it
- Chat, raise hand, reactions, participants list, invite link, meeting timer
- Host controls: mute all, lock meeting, stop a participant's share, remove, end for everyone
- Local recording (.webm); everyone sees a REC badge
- Live captions (Chrome/Edge, Web Speech API): each participant captions their own speech
- AI Copilot (Groq): summary, action items, catch-up, follow-up email, or any question. Context is the live captions and chat, and replies stream in.

Shortcuts: M microphone, V video, S share screen, H raise hand.

## Configuration (.env)
- `GROQ_API_KEY` (required for AI)
- `GROQ_MODEL` (default `openai/gpt-oss-120b`). On startup and every minute the server checks that the key is valid and the model is live; if the model is gone it switches to a working fallback automatically, and the AI panel shows the current status.
- `MAX_PEERS` (default 6): the P2P mesh works best with 4-6 participants
- `DATA_DIR`, `TRUST_PROXY` (see `.env.example`)
- If participants on different networks cannot connect, add a TURN server at the top of `public/app.js`.

## Privacy
- Captions use the browser's Web Speech API (audio is processed by Google). When the AI is used, the transcript and chat are sent to Groq.
- `/api/ai` is limited to 20 requests per minute per user.

## Limits
No waiting room, breakout rooms, virtual backgrounds, polls, whiteboard, cloud recording, device selection, email verification or password reset yet, and no support for 50+ participants (that needs an SFU).

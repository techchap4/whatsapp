# WhatsApp link: isolated lab, NOT production

**Do not merge, deploy, expose to the internet, use production Rada accounts/data, or connect a real WhatsApp account with this branch.** This is a functional-in-parts experimental integration, not a verified working or secure WhatsApp connection. It has never been live paired and it does not meet the requested production standard. Unofficial linking can restrict a WhatsApp account. GitHub Pages cannot run the required persistent worker.

## What's actually here

A loopback-only Node service with a real Baileys 7.0.0-rc14 adapter that requests a phone pairing code, keeps Signal credentials and bounded recent text chats in process memory, processes WhatsApp event updates, and attempts logout. It never displays a QR: the library's QR event is used only as a readiness signal. It does not log phones, tokens, codes, keys, or chats. The pairing code is necessarily held temporarily in library credential state and UI memory. The result is not verified with WhatsApp, so compatibility, history completeness, pairing, reconnection, and logout cannot be promised. Only text and captions received by the adapter are shown; no sending or media download. Some sync/history events may not arrive. Automatic reconnection is limited to the post-pair restart.

Every request uses an exact Origin check and a Supabase access token. The service obtains the principal from a trusted staging project's HTTPS `/auth/v1/user`, not from a caller-supplied ID. An auth outage fails closed. Single-process maps isolate owners, cap sessions, messages, sizes and attempt rates; no production/distributed guarantees. Responses are `no-store`; no WhatsApp data or codes are deliberately put in browser storage, URL, server logs, SQL, disk, service worker, analytics, or notifications. Local lab opt-in makes the existing Rada Supabase browser session memory-only; the existing production app still persists Rada login tokens. The lab UI renders message text as text and clears it on sign-out. Sign-out does **not** stop the worker session.

Unlink immediately drops local access, tries library logout, and tells the tester to verify/remove the device in WhatsApp. Logout sends a request but remote removal is **not confirmed**. On crash/restart all in-memory keys and chats vanish, while a linked device may remain in WhatsApp. Always remove the test device there. Zeroing ordinary JS object memory/OS swap/crash dumps cannot be guaranteed.

## Automated local checks

```
cd whatsapp-link-lab
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm test
cd ..
node --test test-pwa.cjs
```

Tests use fake sockets, fake chat content, and fake authentication—not live WhatsApp or live Supabase. They check owner separation, validation, bounds, clearing, best-effort unlink, Origin/bearer gates, no-store, UI opt-in and text rendering. They cannot establish live compatibility or production security.

## Isolated lab setup (for a developer, no real account yet)

1. Use a disposable machine/worktree, a **separate** empty Supabase staging project and staging Rada user. Never point this lab to the production project. Set that separate project's public URL/anon key in the local-only copy of `config.js`, and add `window.RADA_WA_LAB = true;` there. Do not commit this local configuration. It enables the menu item only on `http://127.0.0.1` or `http://localhost` and makes Supabase auth nonpersistent for that local lab.
2. Install Node >=20.19 and Corepack/pnpm. Run the commands above. Serve the local copy from `127.0.0.1:8000` (for example, `python -m http.server 8000 --bind 127.0.0.1` from the repository root). Do not use a public tunnel or forward either port. The app origin must be exactly `http://127.0.0.1:8000`.
3. In a separate local shell, privately set `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` to the separate project's public values, and set `STAGING_APP_ORIGIN=http://127.0.0.1:8000`. From `whatsapp-link-lab`, start `corepack pnpm start`. It binds **only** `127.0.0.1:8787`. Never use a service-role key. Avoid putting any credentials or tokens in shell history or shared configuration.
4. Sign in to the disposable staging Rada user locally and open the experimental menu. The opt-in and authentication can be checked without linking any real WhatsApp account. Only after separate approval, a controlled test with a disposable WhatsApp account and two different staging users could test pairing, text receipt, logout and cross-user access. The tester enters the transient code into WhatsApp itself, never into chat or logs. Remove the device in WhatsApp when done and shut down both processes.

## Required before any real use

- Independent threat model and security review; robust Supabase session revocation/re-authentication, anti-abuse across instances, and current Baileys dependency/security review. Auth endpoint verification is not proof of immediate JWT revocation.
- A dedicated maintained persistent server, TLS, hardened host, limited ingress, deployment secrets management, protected backups, crash handling, no-sensitive-data logging, and operational ownership. The loopback HTTP lab is **not** suitable for remote hosting.
- A production-grade atomic encrypted per-owner Signal credential store backed by managed keys, lifecycle/rotation/deletion, per-owner authorization and account/session isolation. This lab deliberately discards credentials on restart and has no durable recovery.
- Privacy review and protection of WhatsApp messages, names and metadata in all layers, including lifecycle, retention, compromised/stolen JWTs, browser origin/XSS, concurrency, scaling, event backlog, memory exhaustion, storage, caches, logs, and incident response. Existing Rada public attachment exposure remains unresolved; this lab does not fix it.
- Two-user adversarial tests and real staged end-to-end tests including pairing, logout confirmation, reconnection, expired/revoked auth, races, rate limiting, crashes, browser/network restrictions, message sync and deletion. Do not assume simulated tests prove them. Only then consider a separately approved production launch and rollback plan.

No SQL is included or executed; no production data was changed.

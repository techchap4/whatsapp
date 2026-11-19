# Privacy rollout: draft; not a complete fix

This branch limits direct-message queries and realtime subscriptions to the signed-in participant and rejects unexpected/stale responses locally. It clarifies privacy settings and that read updates still happen. This is defense in depth, not authorization: modified or older clients bypass it. It does not fix public file exposure, notification previews, read receipts, profile/presence access, blocks, backend policies, or end-to-end encryption. Do not share sensitive files yet.

## Existing media dependencies

- Direct photos/video/audio/voice go to `chat-media` as `<sender-id>/<timestamp>-<random>.<ext>`. Their public-form URL is stored as `messages.media_url` and used directly by renderers.
- Both direct **and group** documents use `chat-files` under `<uploader-id>/docs/...`; their public-form URL is stored in direct or group message `media_url`. Group documents do not get a group-id path just because they belong to a group.
- Group media uses `group-files` paths `<group-id>/media/...`; group avatars use `<group-id>/avatar/...`. Public-form URLs are rendered directly. Group info media tabs, documents, audio, and avatars also depend on these URLs.
- Status images and profile avatars use other buckets/public-form URLs and require separate analysis. Existing verification document handling is separate and is not changed by this branch.

Making these three buckets private now would break existing and older clients and historical URLs. Merely changing URL strings or issuing signed URLs does not authorize recipients, and putting long-lived signed URLs into message rows can leak or expire. Object path ownership alone does not establish recipients/group membership; `chat-files` includes group docs. Previously exposed URLs or downloaded copies cannot be recalled by this client change.

## Before any rollout

1. Inventory actual schemas, object references, bucket policies, grants and group membership semantics, including orphans and group-avatar access. Do not inspect private user contents. Design server-enforced upload and read authorization for participants/members, anonymous denial, and least privilege. Review public listing policy and remove or narrow only through a staged compatible policy plan.
2. Design a backward-compatible migration: support historical public URL references and new stable object identifiers in the client, obtain short-lived authorized URLs at use time with refresh/expiry/error handling, cover all renderers/downloads/avatars and old clients; never rely on client-side filters for access control. Define safe migration for documents shared across direct and group chats, and a plan for already shared links and cached copies.
3. Verify in staging with synthetic users/files: anonymous, owner, recipient, unrelated user, current/former group members and admin as relevant; test list/read/upload/overwrite/delete and URL expiry; validate realtime and message operations. Test browser/device and old/new clients, transitions, group avatars, retries, offline/loading behavior and failure/rollback.
4. Agree and rehearse deployments, older-client upgrade strategy, backup/rollback, access continuity and incident response. Private bucket changes and client release must be coordinated; no production policy, bucket, object or data changes are included here. No prior exposure can be undone by this PR.

Known app limitations: initial query loads the oldest 3,000 rows without pagination; gaps can occur between load and subscribe or after reconnect, and realtime deletes are not handled. Multiple asynchronous flows beyond those modified can race. Actual realtime filtering and RLS enforcement require integration tests. Read-receipt behavior and notification previews remain separately unfixed.

Tests: `node --check app.js`, `node --check extras.js`, `node --test test-message-scope.cjs test-pwa.cjs`, `git diff --check`. The archival `test-privacy.cjs` targets a different inactive proposal; it is expected to fail against this intentionally partial implementation and must not be represented as a passing full suite.

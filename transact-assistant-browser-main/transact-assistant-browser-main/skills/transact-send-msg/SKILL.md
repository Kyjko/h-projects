---
name: transact-send-msg
description: >
  Send a one-way operator notification out-of-chat during a Transact
  skill run (e.g. COB completion, halt, or stall reassurance). This
  skill is a customization point — each developer wires it to their
  own channel (Teams, Slack, email, an HTTP webhook, PagerDuty, a
  terminal bell, etc.) or leaves it as a no-op stub. Callers MUST NOT
  block on this skill; it is strictly best-effort and fire-and-forget.
argument-hint: 'message — a single string (may contain newlines). Passed verbatim. Callers typically use the first line as a subject and the remaining lines as a body, but this skill does not enforce that structure.'
---

# Transact — Send operator message

A small abstraction so skills like `transact-run-cob` don't have to
know which notification channel this site uses. Callers invoke this
skill with a single `message` argument; this skill decides what
happens next.

## Contract with callers

- **Best-effort.** Any error must be surfaced verbatim but must NOT
  halt the caller. Callers rely on this contract — the skill is
  notification-only, never a gate.
- **Fire-and-forget.** Do not wait for an acknowledgement; do not
  interpret a reply. The caller's authoritative gate (if any) is a
  separate chat question via the harness's structured-question
  mechanism, not this skill.
- **One argument.** A single `message` string. Structure (subject
  line, body, formatting) is the caller's responsibility; this skill
  passes the string through as-is to whatever channel the developer
  wires below.
- **Idempotence is not guaranteed.** Callers must not assume the
  message was delivered; they also must not retry on their own.

## Default behaviour — no-op stub

Out of the box this skill prints the incoming message to chat
prefixed with `[transact-send-msg/stub]` so the operator sees *what*
would have been sent. No external system is contacted. This keeps a
fresh clone safe to use with any caller.

```
[transact-send-msg/stub] <message verbatim, including newlines>
```

## Customize this skill for your site

Replace the no-op stub above with a call to whatever tool or MCP
your site uses to reach operators. Keep the caller contract intact
(best-effort, fire-and-forget, one `message` argument, errors
surfaced verbatim). Do not introduce a reply path — if you need a
two-way interaction, the caller owns that via its own chat gate.

Leave this section intentionally open. The choice of channel,
transport, payload shape, authentication, and rate-limit handling
is a per-developer / per-site decision and should live here.

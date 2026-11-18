# ADR: Anniversary bank ownership moves to ivrm-web Today-in-History

Status: accepted (Herta #880, ivrm-web #866). This ADR records the
relationship between the legacy Herta anniversary bank and the Web
bank before the migration code lands, as required by the #836 audit.

## Context

The 09:00 daily-bonus announcement was the only Daily surface whose
content bank lived on the Herta side: the `anniversary_events` table
in the Herta database plus the Studio "anniversary and sources"
editor. Settings, points and quiz content are all owned by ivrm-web
Admin, so the data owner and the management UI were split from the
rest of the Daily family. The Herta bank held exactly two rows
(10/30 and 10/31, both game releases, approved + public).

## Decision

- The single source of truth for "今日は何の日？" entries is the
  ivrm-web Today-in-History bank (`today_history_entries`), managed
  in Web Admin with its review flow (#867/#868) and member
  submissions (#869).
- Selection happens on the Web side only. The Web API freezes one
  immutable snapshot per JST date; every surface (Member/Admin
  calendars, the Herta announcement) reads that same selection. The
  Bot never re-draws, re-filters or re-ranks items.
- The Bot fetches the day's selection at send time via
  `POST /v2/today-history/herta/daily` with `mode: "confirm"`, using
  the existing points-bridge HMAC service auth
  (`HERTA_POINTS_SECRET`, `X-IVRM-Timestamp` / `X-IVRM-Event-Id` /
  `X-IVRM-Signature`). Confirming at 09:00 is the freeze step for
  the day.
- Any fetch failure degrades to "no anniversary section", exactly
  like a day with no entries. The announcement and the login bonus
  are never blocked by the anniversary source.
- The legacy category filter and local selection
  (`selectAnniversaries`) are retired: category, priority and the
  3-item cap are Web-side selection concerns now. The Bot keeps a
  display cap of at most 3 and strictly validates the payload
  (confirmed flag, matching date, https sources only).

## Field mapping (legacy → Web bank)

| Herta `anniversary_events`                        | Web `today_history_entries`                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `title`                                           | `title`                                                                         |
| `summary`                                         | `summary`                                                                       |
| `category`                                        | `category`                                                                      |
| `month` + `day`                                   | `recurrence = 'annual'`, `month_day = 'MM-DD'`                                  |
| `pinned_date`                                     | `recurrence = 'once'`, `exact_date`                                             |
| `base_year` (with `anniversary_mode = 'elapsed'`) | `origin_year` (elapsed years are derived at selection time)                     |
| `source_url`                                      | `source_url` (https only, same rule)                                            |
| `priority`                                        | `priority`                                                                      |
| `approved` + `public`                             | `status = 'approved'` + `is_public = true`, reached through the Web review flow |
| `source_checked_at`                               | re-checked and stamped by the Web review approval                               |

The two legacy rows keep their ids in the Web bank
(`nintendo_pikmin3_deluxe_jp`, `nintendo_luigis_mansion3_jp`) and
were registered as `pending_review` with
`created_by = 'herta-880-migration'`, so their publication goes
through the same review flow as any other entry.

## Removal order

1. Bot switches to the Web API (this change). The legacy table and
   Studio editor stay in place but are no longer read by the Bot.
2. Studio anniversary editor/API is removed and replaced with a
   link to Web Admin `/today-history`.
3. The `anniversary_events` table is dropped (separate database
   gate) once steps 1–2 are live and the migrated rows are approved
   in the Web bank.

## Consequences

- One bank, one selection, one management surface for all Daily
  content; no dual source of truth during or after the migration.
- The 09:00 announcement depends on the Web API being reachable at
  send time; the failure mode is a missing anniversary section,
  never a missing announcement.
- Per-guild anniversary banks are gone: the Web bank is shared, and
  the HMAC guild check only scopes which guild may confirm/fetch.

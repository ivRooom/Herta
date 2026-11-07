# ivrm Guild member directory (proposal)

Tracking: Herta #513, ivrm-contracts #23 / draft PR #24, ivrm-web #515 / #521.

The additive integration routes reuse the existing ivrm Bearer authorization and
exact configured-guild boundary. Authentication, guild scope and input bounds are
checked before querying the Bot. All handler responses are private/no-store.

`GET /api/integrations/ivrm/guilds/{guildId}/members?query=...&limit=...` returns
only ID, username, display name and bot flag for named selectors. Trimmed queries
have 2–64 UTF-16 code units; limit is 1–20. This reuses the existing bounded member
search and its 15-second cache. It is not an authorization snapshot.

`GET /api/integrations/ivrm/guilds/{guildId}/members/{userId}` delegates an exact
numeric lookup to the existing Bot search domain, which uses `force: true` and
does not reuse the name-search cache. It additionally projects unique role IDs,
excluding @everyone. Confirmed absence returns 404, unavailable upstream returns
503, and a successful member with no additional roles returns an empty role list.
Failed or malformed lookups must not erase the consumer's stored role IDs.

The Studio internal parser accepts 1–20 digit role IDs, matching the existing
role-directory contract and supporting older short role IDs. No private profile,
birthday, avatar URL, token or permission bitset is exposed. No Discord mutation,
DB migration, new resource, Bot token copying or secret change is introduced.

The candidate contract is vendored at `contracts/ivrm/herta-guild-members.v1.bundle.json`.
Tests validate actual handler responses, auth-before-upstream, request correlation,
bounds, duplicate/malformed data, empty results and failure distinctions. Existing
Bot tests verify exact lookups force-fetch every time and distinguish Unknown
Member from transport errors. Consumer conformance and cross-repository rollout
are pending. Do not deploy this draft before that evidence and contract approval.

Order: contract after both conformance suites, additive Herta producer, ivrm-web
consumer, Admin. Roll back consumer first, then producer. Integration handlers are
independent from Plugin settings and do not change Guild configuration.

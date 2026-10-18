# ivrm guild-role directory

`GET /api/integrations/ivrm/guilds/{guildId}/roles` exposes the existing Bot guild
options role list to the configured ivrm integration. It reuses constant-time
Bearer authentication and the existing exact configured-guild boundary.

The response contains only ID, name, integer RGB color, position and managed
status, plus guild ID and source timestamp. The implicit `@everyone` role is
excluded, matching member role IDs. Channels, member data, permissions, editable
flags and Bot credentials are not forwarded. Invalid/duplicate role entries fail
the whole response; an empty additional-role list remains valid.

All responses are private/no-store. Authentication failure is 401, another guild
is 404, and unavailable configuration/upstream data is 503. The existing
Studio-to-Bot authenticated options request retains its bounded timeout. No
Discord mutations, migration, new secret, permission or resource is required.

Canonical contract: ivrm-contracts, `herta-guild-roles` v1.0.0, vendored at
`contracts/ivrm/herta-guild-roles.v1.bundle.json`. Producer tests validate real
handler output against the portable schema and cover authorization, guild scope,
serialization, malformed upstream data and unavailable responses.

Deploy this additive producer before enabling its ivrm-web consumer. If rolling
both back, roll back the consumer first. Producer-only rollback makes that new
consumer's directory temporarily unavailable but must not expose credentials or
erase assigned role IDs. Tracking: Herta #509, ivrm-web #508, ivrm-contracts #20.

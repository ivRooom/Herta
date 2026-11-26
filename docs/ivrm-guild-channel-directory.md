# ivrm guild-channel directory

`GET /api/integrations/ivrm/guilds/{guildId}/channels` exposes the existing Bot
guild options channel list to the configured ivrm integration. It reuses
constant-time Bearer authentication and the existing exact configured-guild
boundary, mirroring the guild-role directory.

The response contains only ID, name, kind, position and parent category ID,
plus guild ID and source timestamp. Only announcement targets are projected:
text and announcement channels the Bot can view. Forum, thread, voice and
non-viewable channels are excluded, as are roles, member data, permissions,
viewable flags and Bot credentials. Invalid or duplicate projected entries
fail the whole response; an empty channel list remains valid.

All responses are private/no-store. Authentication failure is 401, another guild
is 404, and unavailable configuration/upstream data is 503. The existing
Studio-to-Bot authenticated options request retains its bounded timeout. No
Discord mutations, migration, new secret, permission or resource is required.

Canonical contract: ivrm-contracts, `herta-guild-channels` v1.0.0, vendored at
`contracts/ivrm/herta-guild-channels.v1.bundle.json`. Producer tests validate real
handler output against the portable schema and cover authorization, guild scope,
serialization, malformed upstream data and unavailable responses.

Deploy this additive producer before enabling its ivrm-web consumer. If rolling
both back, roll back the consumer first. Producer-only rollback makes that new
consumer's directory temporarily unavailable but must not expose credentials or
erase assigned channel IDs. Tracking: Herta #1022, ivrm-web #1914.

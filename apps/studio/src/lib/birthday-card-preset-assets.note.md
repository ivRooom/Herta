# Birthday Card preset asset validation

Birthday Card preset files under `apps/studio/public/birthday-card-presets` must be real, decodable WebP images at 1672×941.

The bot test suite opens every file declared by `BIRTHDAY_CARD_PRESETS` with Sharp, verifies the format and dimensions, and performs a full raw decode. This intentionally catches files that exist on disk or have a plausible extension/header but cannot actually be rendered by browsers, Canvas export, or the Bot renderer.

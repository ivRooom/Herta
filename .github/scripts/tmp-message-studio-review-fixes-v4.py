from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# 1) Validate visibility against the selected delivery format.
replace(
    'plugins/daily-content/src/config.ts',
    """  const messageFormat = normalizeMessageFormat(input.messageFormat);
  const embed = normalizeMessageStudioEmbed(input.embed, config.allowUserMentions);
  if (!content && !embedHasVisibleContent(embed)) {
    throw new DailyContentValidationError('本文またはEmbedの内容を入力してください');
  }
""",
    """  const messageFormat = normalizeMessageFormat(input.messageFormat);
  const embed = normalizeMessageStudioEmbed(input.embed, config.allowUserMentions);
  if (messageFormat === 'text' && !content) {
    throw new DailyContentValidationError('通常メッセージでは本文を入力してください');
  }
  if (messageFormat === 'embed' && !embedHasVisibleContent(embed)) {
    throw new DailyContentValidationError('Embed形式ではEmbedの内容を入力してください');
  }
""",
)

# 2) An existing crosspost schedule must remain editable after the guild setting
# is switched off. Unrelated PATCH requests automatically clear the stale flag;
# an explicit attempt to set it true still flows into shared validation and fails.
replace(
    'plugins/daily-content/src/service.ts',
    """        publishAnnouncement: input.patch.publishAnnouncement ?? current.publishAnnouncement,
      },
      input.config,
      now,
    );
""",
    """        publishAnnouncement:
          !input.config.allowAnnouncementCrosspost && input.patch.publishAnnouncement === undefined
            ? false
            : (input.patch.publishAnnouncement ?? current.publishAnnouncement),
      },
      input.config,
      now,
    );
""",
)

# Studio must not submit the stale true value from a disabled checkbox.
replace(
    'apps/studio/src/components/daily-content-manager.tsx',
    """      publishAnnouncement: schedule.publishAnnouncement,
    });
""",
    """      publishAnnouncement: schedule.publishAnnouncement && allowAnnouncementCrosspost,
    });
""",
)

# Config regression tests.
p = Path('plugins/daily-content/src/config.test.ts')
text = p.read_text()
insert = r'''

  it('選択したmessageFormatに実際に配信できる内容が必要', () => {
    const config = normalizeDailyContentConfig({});
    const base = {
      channelId: '123456789012345678',
      scheduleTime: '09:00',
      recurrenceType: 'daily' as const,
    };

    expect(() =>
      normalizeDailyContentInput(
        {
          ...base,
          content: '',
          messageFormat: 'text',
          embed: { description: 'Embedだけ' },
        },
        config,
      ),
    ).toThrow('通常メッセージでは本文を入力してください');

    expect(() =>
      normalizeDailyContentInput(
        {
          ...base,
          content: '本文だけ',
          messageFormat: 'embed',
          embed: null,
        },
        config,
      ),
    ).toThrow('Embed形式ではEmbedの内容を入力してください');

    expect(
      normalizeDailyContentInput(
        {
          ...base,
          content: '本文',
          messageFormat: 'embed',
          embed: { description: 'Embed本文' },
        },
        config,
      ).messageFormat,
    ).toBe('embed');
  });
'''
if insert.strip() not in text:
    text = text.rsplit('\n});', 1)[0] + insert + '\n});\n'
p.write_text(text)

# Service regression: existing persisted crosspost can be edited/toggled after
# the config permission is turned off, and the stale persisted flag is cleared.
p = Path('plugins/daily-content/src/service.test.ts')
text = p.read_text()
text = text.replace(
    """  reserveDueDelivery,
  type DailyContentDeliveryRecord,""",
    """  reserveDueDelivery,
  updateDailyContent,
  type DailyContentDeliveryRecord,""",
    1,
)
if "from './config.js'" not in text:
    text = text.replace(
        "import { describe, expect, it } from 'vitest';\n",
        "import { describe, expect, it } from 'vitest';\nimport { normalizeDailyContentConfig } from './config.js';\n",
        1,
    )
text = text.replace(
    'function createHarness() {',
    'function createHarness(overrides: Partial<DailyContentRecord> = {}) {',
    1,
)
text = text.replace(
    """    updatedAt: new Date('2029-12-01T00:00:00Z'),
  };""",
    """    updatedAt: new Date('2029-12-01T00:00:00Z'),
    ...overrides,
  };""",
    1,
)
insert = r'''

  it('Crosspost設定をOFFにした後も既存予約を編集でき、保存済みフラグを解除する', async () => {
    const harness = createHarness({
      recurrenceType: 'daily',
      onceAt: null,
      scheduleTime: '09:00',
      publishAnnouncement: true,
      nextRunAt: new Date('2030-01-02T09:00:00Z'),
    });

    const updated = await updateDailyContent(harness.prisma, {
      guildId: 'guild-1',
      scheduleId: 'schedule-1',
      actorId: 'user-2',
      config: normalizeDailyContentConfig({ allowAnnouncementCrosspost: false }),
      patch: { title: 'Crosspost解除後も編集可能' },
      now: new Date('2029-12-31T00:00:00Z'),
    });

    expect(updated?.title).toBe('Crosspost解除後も編集可能');
    expect(updated?.publishAnnouncement).toBe(false);
  });
'''
if insert.strip() not in text:
    text = text.rsplit('\n});', 1)[0] + insert + '\n});\n'
p.write_text(text)

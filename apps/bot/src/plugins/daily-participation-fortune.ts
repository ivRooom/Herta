import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { savedDailyFortune } from './daily-fortune.js';
import { fetchIvrmFortuneProfile } from './fortune-ivrm-profile.js';
import { EMPTY_FORTUNE_PROFILE } from './fortune-core.js';
import { renderFortuneCard } from './fortune-card.js';
export async function participationFortune(
  ctx: { guildId: string; prisma: PrismaClient },
  interaction: ButtonInteraction | ModalSubmitInteraction,
  date: string,
) {
  try {
    const source = await fetchIvrmFortuneProfile(ctx.guildId, interaction.user.id, date);
    const fortune = await savedDailyFortune(
      ctx.prisma,
      ctx.guildId,
      interaction.user.id,
      date,
      source.status === 'linked' ? source.profile : EMPTY_FORTUNE_PROFILE,
    );
    const card = await renderFortuneCard(fortune, interaction.user.displayName, null);
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      files: [new AttachmentBuilder(card, { name: 'herta-fortune.png' })],
      embeds: [
        new EmbedBuilder()
          .setTitle(`🔮 ${fortune.title}`)
          .setImage('attachment://herta-fortune.png')
          .setColor(fortune.hex as `#${string}`)
          .setDescription(
            `${fortune.message}\n総合運 ${'★'.repeat(fortune.stars)}\n${fortune.action}`,
          )
          .setFooter({ text: fortune.disclaimer }),
      ],
    });
  } catch {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: 'ボーナスは受取済みです。運勢は /fortune today で再確認できます。',
    });
  }
}

import {
  AttachmentBuilder,
  type ButtonInteraction,
  type InteractionEditReplyOptions,
} from 'discord.js';
import {
  selectDailyQuizResultAsset,
  type DailyQuizResult,
} from './daily-quiz-result-asset-selector.js';
import {
  fetchDailyResultCardConfig,
  fetchDailyResultCardMedia,
} from './daily-result-card-config.js';
import { renderDailyResultCard } from './daily-result-card.js';

export interface DailyResultCardReplyInput {
  guildId: string;
  userId: string;
  /** The canonical answer-result text, sent unchanged whenever no card is shown. */
  content: string;
  /** Graded outcome only; null for pending/void results (never carded). */
  result: DailyQuizResult | null;
  rewardPoints: number;
  balance: number;
  /**
   * Stable identity of the finalized answer, used as the selector seed so a
   * re-display of the same answer picks the same artwork for a given pool
   * revision. Built from server-finalized values only (never a click ID or a
   * render timestamp).
   */
  finalizedReceiptId: string;
}

interface DailyResultCardReplyDeps {
  fetchConfig: typeof fetchDailyResultCardConfig;
  fetchMedia: typeof fetchDailyResultCardMedia;
  render: typeof renderDailyResultCard;
}

const defaultDeps: DailyResultCardReplyDeps = {
  fetchConfig: fetchDailyResultCardConfig,
  fetchMedia: fetchDailyResultCardMedia,
  render: renderDailyResultCard,
};

type EditReplyInteraction = Pick<ButtonInteraction, 'editReply'>;

/**
 * Reply to a finalized V2 answer. With DAILY_RESULT_CARD_ENABLED on and a
 * graded result, the ephemeral reply gains the result image card chosen from
 * the Admin-registered pool (#803 / #920). Every failure — config fetch, an
 * empty pool, media fetch, rendering, upload — falls back to the exact
 * pre-card text payload. The answer and its award are already committed
 * before this runs and are never re-executed here; this is presentation
 * only, and with the flag off the payload is byte-identical to the legacy
 * reply (rollback = flag off).
 */
export async function replyDailyParticipationAnswer(
  interaction: EditReplyInteraction,
  input: DailyResultCardReplyInput,
  deps: DailyResultCardReplyDeps = defaultDeps,
): Promise<void> {
  const fallback: InteractionEditReplyOptions = {
    content: input.content,
    allowedMentions: { parse: [] },
    components: [],
  };
  if (process.env.DAILY_RESULT_CARD_ENABLED === 'true' && input.result !== null) {
    try {
      const config = await deps.fetchConfig(input.guildId, input.userId);
      if (!config) throw new Error('ResultCardConfigUnavailable');
      const asset = selectDailyQuizResultAsset(config.pool, input.result, input.finalizedReceiptId);
      if (!asset) throw new Error('ResultCardAssetUnavailable');
      const meta = (
        input.result === 'correct' ? config.correctAssets : config.incorrectAssets
      ).find((entry) => entry.assetId === asset.assetId);
      if (!meta) throw new Error('ResultCardAssetUnavailable');
      const artwork = await deps.fetchMedia(input.guildId, input.userId, meta);
      if (!artwork) throw new Error('ResultCardMediaUnavailable');
      const card = await deps.render({
        result: input.result,
        rewardPoints: input.rewardPoints,
        balance: input.balance,
        artwork,
      });
      await interaction.editReply({
        ...fallback,
        files: [
          new AttachmentBuilder(card, {
            name: 'herta-daily-result.png',
            // The pool asset's Admin-registered alt text. It describes the
            // artwork only; answer content never reaches the attachment.
            description: asset.alt,
          }),
        ],
      });
      return;
    } catch {
      // The canonical answer is committed. Retry only presentation, never the answer.
      await interaction.editReply({ ...fallback, files: [], attachments: [] });
      return;
    }
  }
  await interaction.editReply(fallback);
}

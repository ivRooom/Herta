import { MessageFlags } from 'discord.js';
import { fetchCommonPointsBalance, resolveCommonPointsConfig } from '@herta/shared/common-points';
import type { SlashCommand } from './registry.js';

/** The Discord-authenticated caller is the only permitted wallet subject. */
export function createCommonPointsCommand(
  env: Partial<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): SlashCommand {
  return {
    definition: {
      name: 'common-points',
      description: '自分のivRooom共通ポイント残高を本人だけに表示します',
    },
    async execute(interaction) {
      const config = resolveCommonPointsConfig(env);
      if (!interaction.guildId || !config || interaction.guildId !== config.guildId) {
        await interaction.reply({
          content: 'このサーバーでは共通ポイントの照会を利用できません。',
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
      // The signed API can take five seconds. Acknowledge privately before IO.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const account = await fetchCommonPointsBalance(
        config,
        interaction.guildId,
        interaction.user.id,
        fetcher,
      );
      await interaction.editReply({
        content: account
          ? `あなたの共通ポイント残高：**${account.balance.toLocaleString('ja-JP')} pt**\n照会時点の確定残高です。獲得処理中のポイントは処理完了後に反映されます。\n履歴・利用方法：https://member.ivrm.jp/points`
          : '共通ポイント残高を確認できませんでした。時間をおいて再度お試しください。アカウント連携状況は https://member.ivrm.jp で確認できます。',
        allowedMentions: { parse: [] },
      });
    },
  };
}

export const commonPointsCommands = [createCommonPointsCommand()];

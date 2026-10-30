import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { fortuneManifest } from '@herta/plugin-catalog';
import { definePlugin } from '@herta/plugin-sdk';
import { describeFortuneProfile, EMPTY_FORTUNE_PROFILE, localFortuneDate } from './fortune-core.js';
import { renderFortuneCard } from './fortune-card.js';
import { deleteFortuneProfile } from './fortune-repository.js';
import { fetchIvrmFortuneProfile } from './fortune-ivrm-profile.js';
import { savedDailyFortune, publicDailyFortune } from './daily-fortune.js';

const inFlight = new Set<string>();
export const fortunePlugin = definePlugin<{ enabled: boolean }, unknown, PrismaClient>({
  manifest: fortuneManifest,
  provideCommands(context) {
    return [
      {
        definition: fortuneManifest.commands[0]!,
        async execute(interaction: ChatInputCommandInteraction) {
          const guildId = interaction.guildId;
          if (!guildId || context.config.enabled === false) {
            await interaction.reply({
              content: 'サーバー内で占いPluginを有効にして利用してください。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const userId = interaction.user.id;
          const key = `${guildId}:${userId}`;
          const command = interaction.options.getSubcommand();
          if (inFlight.has(key)) {
            await interaction.reply({
              content: '前の占い処理が終わってから、もう一度お試しください。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          // Validation and profile errors always stay private, even for a public result request.
          inFlight.add(key);
          try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const guild = await context.prisma.guild.findUnique({
              where: { id: guildId },
              select: { timezone: true },
            });
            let date: string;
            try {
              date = localFortuneDate(new Date(), guild?.timezone ?? 'Asia/Tokyo');
            } catch {
              date = localFortuneDate(new Date(), 'Asia/Tokyo');
            }
            if (command === 'forget') {
              await deleteFortuneProfile(context.prisma, guildId, userId);
              await interaction.editReply(
                'Hertaに以前登録した占い情報を削除しました。ivrm-webの登録情報は変更しません。占い時はivrm-webの最新情報を取得します。',
              );
              return;
            }
            const source = await fetchIvrmFortuneProfile(guildId, userId, date);
            const saved =
              source.status === 'linked' ? source.profile : { ...EMPTY_FORTUNE_PROFILE };
            const sourceMessage =
              source.status === 'linked'
                ? 'ivrm-webに登録した本人のプロフィールを使っています。未登録の項目は使いません。変更は https://member.ivrm.jp/profile/onboarding から行えます。'
                : source.status === 'ineligible-guild'
                  ? 'このサーバーはivrm-webの会員情報連携の対象外です。今回は登録情報を使わず占います。'
                  : source.status === 'unconfigured'
                    ? 'ivrm-webの会員情報連携は未設定です。管理者に連携設定を確認してください。今回は登録情報を使わず占います。'
                    : source.status === 'not-linked'
                      ? '本人のプロフィールが見つかりません。https://member.ivrm.jp/profile/onboarding で占い用プロフィールを保存してください。公開審査前から使えます。今回は登録情報を使わず占います。'
                      : 'ivrm-webのプロフィールを現在取得できません。今回は登録情報を使わず占います。少し待ってからお試しください。';
            if (command === 'profile') {
              const details = describeFortuneProfile(saved, date);
              await interaction.editReply({
                content: `${sourceMessage}\n\n誕生日：${saved.birthday ?? '未取得・未登録'}\n星座：${details.zodiac ?? '未取得・未登録'} / 血液型：${saved.bloodType ?? '未取得・未登録'}\nMBTI：${saved.mbti ?? '未取得・未登録'}\n年齢：${details.age === null ? '未取得・未登録' : `${details.age}歳`} / 年代：${details.ageGroup ?? '未取得・未登録'} / 干支：${details.eto ?? '未取得・未登録'}\n\n本人のみ表示しています。Hertaには取得した情報を保存しません。`,
                allowedMentions: { parse: [] },
              });
              return;
            }
            const isPublic = interaction.options.getBoolean('public') === true;
            const savedFortune = await savedDailyFortune(
              context.prisma,
              guildId,
              userId,
              date,
              saved,
            );
            const fortune = isPublic ? publicDailyFortune(savedFortune) : savedFortune;
            const embed = new EmbedBuilder()
              .setTitle(fortune.title)
              .setColor(fortune.hex as `#${string}`)
              .setDescription(
                `${fortune.message}\n\n総合運 ${'★'.repeat(fortune.stars)}${'☆'.repeat(5 - fortune.stars)}\n今日のアクション：${fortune.action}`,
              )
              .addFields(
                fortune.categories.map((item) => ({
                  name: `${item.name} ${'★'.repeat(item.stars)}${'☆'.repeat(5 - item.stars)}`,
                  value: item.advice,
                })),
              )
              .addFields({
                name: '今日のラッキー',
                value: `カラー：${fortune.color} / アイテム：${fortune.item}\n数字：${fortune.luckyNumber} / 時間帯：${fortune.luckyTime}`,
              })
              .setImage('attachment://herta-fortune.png')
              .setFooter({ text: `${date} · ${fortune.disclaimer}` });
            if (!isPublic && fortune.notes.length)
              embed.addFields({
                name: 'あなたへのヒント（本人のみ）',
                value: fortune.notes.join('\n'),
              });
            const card = await renderFortuneCard(
              fortune,
              interaction.user.displayName,
              isPublic || process.env.DAILY_BONUS_ENABLED === 'true' ? null : saved.mbti,
            );
            const payload = {
              embeds: [embed],
              files: [new AttachmentBuilder(card, { name: 'herta-fortune.png' })],
              allowedMentions: { parse: [] as const },
            };
            if (isPublic) {
              // Complete the private deferred response before creating a public follow-up.
              await interaction.editReply(
                `${sourceMessage}\n\n個人情報を除いた運勢カードを公開しています…`,
              );
              await interaction.followUp({ ...payload, flags: [] });
              await interaction.editReply(
                `${sourceMessage}\n\n今日の運勢カードを公開しました。誕生日・年齢・血液型などのプロフィール項目や個人向けの補足は公開していません。`,
              );
            } else await interaction.editReply({ ...payload, content: sourceMessage });
          } catch (error) {
            // Never include profile values in logs or error replies.
            context.logger.error(
              { error: error instanceof Error ? error.name : 'UnknownError' },
              'Fortune command failed',
            );
            await interaction.editReply(
              '占いを作成できませんでした。少し待ってからお試しください。',
            );
          } finally {
            inFlight.delete(key);
          }
        },
      },
    ];
  },
});

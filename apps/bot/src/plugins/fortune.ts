import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { fortuneManifest } from '@herta/plugin-catalog';
import { definePlugin } from '@herta/plugin-sdk';
import {
  createDailyFortune,
  describeFortuneProfile,
  EMPTY_FORTUNE_PROFILE,
  localFortuneDate,
  validateFortuneProfile,
  type FortuneProfile,
} from './fortune-core.js';
import { renderFortuneCard } from './fortune-card.js';
import {
  deleteFortuneProfile,
  getFortuneProfile,
  saveFortuneProfile,
} from './fortune-repository.js';

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
                'このサーバーの占いプロフィールを削除しました。公開済みのメッセージや保存した画像は別途削除してください。',
              );
              return;
            }
            const saved = (await getFortuneProfile(context.prisma, guildId, userId)) ?? {
              ...EMPTY_FORTUNE_PROFILE,
            };
            if (command === 'profile') {
              const fields = {
                birthday: 'birthday',
                bloodType: 'blood-type',
                mbti: 'mbti',
                zodiac: 'zodiac',
                ageGroup: 'age-group',
                eto: 'eto',
              } as const;
              const profile = { ...saved };
              let changed = false;
              for (const [field, option] of Object.entries(fields)) {
                const value = interaction.options.getString(option)?.trim();
                if (value !== undefined) {
                  if (!value) {
                    await interaction.editReply(
                      '空欄は登録できません。項目を外す場合は /fortune forget 後、必要な項目だけ再登録してください。',
                    );
                    return;
                  }
                  profile[field as keyof FortuneProfile] =
                    field === 'mbti' ? value.toUpperCase() : value;
                  changed = true;
                }
              }
              // Date-derived fields replace stale derived overrides when birthday is updated.
              if (interaction.options.getString('birthday') !== null) {
                for (const field of ['zodiac', 'ageGroup', 'eto'] as const)
                  if (interaction.options.getString(fields[field]) === null) profile[field] = null;
              }
              try {
                validateFortuneProfile(profile, date);
              } catch (error) {
                await interaction.editReply(
                  error instanceof Error ? error.message : '入力を確認してください。',
                );
                return;
              }
              // Derived values must not become stale (for example on entering a new decade).
              if (profile.birthday) profile.zodiac = null;
              if (profile.birthday?.length === 10) {
                profile.ageGroup = null;
                profile.eto = null;
              }
              if (changed) await saveFortuneProfile(context.prisma, guildId, userId, profile);
              const details = describeFortuneProfile(profile, date);
              await interaction.editReply({
                content: `${changed ? '占いプロフィールを保存しました。' : '現在の占いプロフィール'}\n誕生日：${profile.birthday ?? '未登録'}\n星座：${details.zodiac ?? '未登録'} / 血液型：${profile.bloodType ?? '未登録'}\nMBTI：${profile.mbti ?? '未登録'}\n年齢：${details.age === null ? '未登録' : `${details.age}歳`} / 年代：${details.ageGroup ?? '未登録'} / 干支：${details.eto ?? '未登録'}\n\nすべて任意・このサーバー内で本人のみ確認できます。/fortune forget で削除できます。\n星座は一般的な日付区分、干支は日本の暦年で算出します。`,
                allowedMentions: { parse: [] },
              });
              return;
            }
            const fortune = createDailyFortune(guildId, userId, date, saved);
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
            const isPublic = interaction.options.getBoolean('public') === true;
            if (!isPublic && fortune.notes.length)
              embed.addFields({
                name: 'あなたへのヒント（本人のみ）',
                value: fortune.notes.join('\n'),
              });
            const card = await renderFortuneCard(
              fortune,
              interaction.user.displayName,
              isPublic ? null : saved.mbti,
            );
            const payload = {
              embeds: [embed],
              files: [new AttachmentBuilder(card, { name: 'herta-fortune.png' })],
              allowedMentions: { parse: [] as const },
            };
            if (isPublic) {
              // Complete the private deferred response before creating a public follow-up.
              await interaction.editReply('個人情報を除いた運勢カードを公開しています…');
              await interaction.followUp({ ...payload, flags: [] });
              await interaction.editReply(
                '今日の運勢カードを公開しました。誕生日・年齢・血液型などのプロフィール項目や個人向けの補足は公開していません。',
              );
            } else await interaction.editReply(payload);
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

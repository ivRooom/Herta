import type { PrismaClient } from '@herta/db';
import { dailyQuizManifest } from '@herta/plugin-catalog';
import { definePlugin } from '@herta/plugin-sdk';
import type { Client } from 'discord.js';

interface Config {
  participationEnabled: boolean;
  resultCardEnabled: boolean;
}

/**
 * Daily Quiz のカタログ登録 (#887)。
 *
 * 実行主体は daily-bonus のまま (発表メッセージの配信・dispatch・結果スキャン) で、
 * この Plugin は Studio のプラグイン一覧と設定の受け皿に徹する。独自のイベント
 * ハンドラは持たず、ON/OFF は daily-bonus 側が daily-quiz-settings.ts 経由で
 * この Plugin の設定を参照して決める (二重配信・二重実行を作らない)。
 */
export const dailyQuizPlugin = definePlugin<Config, Client, PrismaClient>({
  manifest: dailyQuizManifest,
  provideEvents() {
    return [];
  },
});

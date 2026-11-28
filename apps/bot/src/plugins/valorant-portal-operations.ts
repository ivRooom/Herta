import type { PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import {
  applyValorantTrollsToSession,
  getActiveValorantCandidates,
  normalizeValorantConfig,
  pickValorantAssignments,
  type ValorantPortalDiscordPort,
} from './valorant.js';
import { VALORANT_COMPOSITION_VERSION } from './valorant-maps.js';
import {
  createValorantSession,
  getValorantSession,
  manageValorantParticipants,
  mutateValorantSession,
  rerollValorantSession,
  setValorantSessionMessageId,
  toggleValorantSessionTrollOff,
  type ValorantMutation,
  type ValorantSessionSnapshot,
} from './valorant-session-repository.js';
import type {
  ValorantPortalCreateInput,
  ValorantPortalMutationOutcome,
  ValorantPortalOperations,
  ValorantPortalSessionRow,
} from './valorant-portal-api.js';

/**
 * VALORANT ポータル API の操作系の実体 (S6-H2、Herta #1050)。
 *
 * 既存 repository mutation への委譲だけを行い、認可・状態再検査・
 * 行ロックによる直列化はすべて repository 側の担保をそのまま使う
 * (Discord ボタンとポータル操作の競合は既存の直列化に乗る)。
 * Discord 反映は `ValorantPortalDiscordPort` 経由で、作成時の募集
 * Embed 投稿だけが失敗時に操作自体を失敗させる (投稿できない募集行を
 * 残さない、S6-PLAN §3.6)。それ以外の反映は fail-soft で、DB が正本。
 *
 * 人狼 (WEREWOLF) セッションは S6-W までポータル操作の対象外とし、
 * 存在を伏せるため `missing` として扱う。
 */

export interface ValorantPortalOperationsDeps {
  prisma: PrismaClient;
  guildId: string;
  discord: ValorantPortalDiscordPort;
  logger: Logger;
  /** 縛り合流・ピックカード向けの表示名解決 (任意) */
  displayNameFor?: (userId: string) => string | undefined;
}

function toOutcome(mutation: ValorantMutation): ValorantPortalMutationOutcome {
  if (mutation.status !== 'ok') return { status: mutation.status };
  return {
    status: 'ok',
    session: mutation.session as unknown as ValorantPortalSessionRow,
  };
}

export function createValorantPortalOperations(
  deps: ValorantPortalOperationsDeps,
): ValorantPortalOperations {
  const { prisma, guildId } = deps;

  async function loadConfig() {
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'valorant' } },
    });
    return { plugin, config: normalizeValorantConfig(plugin?.config) };
  }

  /** 人狼は対象外。対象外・不存在はどちらも null (呼び出し側は missing) */
  async function loadPortalSession(sessionId: string): Promise<ValorantSessionSnapshot | null> {
    const session = await getValorantSession(prisma, guildId, sessionId);
    if (!session || session.mode === 'WEREWOLF') return null;
    return session;
  }

  async function syncAfterMutation(session: ValorantSessionSnapshot): Promise<void> {
    await deps.discord.syncRecruitment(session).catch(() => false);
  }

  return {
    async createSession(actor, input: ValorantPortalCreateInput) {
      const { plugin, config } = await loadConfig();
      if (!plugin?.enabled || !config.enabled) return { status: 'unavailable' };
      const expiresAt = new Date(Date.now() + config.sessionDurationMinutes * 60_000);
      const created = await createValorantSession(prisma, {
        guildId,
        channelId: input.channelId,
        creatorId: actor.userId,
        mode: input.mode,
        mapId: input.mapId,
        voiceChannelId: input.voiceChannelId,
        vcAutoJoin: input.vcAutoJoin,
        maxParticipants: config.maxParticipants,
        expiresAt,
        rulesVersion: input.mode === 'TACTICAL' ? VALORANT_COMPOSITION_VERSION : 'fisher-yates-v1',
        trollOffUserIds: input.trollOff ? [actor.userId] : [],
      });
      let session = created as unknown as ValorantSessionSnapshot;
      let messageId: string;
      try {
        messageId = await deps.discord.postRecruitmentMessage(session);
      } catch (error) {
        // §3.6: 投稿に失敗した場合はセッション行を作らない (補償削除)
        deps.logger.warn(
          {
            guildId,
            sessionId: session.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'VALORANTポータル作成の募集投稿に失敗したためセッションを取り消しました',
        );
        await prisma.valorantPickSession
          .delete({ where: { id: session.id } })
          .catch(() => undefined);
        return { status: 'unavailable' };
      }
      await setValorantSessionMessageId(prisma, guildId, session.id, messageId);
      session = { ...session, messageId };
      if (input.vcAutoJoin) {
        // Discord コマンド作成と同じ競合対策: messageId 保存前に VC 自動
        // 参加が入っていたら初期投稿を最新化する (fail-soft)
        const reloaded = await getValorantSession(prisma, guildId, session.id).catch(() => null);
        if (
          reloaded &&
          reloaded.participants.some(
            ({ userId }) => !session.participants.some((entry) => entry.userId === userId),
          )
        ) {
          await syncAfterMutation(reloaded);
          session = reloaded;
        }
      }
      return { status: 'ok', session: session as unknown as ValorantPortalSessionRow };
    },

    async joinSession(actor, sessionId) {
      if (!(await loadPortalSession(sessionId))) return { status: 'missing' };
      const outcome = toOutcome(
        await mutateValorantSession(prisma, {
          guildId,
          id: sessionId,
          userId: actor.userId,
          action: 'join',
          isAdmin: actor.isAdmin,
        }),
      );
      if (outcome.session) await syncAfterMutation(outcome.session as ValorantSessionSnapshot);
      return outcome;
    },

    async leaveSession(actor, sessionId) {
      if (!(await loadPortalSession(sessionId))) return { status: 'missing' };
      const outcome = toOutcome(
        await mutateValorantSession(prisma, {
          guildId,
          id: sessionId,
          userId: actor.userId,
          action: 'leave',
          isAdmin: actor.isAdmin,
        }),
      );
      if (outcome.session) await syncAfterMutation(outcome.session as ValorantSessionSnapshot);
      return outcome;
    },

    async toggleTrollOff(actor, sessionId) {
      if (!(await loadPortalSession(sessionId))) return { status: 'missing' };
      const { config } = await loadConfig();
      if (!config.trollGacha.enabled) return { status: 'unavailable' };
      const outcome = toOutcome(
        await toggleValorantSessionTrollOff(prisma, {
          guildId,
          id: sessionId,
          userId: actor.userId,
        }),
      );
      if (outcome.session) await syncAfterMutation(outcome.session as ValorantSessionSnapshot);
      return outcome;
    },

    async manageParticipants(actor, sessionId, action, targetUserId) {
      if (!(await loadPortalSession(sessionId))) return { status: 'missing' };
      const outcome = toOutcome(
        await manageValorantParticipants(prisma, {
          guildId,
          id: sessionId,
          userId: actor.userId,
          isAdmin: actor.isAdmin,
          action,
          targetIds: [targetUserId],
        }),
      );
      if (outcome.session) await syncAfterMutation(outcome.session as ValorantSessionSnapshot);
      return outcome;
    },

    async drawSession(actor, sessionId) {
      const existing = await loadPortalSession(sessionId);
      if (!existing) return { status: 'missing' };
      const { plugin, config } = await loadConfig();
      if (!plugin?.enabled || !config.enabled) return { status: 'unavailable' };
      const candidates = await getActiveValorantCandidates(prisma, guildId, config);
      const outcome = toOutcome(
        await mutateValorantSession(prisma, {
          guildId,
          id: sessionId,
          userId: actor.userId,
          action: 'draw',
          isAdmin: actor.isAdmin,
          candidates,
          pick: pickValorantAssignments,
        }),
      );
      if (!outcome.session) return outcome;
      let display = outcome.session as unknown as ValorantSessionSnapshot;
      if (display.status === 'COMPLETED') {
        // S2 縛り合流は Discord 抽選と同じ経路 (fail-soft は部品側)
        display = await applyValorantTrollsToSession(prisma, deps.logger, display, {
          operatorId: actor.userId,
          config,
          displayName: deps.displayNameFor,
        });
        // 結果投稿の成否はポータル操作の成否にしない (fail-soft、ログは部品側)
        await deps.discord.publishDrawResult(display, deps.displayNameFor).catch(() => false);
      }
      return { status: 'ok', session: display as unknown as ValorantPortalSessionRow };
    },

    async rerollSession(actor, sessionId) {
      const existing = await loadPortalSession(sessionId);
      if (!existing) return { status: 'missing' };
      if (!existing.messageId) return { status: 'closed' };
      const { plugin, config } = await loadConfig();
      if (!plugin?.enabled || !config.enabled) return { status: 'unavailable' };
      const candidates = await getActiveValorantCandidates(prisma, guildId, config);
      const outcome = toOutcome(
        await rerollValorantSession(prisma, {
          guildId,
          id: sessionId,
          messageId: existing.messageId,
          userId: actor.userId,
          isAdmin: actor.isAdmin,
          candidates,
          sessionDurationMinutes: config.sessionDurationMinutes,
          rulesVersion:
            existing.mode === 'TACTICAL' ? VALORANT_COMPOSITION_VERSION : 'fisher-yates-v1',
          pick: pickValorantAssignments,
        }),
      );
      if (!outcome.session) return outcome;
      let display = outcome.session as unknown as ValorantSessionSnapshot;
      display = await applyValorantTrollsToSession(prisma, deps.logger, display, {
        operatorId: actor.userId,
        config,
        displayName: deps.displayNameFor,
      });
      await deps.discord.publishDrawResult(display, deps.displayNameFor).catch(() => false);
      return { status: 'ok', session: display as unknown as ValorantPortalSessionRow };
    },

    async cancelSession(actor, sessionId) {
      if (!(await loadPortalSession(sessionId))) return { status: 'missing' };
      const outcome = toOutcome(
        await mutateValorantSession(prisma, {
          guildId,
          id: sessionId,
          userId: actor.userId,
          action: 'cancel',
          isAdmin: actor.isAdmin,
        }),
      );
      if (outcome.session) await syncAfterMutation(outcome.session as ValorantSessionSnapshot);
      return outcome;
    },
  };
}

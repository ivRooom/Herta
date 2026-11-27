import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@herta/db';
import {
  createValorantSession,
  getValorantSession,
  mutateValorantSession,
} from './valorant-session-repository.js';
import {
  abortValorantWerewolfGame,
  castValorantWerewolfVote,
  closeValorantWerewolfRound,
  completeValorantWerewolfAssignment,
  completeValorantWerewolfPunishment,
  getValorantWerewolfRevealed,
  getValorantWerewolfSecretForUser,
  getValorantWerewolfState,
  openValorantWerewolfVote,
  startValorantWerewolfGame,
} from './valorant-werewolf-repository.js';
import type { ValorantTroll } from './valorant-troll-gacha.js';

const url = process.env.HERTA_VALORANT_TEST_DATABASE_URL;

const SECRET_TROLL: ValorantTroll = {
  itemId: 'troll-secret-1',
  text: '秘密の縛りテキスト',
  rarity: 'rare',
  category: 'settings',
};
const PUNISHMENT_TROLL: ValorantTroll = {
  itemId: 'troll-punishment-1',
  text: '罰ゲームテキスト',
  rarity: 'normal',
  category: 'punishment',
};

test(
  'real PostgreSQL: werewolf lifecycle, secrecy boundary, voting, runoff and abort (#1049)',
  { skip: !url },
  async () => {
    const parsed = new URL(url!);
    assert(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/valorant_test');
    const prisma = new PrismaClient({ datasourceUrl: url });
    const guildId = 'valorant-werewolf-integration';
    const future = () => new Date(Date.now() + 30 * 60_000);
    const names = new Map([
      ['owner', 'Owner'],
      ['alice', 'Alice'],
      ['bob', 'Bob'],
      ['carol', 'Carol'],
    ]);

    async function makeRoom(memberIds: string[]): Promise<string> {
      const session = await createValorantSession(prisma, {
        guildId,
        channelId: 'channel',
        creatorId: 'owner',
        mode: 'WEREWOLF',
        mapId: null,
        maxParticipants: 5,
        expiresAt: future(),
        rulesVersion: 'werewolf-v1',
      });
      for (const userId of ['owner', ...memberIds]) {
        const joined = await mutateValorantSession(prisma, {
          guildId,
          id: session.id,
          userId,
          action: 'join',
          isAdmin: false,
        });
        assert.equal(joined.status, 'ok');
      }
      return session.id;
    }

    try {
      await prisma.guild.create({ data: { id: guildId, name: 'VALORANT werewolf integration' } });

      // --- main flow: citizens find the werewolf -------------------------
      const sessionId = await makeRoom(['alice', 'bob']);
      const started = await startValorantWerewolfGame(prisma, {
        guildId,
        id: sessionId,
        userId: 'owner',
        isAdmin: false,
        displayNames: names,
        pickWerewolf: () => 'alice',
      });
      assert.equal(started.status, 'ok');
      if (started.status !== 'ok') throw new Error('start failed');
      assert.equal(started.started, true);
      assert.equal(started.werewolf.userId, 'alice');
      assert.equal(started.session.status, 'IN_PROGRESS');
      assert.equal(started.game.phase, 'ASSIGNING');

      // 公開状態に秘密は含まれない (game 行に人狼 ID 列自体が無い)
      const publicState = await getValorantWerewolfState(prisma, guildId, sessionId);
      assert.equal(JSON.stringify(publicState?.game).includes('alice'), true); // roster には居る
      assert.equal(JSON.stringify(publicState?.game).includes(SECRET_TROLL.text), false);
      const sessionRow = await getValorantSession(prisma, guildId, sessionId);
      assert.equal(sessionRow?.result, null);

      // 割当完了前は人狼本人でも縛りを読めない
      assert.deepEqual(
        await getValorantWerewolfSecretForUser(prisma, guildId, sessionId, 'alice'),
        {
          kind: 'werewolf_not_ready',
        },
      );
      const assigned = await completeValorantWerewolfAssignment(prisma, {
        guildId,
        id: sessionId,
        drawId: 'draw-secret-1',
        troll: SECRET_TROLL,
      });
      assert.equal(assigned.status, 'ok');
      if (assigned.status === 'ok') assert.equal(assigned.game.phase, 'PLAYING');

      // 秘密は本人だけ / 市民は市民 / 部外者は部外者
      const ownSecret = await getValorantWerewolfSecretForUser(prisma, guildId, sessionId, 'alice');
      assert.equal(ownSecret.kind, 'werewolf');
      if (ownSecret.kind === 'werewolf') assert.equal(ownSecret.troll.text, SECRET_TROLL.text);
      assert.deepEqual(await getValorantWerewolfSecretForUser(prisma, guildId, sessionId, 'bob'), {
        kind: 'citizen',
      });
      assert.deepEqual(
        await getValorantWerewolfSecretForUser(prisma, guildId, sessionId, 'mallory'),
        { kind: 'not_participant' },
      );
      // 確定前は revealed を引けない
      assert.equal(await getValorantWerewolfRevealed(prisma, guildId, sessionId), null);

      // 開始後の参加・退出は roster を変えない (セッションが IN_PROGRESS)
      const lateJoin = await mutateValorantSession(prisma, {
        guildId,
        id: sessionId,
        userId: 'carol',
        action: 'join',
        isAdmin: false,
      });
      assert.equal(lateJoin.status, 'closed');

      // 投票開始は管理者のみ
      assert.equal(
        (
          await openValorantWerewolfVote(prisma, {
            guildId,
            id: sessionId,
            userId: 'bob',
            isAdmin: false,
          })
        ).status,
        'forbidden',
      );
      const opened = await openValorantWerewolfVote(prisma, {
        guildId,
        id: sessionId,
        userId: 'owner',
        isAdmin: false,
      });
      assert.equal(opened.status, 'ok');
      if (opened.status === 'ok') {
        assert.equal(opened.game.phase, 'VOTING');
        assert.equal(opened.game.currentRound, 1);
        assert.deepEqual(opened.game.currentCandidateUserIds, ['owner', 'alice', 'bob']);
      }

      // 投票ガード: 自分 / 部外者 / ラウンド不一致
      assert.equal(
        (
          await castValorantWerewolfVote(prisma, {
            guildId,
            id: sessionId,
            voterUserId: 'alice',
            targetUserId: 'alice',
            round: 1,
          })
        ).status,
        'self_vote',
      );
      assert.equal(
        (
          await castValorantWerewolfVote(prisma, {
            guildId,
            id: sessionId,
            voterUserId: 'mallory',
            targetUserId: 'alice',
            round: 1,
          })
        ).status,
        'not_participant',
      );
      assert.equal(
        (
          await castValorantWerewolfVote(prisma, {
            guildId,
            id: sessionId,
            voterUserId: 'bob',
            targetUserId: 'alice',
            round: 2,
          })
        ).status,
        'stale_round',
      );

      // 投票 + 変更 + 二重送信 (PK で1票に収束)
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: sessionId,
        voterUserId: 'owner',
        targetUserId: 'bob',
        round: 1,
      });
      const changed = await castValorantWerewolfVote(prisma, {
        guildId,
        id: sessionId,
        voterUserId: 'owner',
        targetUserId: 'alice',
        round: 1,
      });
      assert.equal(changed.status, 'ok');
      await Promise.all([
        castValorantWerewolfVote(prisma, {
          guildId,
          id: sessionId,
          voterUserId: 'bob',
          targetUserId: 'alice',
          round: 1,
        }),
        castValorantWerewolfVote(prisma, {
          guildId,
          id: sessionId,
          voterUserId: 'bob',
          targetUserId: 'alice',
          round: 1,
        }),
      ]);
      assert.equal(await prisma.valorantWerewolfVote.count({ where: { sessionId, round: 1 } }), 2);
      const lastVote = await castValorantWerewolfVote(prisma, {
        guildId,
        id: sessionId,
        voterUserId: 'alice',
        targetUserId: 'bob',
        round: 1,
      });
      assert.equal(lastVote.status, 'ok');
      if (lastVote.status === 'ok') assert.equal(lastVote.allVoted, true);

      // 集計: alice 2 (owner, bob) / bob 1 (alice) / owner 0 → 指名 alice = 人狼
      const closed = await closeValorantWerewolfRound(prisma, {
        guildId,
        id: sessionId,
        userId: 'owner',
        isAdmin: false,
        reason: 'all_voted',
        random: () => 0,
      });
      assert.equal(closed.status, 'ok');
      if (closed.status !== 'ok') throw new Error('close failed');
      assert.equal(closed.kind, 'resolving');
      assert.equal(closed.game.outcome, 'CITIZENS_WIN');
      assert.equal(closed.game.accusedUserId, 'alice');
      // 罰ゲームは本投票の最少票者 = owner (0票)
      assert.equal(closed.game.punishmentUserId, 'owner');
      assert.equal(closed.needsPunishmentDraw, true);
      assert.equal(await getValorantWerewolfRevealed(prisma, guildId, sessionId), null);

      const punished = await completeValorantWerewolfPunishment(prisma, {
        guildId,
        id: sessionId,
        drawId: 'draw-punishment-1',
        troll: PUNISHMENT_TROLL,
      });
      assert.equal(punished.status, 'ok');
      if (punished.status === 'ok') {
        assert.equal(punished.game.phase, 'RESOLVED');
        assert.equal(punished.session.status, 'COMPLETED');
      }
      const revealed = await getValorantWerewolfRevealed(prisma, guildId, sessionId);
      assert.equal(revealed?.werewolfUserId, 'alice');
      assert.equal(revealed?.troll?.text, SECRET_TROLL.text);

      // --- runoff: 同票 → 決選 → 最終同票は人狼勝利 -----------------------
      const runoffId = await makeRoom(['alice', 'bob', 'carol']);
      const runoffStart = await startValorantWerewolfGame(prisma, {
        guildId,
        id: runoffId,
        userId: 'owner',
        isAdmin: false,
        displayNames: names,
        pickWerewolf: () => 'carol',
      });
      assert.equal(runoffStart.status, 'ok');
      await completeValorantWerewolfAssignment(prisma, {
        guildId,
        id: runoffId,
        drawId: 'draw-secret-2',
        troll: SECRET_TROLL,
      });
      await openValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        userId: 'owner',
        isAdmin: false,
      });
      // owner→alice, alice→owner, bob→owner... 同票を作る: alice 1, owner 1 にする
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'owner',
        targetUserId: 'alice',
        round: 1,
      });
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'alice',
        targetUserId: 'owner',
        round: 1,
      });
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'bob',
        targetUserId: 'carol',
        round: 1,
      });
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'carol',
        targetUserId: 'carol',
        round: 1,
      }).then((result) => assert.equal(result.status, 'self_vote'));
      const runoffClose = await closeValorantWerewolfRound(prisma, {
        guildId,
        id: runoffId,
        userId: 'owner',
        isAdmin: false,
        reason: 'manual',
        random: () => 0,
      });
      // 集計: alice 1 / owner 1 / carol 1 → 3者同票で決選 (候補は同票者全員)
      assert.equal(runoffClose.status, 'ok');
      if (runoffClose.status !== 'ok') throw new Error('runoff close failed');
      assert.equal(runoffClose.kind, 'runoff');
      assert.equal(runoffClose.game.phase, 'RUNOFF');
      assert.equal(runoffClose.game.currentRound, 2);
      assert.deepEqual(runoffClose.game.currentCandidateUserIds, ['owner', 'alice', 'carol']);
      // 決選で再び同票 → 指名なし・人狼勝利。罰ゲームは第1ラウンド最少票から
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'owner',
        targetUserId: 'alice',
        round: 2,
      });
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'alice',
        targetUserId: 'owner',
        round: 2,
      });
      await castValorantWerewolfVote(prisma, {
        guildId,
        id: runoffId,
        voterUserId: 'bob',
        targetUserId: 'carol',
        round: 2,
      });
      const finalClose = await closeValorantWerewolfRound(prisma, {
        guildId,
        id: runoffId,
        userId: 'owner',
        isAdmin: false,
        reason: 'manual',
        random: () => 0,
      });
      assert.equal(finalClose.status, 'ok');
      if (finalClose.status !== 'ok') throw new Error('final close failed');
      assert.equal(finalClose.game.outcome, 'WEREWOLF_WIN');
      assert.equal(finalClose.game.outcomeReason, 'FINAL_TIE');
      assert.equal(finalClose.game.accusedUserId, null);
      // 第1ラウンドの最少票は bob (0票) → 罰ゲーム対象は bob
      assert.equal(finalClose.game.punishmentUserId, 'bob');

      // --- no votes: 勝敗なしで中止し秘密は公開しない ----------------------
      const emptyId = await makeRoom(['alice', 'bob']);
      await startValorantWerewolfGame(prisma, {
        guildId,
        id: emptyId,
        userId: 'owner',
        isAdmin: false,
        displayNames: names,
        pickWerewolf: () => 'bob',
      });
      await completeValorantWerewolfAssignment(prisma, {
        guildId,
        id: emptyId,
        drawId: 'draw-secret-3',
        troll: SECRET_TROLL,
      });
      await openValorantWerewolfVote(prisma, {
        guildId,
        id: emptyId,
        userId: 'owner',
        isAdmin: false,
      });
      const noVotes = await closeValorantWerewolfRound(prisma, {
        guildId,
        id: emptyId,
        userId: 'owner',
        isAdmin: false,
        reason: 'manual',
      });
      assert.equal(noVotes.status, 'ok');
      if (noVotes.status === 'ok') {
        assert.equal(noVotes.kind, 'no_votes');
        assert.equal(noVotes.game.phase, 'ABORTED');
        assert.equal(noVotes.session.status, 'CANCELLED');
      }
      assert.equal(await getValorantWerewolfRevealed(prisma, guildId, emptyId), null);

      // --- abort: 進行中の中止でも秘密は公開しない --------------------------
      const abortId = await makeRoom(['alice', 'bob']);
      await startValorantWerewolfGame(prisma, {
        guildId,
        id: abortId,
        userId: 'owner',
        isAdmin: false,
        displayNames: names,
        pickWerewolf: () => 'alice',
      });
      await completeValorantWerewolfAssignment(prisma, {
        guildId,
        id: abortId,
        drawId: 'draw-secret-4',
        troll: SECRET_TROLL,
      });
      const aborted = await abortValorantWerewolfGame(prisma, {
        guildId,
        id: abortId,
        userId: 'owner',
        isAdmin: false,
      });
      assert.equal(aborted.status, 'ok');
      assert.equal(await getValorantWerewolfRevealed(prisma, guildId, abortId), null);
      const abortedState = await getValorantWerewolfState(prisma, guildId, abortId);
      assert.equal(abortedState?.game?.phase, 'ABORTED');
      assert.equal(JSON.stringify(abortedState?.game).includes(SECRET_TROLL.text), false);
    } finally {
      await prisma.valorantPickSession.deleteMany({ where: { guildId } });
      await prisma.guild.deleteMany({ where: { id: guildId } });
      await prisma.$disconnect();
    }
  },
);

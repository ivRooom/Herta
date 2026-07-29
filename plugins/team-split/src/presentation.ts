import { createTeamSplitComponentId } from './component-id.js';
import type { TeamSplitParticipantRecord, TeamSplitSessionRecord } from './service.js';
import type { TeamSplitTeam } from './split.js';

export interface TeamSplitDiscordMessagePayload {
  embeds: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  allowed_mentions: { parse: string[] };
}

export interface TeamSplitInteractionMessagePayload {
  embeds: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: string[] };
}

export function buildTeamSplitDiscordMessage(
  session: TeamSplitSessionRecord,
  participants: TeamSplitParticipantRecord[],
  secret: string,
): TeamSplitDiscordMessagePayload {
  const base = buildMessage(session, participants, secret);
  return { ...base, allowed_mentions: { parse: [] } };
}

export function buildTeamSplitInteractionMessage(
  session: TeamSplitSessionRecord,
  participants: TeamSplitParticipantRecord[],
  secret: string,
): TeamSplitInteractionMessagePayload {
  const base = buildMessage(session, participants, secret);
  return { ...base, allowedMentions: { parse: [] } };
}

export function formatTeamSplitSessionText(
  session: TeamSplitSessionRecord,
  participants: TeamSplitParticipantRecord[],
): string {
  const lines = [
    `**${escapeMarkdown(session.title)}**`,
    `状態: ${session.status}`,
    `方式: ${session.mode}`,
    `参加人数: ${session.participantCount}/${session.maxParticipants}`,
    `チーム数: ${session.teamCount}`,
    `受付期限: ${discordTimestamp(session.expiresAt)}`,
    `世代: ${session.generation}`,
    `参加者: ${participants.length ? participants.map((item) => `<@${item.userId}>`).join(' ') : 'なし'}`,
    `ID: \`${session.id}\``,
  ];
  const teams = readTeams(session.teams);
  if (teams.length > 0) {
    lines.push('', ...teams.map(formatTeamLine));
  }
  return lines.join('\n');
}

function buildMessage(
  session: TeamSplitSessionRecord,
  participants: TeamSplitParticipantRecord[],
  secret: string,
): { embeds: Array<Record<string, unknown>>; components: Array<Record<string, unknown>> } {
  const active = session.status === 'open';
  const teams = readTeams(session.teams);
  const participantText = participants.length
    ? participants
        .slice(0, 50)
        .map((participant) =>
          session.mode === 'balanced'
            ? `<@${participant.userId}> (${participant.score})`
            : `<@${participant.userId}>`,
        )
        .join('\n')
    : '参加者なし';

  const fields: Array<Record<string, unknown>> = [
    { name: '状態', value: session.status, inline: true },
    { name: '方式', value: session.mode, inline: true },
    {
      name: '参加人数',
      value: `${session.participantCount} / ${session.maxParticipants}`,
      inline: true,
    },
    { name: 'チーム数', value: String(session.teamCount), inline: true },
    { name: '受付期限', value: discordTimestamp(session.expiresAt), inline: true },
    { name: '世代', value: String(session.generation), inline: true },
    { name: '参加者', value: participantText.slice(0, 1024) },
  ];
  for (const team of teams.slice(0, 10)) {
    fields.push({
      name: `Team ${team.teamNumber}${session.mode === 'balanced' ? ` / 合計 ${team.totalScore}` : ''}`,
      value: team.members.length
        ? team.members.map((member) => `<@${member.userId}>`).join('\n').slice(0, 1024)
        : 'なし',
      inline: session.teamCount <= 3,
    });
  }

  return {
    embeds: [
      {
        title: session.title,
        description:
          session.status === 'open'
            ? '下のボタンから参加・辞退できます。balanced方式は未指定scoreを中立値0として扱います。'
            : 'チーム結果は下記のとおりです。',
        fields,
        footer: { text: `Team Split ID: ${session.id} / v${session.version}` },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: session.participantCount >= session.maxParticipants ? '満員' : '参加',
            custom_id: createTeamSplitComponentId('join', session.id, session.expiresAt, secret),
            disabled: !active || session.participantCount >= session.maxParticipants,
          },
          {
            type: 2,
            style: 2,
            label: '辞退',
            custom_id: createTeamSplitComponentId('leave', session.id, session.expiresAt, secret),
            disabled: !active,
          },
        ],
      },
    ],
  };
}

function readTeams(value: unknown): TeamSplitTeam[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isTeamSplitTeam);
}

function isTeamSplitTeam(value: unknown): value is TeamSplitTeam {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value['teamNumber']) || !Array.isArray(value['members'])) return false;
  if (typeof value['totalScore'] !== 'number') return false;
  return value['members'].every(
    (member) => isRecord(member) && typeof member['userId'] === 'string' && typeof member['score'] === 'number',
  );
}

function formatTeamLine(team: TeamSplitTeam): string {
  const members = team.members.map((member) => `<@${member.userId}>`).join(' ') || 'なし';
  return `Team ${team.teamNumber}: ${members}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function discordTimestamp(value: Date): string {
  return `<t:${Math.floor(value.getTime() / 1000)}:F>`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}

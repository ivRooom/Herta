import { buildStudioCommandItems, type StudioCommandItem } from './studio-navigation.ts';

export type StudioCurrentServerToolGroupId = 'community' | 'moderation';

export interface StudioCurrentServerToolGroup {
  id: StudioCurrentServerToolGroupId;
  label: string;
  items: StudioCommandItem[];
}

const GROUP_CONFIG = [
  {
    id: 'community',
    label: 'Community Tools',
    excludedIds: new Set(['guild-leaderboard']),
  },
  {
    id: 'moderation',
    label: 'Moderation Tools',
    excludedIds: new Set(['guild-moderation']),
  },
] as const satisfies readonly {
  id: StudioCurrentServerToolGroupId;
  label: string;
  excludedIds: ReadonlySet<string>;
}[];

export function buildStudioCurrentServerToolGroups(
  guildId: string | null,
  guildName: string | null,
): StudioCurrentServerToolGroup[] {
  const commands = buildStudioCommandItems(guildId, guildName);

  return GROUP_CONFIG.map((group) => ({
    id: group.id,
    label: group.label,
    items: commands.filter(
      (command) => command.group === group.id && !group.excludedIds.has(command.id),
    ),
  })).filter((group) => group.items.length > 0);
}

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Guild,
  InteractionReplyOptions,
} from 'discord.js';

type MiniGameInteraction = ChatInputCommandInteraction | ButtonInteraction;

export interface MiniGameCompletionEvent {
  guildId: string;
  userId: string;
  guild: Guild | null;
  reply(options: unknown): Promise<unknown>;
}

type MiniGameCompletionHandler = (event: MiniGameCompletionEvent) => Promise<void>;

const subscribers = new Map<string, MiniGameCompletionHandler>();

export function subscribeMiniGameCompletion(
  subscriberId: string,
  handler: MiniGameCompletionHandler,
): void {
  subscribers.set(subscriberId, handler);
}

export function unsubscribeMiniGameCompletion(subscriberId: string): void {
  subscribers.delete(subscriberId);
}

export async function publishMiniGameCompletion(interaction: MiniGameInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const event: MiniGameCompletionEvent = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    guild: interaction.guild,
    reply: (options) => interaction.followUp(options as InteractionReplyOptions),
  };
  await Promise.allSettled([...subscribers.values()].map((handler) => handler(event)));
}

export function miniGameCompletionSubscriberCount(): number {
  return subscribers.size;
}

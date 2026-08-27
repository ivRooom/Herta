import type { AiArtifact } from '@herta/plugin-catalog/ai-artifact';

export interface DiscordArtifactReplyOptions {
  content: string;
  files: Array<{ attachment: Buffer; name: string }>;
  allowedMentions: { parse: [] };
}

export interface DiscordArtifactReplyTarget {
  reply(options: DiscordArtifactReplyOptions): Promise<unknown>;
}

export async function deliverDiscordArtifacts(
  target: DiscordArtifactReplyTarget,
  artifacts: readonly AiArtifact[],
): Promise<void> {
  if (artifacts.length < 1) throw new Error('Validated artifacts are required for delivery');
  const filenames = artifacts.map((artifact) => artifact.filename);
  const content = buildArtifactDeliverySummary(filenames);
  await target.reply({
    content,
    files: artifacts.map((artifact) => ({
      attachment: Buffer.from(artifact.bytes),
      name: artifact.filename,
    })),
    allowedMentions: { parse: [] },
  });
}

export function buildArtifactDeliverySummary(filenames: readonly string[]): string {
  if (filenames.length < 1) throw new Error('Artifact filenames are required');
  const formatted = filenames.map((filename) => `\`${filename}\``).join('、');
  return `作成しました。${formatted} を添付します。`;
}

import type { ReactNode } from 'react';
import { StudioPagePermissionBoundary } from '@/components/studio-page-permission-boundary';

export default async function ModerationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  return (
    <StudioPagePermissionBoundary guildId={guildId} pageId="moderation">
      {children}
    </StudioPagePermissionBoundary>
  );
}

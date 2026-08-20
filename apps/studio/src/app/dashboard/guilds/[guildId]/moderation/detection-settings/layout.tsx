import type { ReactNode } from 'react';
import { StudioPagePermissionBoundary } from '@/components/studio-page-permission-boundary';

export default async function ModerationDetectionSettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  return (
    <StudioPagePermissionBoundary guildId={guildId} pageId="moderation-detection-settings">
      {children}
    </StudioPagePermissionBoundary>
  );
}

import { Settings2 } from 'lucide-react';
import { StudioNavigationSettings } from '@/components/studio-navigation-settings';

export default function StudioSettingsPage() {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        Settings
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Studio設定</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Server Switcherを中心に、Current
        Serverへ常時表示する個別Pluginタブをサーバー単位で調整します。
      </p>

      <div className="mt-8">
        <StudioNavigationSettings />
      </div>
    </div>
  );
}

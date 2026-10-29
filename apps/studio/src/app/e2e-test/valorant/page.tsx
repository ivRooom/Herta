import { notFound } from 'next/navigation';
import { ValorantConfigForm } from '@/components/valorant-config-form';

export const dynamic = 'force-dynamic';
export default function ValorantE2EPage() {
  if (process.env.NODE_ENV === 'production' || process.env.HERTA_STUDIO_E2E !== '1') notFound();
  return (
    <main className="mx-auto max-w-4xl p-4">
      <ValorantConfigForm
        guildId="123456789012345678"
        initialEnabled
        initialConfig={{ enabled: true }}
      />
    </main>
  );
}

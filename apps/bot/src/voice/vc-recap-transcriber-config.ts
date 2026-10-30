/**
 * AWS streaming remains the production default until an updated recording/data
 * processor consent notice has been published and participants opt in.
 */
export type VcRecapTranscriptionProvider = 'aws' | 'whisper-1' | 'gpt-transcribe';

export interface VcRecapTranscriberConfig {
  provider: VcRecapTranscriptionProvider;
  openAiAudioEnabled: boolean;
  maxSessionAudioSeconds: number;
}

export function resolveVcRecapTranscriberConfig(
  env: Record<string, string | undefined> = process.env,
): VcRecapTranscriberConfig {
  const raw = env['VC_RECAP_TRANSCRIPTION_PROVIDER']?.trim().toLowerCase();
  const provider: VcRecapTranscriptionProvider =
    raw === 'whisper-1' || raw === 'gpt-transcribe' ? raw : 'aws';

  // The operator flag only prepares the runtime for the new provider.
  // It does not replace individual consent and the publicly disclosed processor.
  const openAiAudioEnabled =
    env['VC_RECAP_OPENAI_AUDIO_CONSENT_READY'] === 'true' && env['HERTA_AI_KILL_SWITCH'] !== 'true';
  // Never let a new provider run without a bounded per-session audio quota.
  const rawMinutes = Number(env['VC_RECAP_OPENAI_SESSION_MAX_AUDIO_MINUTES'] ?? '120');
  const minutes =
    Number.isFinite(rawMinutes) && rawMinutes >= 1 && rawMinutes <= 240 ? rawMinutes : 120;
  return { provider, openAiAudioEnabled, maxSessionAudioSeconds: minutes * 60 };
}

export function canUseOpenAiVcAudio(
  config: VcRecapTranscriberConfig,
  explicitParticipantAudioConsent: boolean,
): boolean {
  return config.provider !== 'aws' && config.openAiAudioEnabled && explicitParticipantAudioConsent;
}

export {
  evaluateMessageActivity,
  hasMessageCooldownElapsed,
  normalizeActivityRulesConfig,
  shouldCountGamePresence,
  shouldCountMessage,
  shouldCountOnlinePresence,
  shouldCountVoice,
} from '@herta/shared/activity-rules';
export type {
  ActivityRulesConfig,
  MessageActivityBlockingReason,
  MessageActivityCandidate,
  MessageActivityEvaluation,
  MessageActivityNotice,
  PresenceActivityCandidate,
  VoiceActivityCandidate,
} from '@herta/shared/activity-rules';

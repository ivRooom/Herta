export {
  communityPointsRatesFromConfig,
  evaluateMessageActivity,
  hasMessageCooldownElapsed,
  normalizeActivityRulesConfig,
  shouldCountCommandPoints,
  shouldCountGamePresence,
  shouldCountMessage,
  shouldCountOnlinePresence,
  shouldCountVoice,
} from '@herta/shared/activity-rules';
export type {
  ActivityRulesConfig,
  CommunityPointsRates,
  MessageActivityBlockingReason,
  MessageActivityCandidate,
  MessageActivityEvaluation,
  MessageActivityNotice,
  PresenceActivityCandidate,
  VoiceActivityCandidate,
} from '@herta/shared/activity-rules';

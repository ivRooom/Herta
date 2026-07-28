export {
  DEFAULT_AUTO_RESPONSE_CONFIG,
  AutoResponseValidationError,
  assertSafeRegex,
  matchesAutoResponse,
  normalizeAutoResponseConfig,
  normalizeAutoResponseRuleInput,
  parseAutoResponseEmbed,
} from './config.js';
export type {
  AutoResponseConfig,
  AutoResponseEmbed,
  AutoResponseMatchMode,
  AutoResponseResponseType,
  AutoResponseRuleInput,
  NormalizedAutoResponseRuleInput,
} from './config.js';
export { autoResponseManifest } from './manifest.js';
export { autoResponsePlugin } from './plugin.js';
export { autoResponsePlugin as default } from './plugin.js';
export * from './service.js';

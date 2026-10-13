import type { AiRuntimeSelectionOverride } from '@herta/plugin-catalog/ai-runtime-policy';
import type { AiRuntimeGenerationService } from './runtime-service.js';

/**
 * Wraps a generation service so every `generate()` call carries the given per-user
 * provider/modelProfile override (from `/ai model set`). Mirrors the composition pattern used by
 * withAiDirectReplyContext/withAiJmaWeatherGroundingContext in this same directory.
 */
export function withAiRuntimeOverrideContext(
  service: AiRuntimeGenerationService,
  override: AiRuntimeSelectionOverride | null,
): AiRuntimeGenerationService {
  if (!override) return service;

  const overriddenService: AiRuntimeGenerationService = {
    generate: (request) => service.generate({ ...request, runtimeOverride: override }),
  };
  if (service.consumeRateLimit) {
    overriddenService.consumeRateLimit = (request) => service.consumeRateLimit!(request);
  }
  return overriddenService;
}

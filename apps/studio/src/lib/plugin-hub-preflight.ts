export type PluginPreflightDependency = {
  pluginId: string;
  optional: boolean;
  installed: boolean;
  enabled: boolean;
};

export type PluginPreflightAnalysis = {
  ready: boolean;
  missingRequiredPluginIds: string[];
  inactiveOptionalPluginIds: string[];
};

export function analyzePluginPreflight(
  dependencies: readonly PluginPreflightDependency[],
): PluginPreflightAnalysis {
  const missingRequiredPluginIds = dependencies
    .filter((dependency) => !dependency.optional && !dependency.enabled)
    .map((dependency) => dependency.pluginId);
  const inactiveOptionalPluginIds = dependencies
    .filter((dependency) => dependency.optional && !dependency.enabled)
    .map((dependency) => dependency.pluginId);

  return {
    ready: missingRequiredPluginIds.length === 0,
    missingRequiredPluginIds,
    inactiveOptionalPluginIds,
  };
}

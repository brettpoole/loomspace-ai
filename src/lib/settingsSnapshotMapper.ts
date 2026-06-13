import type { SaveServerSettingsPayload, ServerSettingsPayload } from './api';
import { sanitizeGenerationParams } from './store';
import type { AISettings } from './types';

export class SettingsSnapshotMapper {
  hydrate(payload: ServerSettingsPayload): AISettings {
    const providerConfigs = payload.providerConfigs.map((config) => ({
      id: config.id,
      kind: config.kind,
      label: config.label,
      model: config.model,
      apiKey: '',
      hasEncryptedApiKey: config.hasKey,
      baseUrl: config.baseUrl,
      params: sanitizeGenerationParams(config.params),
    }));

    const activeProviderConfigId = payload.activeProviderConfigId;
    const activeExists = providerConfigs.some((config) => config.id === activeProviderConfigId);
    if (providerConfigs.length > 0 && !activeExists) {
      throw new Error(`Invalid activeProviderConfigId "${activeProviderConfigId}" in server settings payload.`);
    }

    return {
      activeProviderConfigId: activeExists ? activeProviderConfigId : '',
      providerConfigs,
    };
  }

  serialize(settings: AISettings): SaveServerSettingsPayload {
    return {
      activeProviderConfigId: settings.activeProviderConfigId,
      providerConfigs: settings.providerConfigs.map((config) => ({
        id: config.id,
        kind: config.kind,
        label: config.label,
        model: config.model,
        ...(config.baseUrl?.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
        ...(config.params ? { params: config.params } : {}),
      })),
    };
  }
}

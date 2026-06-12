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

    return {
      activeProviderConfigId: providerConfigs.some((config) => config.id === payload.activeProviderConfigId)
        ? payload.activeProviderConfigId
        : providerConfigs[0]?.id ?? '',
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

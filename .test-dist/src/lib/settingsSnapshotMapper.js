"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsSnapshotMapper = void 0;
const store_1 = require("./store");
class SettingsSnapshotMapper {
    hydrate(payload) {
        const providerConfigs = payload.providerConfigs.map((config) => ({
            id: config.id,
            kind: config.kind,
            label: config.label,
            model: config.model,
            apiKey: '',
            hasEncryptedApiKey: config.hasKey,
            baseUrl: config.baseUrl,
            params: (0, store_1.sanitizeGenerationParams)(config.params),
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
    serialize(settings) {
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
exports.SettingsSnapshotMapper = SettingsSnapshotMapper;

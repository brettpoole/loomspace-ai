"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const settingsSnapshotMapper_1 = require("../src/lib/settingsSnapshotMapper");
const api_1 = require("../src/lib/api");
{
    const mapper = new settingsSnapshotMapper_1.SettingsSnapshotMapper();
    strict_1.default.throws(() => mapper.hydrate({
        activeProviderConfigId: 'missing',
        providerConfigs: [
            {
                id: 'provider-a',
                kind: 'openai',
                label: 'OpenAI',
                model: 'gpt-4o-mini',
                hasKey: false,
            },
        ],
    }), /Invalid activeProviderConfigId/);
}
{
    const merged = (0, api_1.mergeSettingsServerFirst)({
        activeProviderConfigId: 'provider-new',
        providerConfigs: [
            {
                id: 'provider-new',
                kind: 'openai',
                label: 'My OpenAI Profile',
                model: 'gpt-4o',
                baseUrl: 'https://api.openai.com/v1',
                params: { temperature: 0.2 },
            },
        ],
    }, {
        activeProviderConfigId: 'provider-new',
        providerConfigs: [
            {
                id: 'provider-new',
                kind: 'openai',
                label: 'OpenAI',
                model: '',
                baseUrl: 'https://api.openai.com/v1',
                hasKey: false,
            },
        ],
    });
    strict_1.default.equal(merged.activeProviderConfigId, 'provider-new');
    strict_1.default.deepEqual(merged.providerConfigs, [
        {
            id: 'provider-new',
            kind: 'openai',
            label: 'My OpenAI Profile',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
            params: { temperature: 0.2 },
        },
    ]);
}
{
    const merged = (0, api_1.mergeSettingsServerFirst)({
        activeProviderConfigId: 'provider-local',
        providerConfigs: [
            {
                id: 'provider-local',
                kind: 'openai',
                label: 'Local',
                model: 'gpt-4o-mini',
            },
        ],
    }, {
        activeProviderConfigId: 'provider-remote',
        providerConfigs: [
            {
                id: 'provider-remote',
                kind: 'anthropic',
                label: 'Remote',
                model: 'claude-3-5-sonnet-latest',
                hasKey: true,
            },
        ],
    });
    strict_1.default.equal(merged.activeProviderConfigId, 'provider-local');
    strict_1.default.deepEqual(merged.providerConfigs, [
        {
            id: 'provider-remote',
            kind: 'anthropic',
            label: 'Remote',
            model: 'claude-3-5-sonnet-latest',
        },
        {
            id: 'provider-local',
            kind: 'openai',
            label: 'Local',
            model: 'gpt-4o-mini',
        },
    ]);
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const store_1 = require("../src/lib/store");
const settingsSnapshotMapper_1 = require("../src/lib/settingsSnapshotMapper");
function withCookie(cookie, fn) {
    const originalDocument = Reflect.get(globalThis, 'document');
    const originalLocalStorage = Reflect.get(globalThis, 'localStorage');
    const localStore = new Map();
    Object.defineProperty(globalThis, 'document', {
        value: { cookie },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key) => localStore.get(key) ?? null,
            setItem: (key, value) => {
                localStore.set(key, value);
            },
            removeItem: (key) => {
                localStore.delete(key);
            },
            clear: () => {
                localStore.clear();
            },
            key: (index) => Array.from(localStore.keys())[index] ?? null,
            get length() {
                return localStore.size;
            },
        },
        configurable: true,
        writable: true,
    });
    try {
        fn();
    }
    finally {
        if (originalDocument === undefined) {
            delete globalThis.document;
        }
        else {
            Object.defineProperty(globalThis, 'document', {
                value: originalDocument,
                configurable: true,
                writable: true,
            });
        }
        if (originalLocalStorage === undefined) {
            delete globalThis.localStorage;
        }
        else {
            Object.defineProperty(globalThis, 'localStorage', {
                value: originalLocalStorage,
                configurable: true,
                writable: true,
            });
        }
    }
}
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
withCookie(`loomspace.settings.v4=${encodeURIComponent(JSON.stringify({
    activeProviderConfigId: 'missing',
    providerConfigs: [
        {
            id: 'provider-a',
            kind: 'openai',
            label: 'OpenAI',
            model: 'gpt-4o-mini',
            hasEncryptedApiKey: false,
        },
    ],
}))}`, () => {
    strict_1.default.throws(() => (0, store_1.loadSettings)(), /Invalid activeProviderConfigId/);
});
withCookie(`loomspace.settings.v4=${encodeURIComponent(JSON.stringify({
    activeProviderConfigId: 'provider-a',
    providerConfigs: [
        {
            id: 'provider-a',
            kind: 'openai',
            label: 'OpenAI',
            model: 'gpt-4o-mini',
            hasEncryptedApiKey: false,
        },
    ],
}))}`, () => {
    const settings = (0, store_1.loadSettings)();
    strict_1.default.equal(settings.activeProviderConfigId, 'provider-a');
    strict_1.default.equal(settings.providerConfigs.length, 1);
});

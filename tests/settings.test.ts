import assert from 'node:assert/strict';
import { loadSettings } from '../src/lib/store';
import { SettingsSnapshotMapper } from '../src/lib/settingsSnapshotMapper';

function withCookie(cookie: string, fn: () => void) {
  const originalDocument = Reflect.get(globalThis, 'document');
  const originalLocalStorage = Reflect.get(globalThis, 'localStorage');
  const localStore = new Map<string, string>();

  Object.defineProperty(globalThis, 'document', {
    value: { cookie },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStore.set(key, value);
      },
    removeItem: (key: string) => {
      localStore.delete(key);
    },
    clear: () => {
      localStore.clear();
    },
    key: (index: number) => Array.from(localStore.keys())[index] ?? null,
    get length() {
      return localStore.size;
    },
    } as Storage,
    configurable: true,
    writable: true,
  });

  try {
    fn();
  } finally {
    if (originalDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        value: originalDocument,
        configurable: true,
        writable: true,
      });
    }

    if (originalLocalStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  }
}

{
  const mapper = new SettingsSnapshotMapper();
  assert.throws(
    () =>
      mapper.hydrate({
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
      }),
    /Invalid activeProviderConfigId/,
  );
}

withCookie(
  `loomspace.settings.v4=${encodeURIComponent(JSON.stringify({
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
  }))}`,
  () => {
    assert.throws(() => loadSettings(), /Invalid activeProviderConfigId/);
  },
);

withCookie(
  `loomspace.settings.v4=${encodeURIComponent(JSON.stringify({
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
  }))}`,
  () => {
    const settings = loadSettings();
    assert.equal(settings.activeProviderConfigId, 'provider-a');
    assert.equal(settings.providerConfigs.length, 1);
  },
);

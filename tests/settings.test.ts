import assert from 'node:assert/strict';
import { SettingsSnapshotMapper } from '../src/lib/settingsSnapshotMapper';
import { mergeSettingsServerFirst } from '../src/lib/api';

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

{
  const merged = mergeSettingsServerFirst(
    {
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
    },
    {
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
    },
  );

  assert.equal(merged.activeProviderConfigId, 'provider-new');
  assert.deepEqual(merged.providerConfigs, [
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
  const merged = mergeSettingsServerFirst(
    {
      activeProviderConfigId: 'provider-local',
      providerConfigs: [
        {
          id: 'provider-local',
          kind: 'openai',
          label: 'Local',
          model: 'gpt-4o-mini',
        },
      ],
    },
    {
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
    },
  );

  assert.equal(merged.activeProviderConfigId, 'provider-local');
  assert.deepEqual(merged.providerConfigs, [
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { classifyModels } = await vite.ssrLoadModule('/src/utils/models.ts');
test.after(() => vite.close());

const namesIn = (groups, id) => groups.find((group) => group.id === id)?.items.map((item) => item.name) ?? [];

test('places Xiaomi MiMo models in their own family instead of Other', () => {
  const groups = classifyModels([
    { name: 'mimo-v2.6-pro' },
    { name: 'mimo-v2.6-flash' },
    { name: 'xiaomi/mimo-v2.5-pro' },
    { name: 'XiaomiMiMo/MiMo-7B-RL' },
    { name: 'custom-xiaomi', alias: '小米旗舰' },
    { name: 'gpt-5' }
  ]);

  assert.deepEqual(namesIn(groups, 'xiaomi'), [
    'mimo-v2.6-pro',
    'mimo-v2.6-flash',
    'xiaomi/mimo-v2.5-pro',
    'XiaomiMiMo/MiMo-7B-RL',
    'custom-xiaomi'
  ]);
  assert.deepEqual(namesIn(groups, 'gpt'), ['gpt-5']);
  assert.equal(groups.find((group) => group.id === 'other'), undefined);
});

test('places StepFun models in their own family instead of Other', () => {
  const groups = classifyModels([
    { name: 'step-5-preview' },
    { name: 'step-3.7-flash' },
    { name: 'step-3.5-flash-2603' },
    { name: 'step-1o-turbo-vision' },
    { name: 'step-2-mini' },
    { name: 'stepfun/step-r1-v-mini' },
    { name: 'StepAudio-2.5-Chat' },
    { name: 'step-router-v1' },
    { name: 'custom-step', alias: '阶跃星辰' }
  ]);

  assert.deepEqual(namesIn(groups, 'stepfun'), [
    'step-5-preview',
    'step-3.7-flash',
    'step-3.5-flash-2603',
    'step-1o-turbo-vision',
    'step-2-mini',
    'stepfun/step-r1-v-mini',
    'StepAudio-2.5-Chat',
    'step-router-v1',
    'custom-step'
  ]);
  assert.equal(groups.find((group) => group.id === 'other'), undefined);
});

test('classifies Codex subscription models such as codex-auto-review as GPT', () => {
  const groups = classifyModels([
    { name: 'codex-auto-review' },
    { name: 'codex-mini-latest' },
    { name: 'gpt-5-codex' },
    { name: 'unknown-local-model' }
  ]);

  assert.deepEqual(namesIn(groups, 'gpt'), ['codex-auto-review', 'codex-mini-latest', 'gpt-5-codex']);
  assert.deepEqual(namesIn(groups, 'other'), ['unknown-local-model']);
});

test('keeps existing families working alongside the new matches', () => {
  const groups = classifyModels(
    [
      { name: 'devin/mimo-v2.6-pro' },
      { name: 'devin/step-3.7-flash' },
      { name: 'devin/codex-auto-review' },
      { name: 'muse-spark-1.3' },
      { name: 'minimax-m2' },
      { name: 'abab6.5s' }
    ],
    { otherLabel: '其他' }
  );

  // LTS keeps its own classification semantics: namespace prefixes are not
  // routed separately, so the new family patterns match on the full name.
  assert.deepEqual(namesIn(groups, 'xiaomi'), ['devin/mimo-v2.6-pro']);
  assert.deepEqual(namesIn(groups, 'stepfun'), ['devin/step-3.7-flash']);
  assert.deepEqual(namesIn(groups, 'gpt'), ['devin/codex-auto-review']);
  assert.deepEqual(namesIn(groups, 'other'), ['muse-spark-1.3']);
  assert.deepEqual(namesIn(groups, 'minimax'), ['minimax-m2', 'abab6.5s']);
});

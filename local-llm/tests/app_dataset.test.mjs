import test from 'node:test';
import assert from 'node:assert/strict';
import { appContract, trainingExample } from '../scripts/app_dataset.mjs';

const contract = await appContract();
function row(text, quote) {
  return { id: 'synthetic', input: { resume: text, targetPosting: '' }, expected: {
    summary: 'SQL 실습을 기재했다.', skills: [{ skillId: 'sql', level: 'learning', quote }], requirements: [], questions: [],
  } };
}

test('export uses actual app boundaries with emoji, blank lines and long source', () => {
  const text = '가'.repeat(238) + '😀' + '\n\nSQL 실습';
  const sample = trainingExample(row(text, 'SQL 실습'), contract);
  const input = JSON.parse(sample.messages[1].content);
  const expected = JSON.parse(sample.messages[2].content);
  assert.equal(sample.messages[0].content, contract.LOCAL_SYSTEM);
  assert.deepEqual(input.resume, contract.sourceLines(text).map(({ id, text }) => ({ id, text })));
  assert.deepEqual(expected.skills[0], { skillId: 'sql', level: 'learning', startLine: 2, endLine: 2 });
  const restored = contract.resolveLocalEvidence({ ...expected, requirements: [] }, { resumeText: text, targetPosting: '' });
  assert.equal(restored.skills[0].quote, 'SQL 실습');
});

test('ambiguous repeated evidence is rejected instead of assigning an arbitrary line', () => {
  assert.throws(() => trainingExample(row('SQL 실습\nSQL 실습', 'SQL 실습'), contract), /ambiguous/);
});

test('job requirements cannot contaminate the resume training task', () => {
  const fixture = row('SQL 실습', 'SQL 실습');
  fixture.input.targetPosting = 'SQL 필수';
  assert.throws(() => trainingExample(fixture, contract), /resume extraction only/);
});

test('a label erased by the app after line restoration cannot enter training silently', () => {
  assert.throws(() => trainingExample(row('SQL 실습을 할 예정입니다.', 'SQL 실습'), contract), /app filters/);
});

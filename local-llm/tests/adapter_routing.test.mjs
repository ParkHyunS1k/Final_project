import test from 'node:test';
import assert from 'node:assert/strict';
import { appContract } from '../scripts/app_dataset.mjs';

const contract = await appContract();

test('trained adapter applies only to resume and its name persists in provenance', async () => {
  const keys = ['CAREERFLOW_LOCAL_MODEL', 'CAREERFLOW_LOCAL_ADAPTER', 'CAREERFLOW_LOCAL_URL', 'CAREERFLOW_AI_PROVIDER'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.CAREERFLOW_LOCAL_MODEL = 'models/synthetic-base';
  process.env.CAREERFLOW_LOCAL_ADAPTER = '/private/test/adapters/synthetic-pilot';
  process.env.CAREERFLOW_LOCAL_URL = 'http://127.0.0.1:8089';
  process.env.CAREERFLOW_AI_PROVIDER = 'local';
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      assert.equal(url, 'http://127.0.0.1:8089/v1/chat/completions');
      assert.equal(body.model, 'models/synthetic-base');
      const resume = 'resume' in JSON.parse(body.messages[1].content);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(resume
        ? { summary: 'SQL 실습', skills: [{ skillId: 'sql', level: 'learning', startLine: 1, endLine: 1 }], questions: [] }
        : { requirements: [{ skillId: 'sql', importance: 'required', startLine: 1, endLine: 1 }] }) } }] });
    };
    const result = await contract.analyzeLocally({ resumeText: 'SQL 쿼리 실습을 진행했습니다.', targetPosting: 'SQL 필수' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].adapters, process.env.CAREERFLOW_LOCAL_ADAPTER);
    assert.equal(calls[1].adapters, undefined);
    assert.equal(result.engine.model, 'synthetic-base + synthetic-pilot');
    assert.equal(contract.careerAiInfo().model, result.engine.model);
    assert.equal(result.requirements[0].skillId, 'sql');
    process.env.CAREERFLOW_LOCAL_MODEL = 'default_model';
    await assert.rejects(() => contract.analyzeLocally({ resumeText: 'SQL 실습', targetPosting: '' }), /실제 로컬 모델 경로/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

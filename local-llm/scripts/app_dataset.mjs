// Use the app's exact prompt and UTF-16 line boundaries, not a second implementation.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.resolve(root, '../web');
const require = createRequire(path.join(web, 'package.json'));

export async function appContract() {
  const { build } = require('esbuild');
  const { outputFiles } = await build({
    stdin: { contents: `export { LOCAL_SYSTEM, LOCAL_POSTING_SYSTEM, analyzeLocally } from './lib/career/local-model';
      export { sourceLines, resolveLocalEvidence } from './lib/career/local-evidence';
      export { validateAnalysis } from './lib/career/profile';
      export { careerAiInfo } from './lib/career/model';
      export { SKILLS } from './lib/career/catalog';`, resolveDir: web, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
}

export function trainingExample(row, contract) {
  if (row.input.targetPosting || row.expected.requirements.length)
    throw new Error('This dataset trains resume extraction only');
  const lines = contract.sourceLines(row.input.resume);
  const skills = row.expected.skills.map(({ skillId, level, quote }) => {
    const start = row.input.resume.indexOf(quote);
    if (start < 0 || row.input.resume.indexOf(quote, start + 1) >= 0)
      throw new Error(`${row.id}: missing or ambiguous quote`);
    const matching = lines.filter((line) => line.end > start && line.start < start + quote.length);
    if (!matching.length || matching.at(-1).end - matching[0].start > 1200)
      throw new Error(`${row.id}: invalid evidence range`);
    return { skillId, level, startLine: matching[0].id, endLine: matching.at(-1).id };
  });
  const answer = { summary: row.expected.summary, skills, questions: row.expected.questions };
  if (answer.summary.length > 150 || skills.length > 8)
    throw new Error(`${row.id}: output exceeds app prompt limits`);
  const input = { resumeText: row.input.resume, targetPosting: '' };
  const accepted = contract.validateAnalysis(
    contract.resolveLocalEvidence({ ...answer, requirements: [] }, input), input,
  );
  if (accepted.skills.length !== skills.length)
    throw new Error(`${row.id}: app filters a reviewed label after restoring its source range`);
  return { messages: [
    { role: 'system', content: contract.LOCAL_SYSTEM },
    { role: 'user', content: JSON.stringify({ resume: lines.map(({ id, text }) => ({ id, text })), vocabulary: contract.SKILLS.map(({ id, name }) => ({ id, name })) }) },
    { role: 'assistant', content: JSON.stringify(answer) },
  ] };
}

export async function exportDataset(input, audit, output) {
  const checked = spawnSync('python3', [path.join(root, 'scripts/dataset_tool.py'), 'check', input, '--audit', audit, '--require-reviewed'], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(checked.stderr || checked.stdout);
  const bytes = await readFile(input);
  const rows = bytes.toString().trim().split('\n').map((line) => JSON.parse(line));
  const contract = await appContract();
  const files = {};
  for (const split of ['train', 'valid', 'test'])
    files[`${split}.jsonl`] = rows.filter((row) => row.split === split).map((row) => JSON.stringify(trainingExample(row, contract))).join('\n') + '\n';
  const sha = (data) => createHash('sha256').update(data).digest('hex');
  files['manifest.json'] = JSON.stringify({
    schema: 'app-resume-lines-v1', annotation_sha256: sha(bytes),
    system_prompt_sha256: sha(contract.LOCAL_SYSTEM),
    files: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, sha(value)])),
    stats: JSON.parse(checked.stdout),
    examples: rows.map(({ id, source, leakage_group_id, split, review }) => ({ id, source, leakage_group_id, split, review })),
  }, null, 2) + '\n';
  const destination = path.resolve(output);
  const parent = await realpath(path.dirname(destination));
  const dataRoot = await realpath(path.join(root, 'data'));
  if (parent !== dataRoot && !parent.startsWith(dataRoot + path.sep)) throw new Error('Output must stay inside local-llm/data');
  process.umask(0o077);
  await mkdir(destination, { mode: 0o700 });
  for (const [name, contents] of Object.entries(files))
    await writeFile(path.join(destination, name), contents, { flag: 'wx', mode: 0o600 });
  return JSON.parse(checked.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, audit, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node scripts/app_dataset.mjs ANNOTATIONS AUDIT OUTPUT');
  console.log(JSON.stringify(await exportDataset(input, audit, output), null, 2));
}

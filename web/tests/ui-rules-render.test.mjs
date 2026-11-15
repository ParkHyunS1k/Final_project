// UI 공통 규칙(2026-11-15): 앱 화면의 페이지 머리는 한 모양(제목·한 줄 설명·오른쪽 버튼)이고,
// 영어 소제목(eyebrow)과 랜딩식 카피는 랜딩에만 둔다. 버튼은 기본(테두리)·primary(채움)·ghost(글자) 3종.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
async function load(entry) {
  const outfile = join(mkdtempSync(join(cache, 'pm-ui-')), 'out.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', alias: { '@': process.cwd() } });
  return import(pathToFileURL(outfile).href);
}
const { PageHeader } = await load('components/page-header.tsx');
const { TeamDirectory } = await load('components/team-directory.tsx');

test('페이지 머리: 제목 h1 하나, 한 줄 설명, 오른쪽 버튼 자리', () => {
  const html = renderToString(
    createElement(PageHeader, { title: '공고 찾기', description: '공고를 찾아 저장해요.', actions: createElement('button', { className: 'btn' }, '공고 저장하기') }),
  );
  assert.match(html, /^<header class="page-header">/);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /<h1>공고 찾기<\/h1><p>공고를 찾아 저장해요.<\/p>/);
  assert.match(html, /class="page-header-actions"><button class="btn">공고 저장하기<\/button>/);
  assert.doesNotMatch(renderToString(createElement(PageHeader, { title: '팀 찾기' })), /page-header-actions|<p>/);
});

test('팀 찾기는 카드 안에 제목을 두지 않고 공통 페이지 머리를 쓴다', () => {
  const html = renderToString(createElement(TeamDirectory, {}));
  assert.match(html, /<header class="page-header"><div><h1>팀 찾기<\/h1>/);
  assert.doesNotMatch(html, /class="project-panel team-directory"/);
});

test('앱 화면에는 영어 소제목(eyebrow)이 없다', () => {
  for (const file of ['components/unified-app.tsx', 'components/career-workspace.tsx']) {
    const source = readFileSync(file, 'utf8');
    const eyebrows = [...source.matchAll(/className="(?:hub-)?eyebrow"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
    const english = eyebrows.filter((text) => /[A-Z]{3,}/.test(text));
    assert.deepEqual(english, [], `${file}에 영어 소제목이 남아 있다`);
  }
});

test('앱 셸에 슬로건 줄(로고 아래 문구·상단 바 문구·푸터 문구)이 없다', () => {
  const source = readFileSync('components/unified-app.tsx', 'utf8');
  for (const slogan of ['나의 다음 경험을 만드는 곳', '나의 성장 공간', '작게 시작하고, 경험으로 남기세요.'])
    assert.ok(!source.includes(slogan), slogan);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';

test('production CSS keeps legacy media-query syntax', async () => {
  const result = await build({ logLevel: 'warn', build: { write: false } });
  const cssFiles = (Array.isArray(result) ? result : [result])
    .flatMap(({ output }) => output)
    .filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'));
  const mediaQueries = cssFiles.flatMap(({ source }) => String(source).match(/@media\b[^{}]+/g) ?? []);
  const rangeQuery = mediaQueries.find((query) => /[<>=]/.test(query));

  assert.ok(!rangeQuery, `Found range syntax in production CSS: ${rangeQuery}`);
  assert.ok(mediaQueries.some((query) => /\(\s*min-width\s*:\s*1024px\s*\)/.test(query)),
    'Expected the desktop breakpoint in production CSS');
});

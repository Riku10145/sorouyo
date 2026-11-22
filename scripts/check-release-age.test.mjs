import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReleaseAge } from './check-release-age.mjs';

const now = Date.parse('2026-11-22T00:00:00Z');
const lock = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'root' },
    'node_modules/alias': { name: '@scope/example', version: '1.0.0', resolved: 'https://registry.npmjs.org/example.tgz' },
    'node_modules/parent/node_modules/example': { version: '2.0.0', resolved: 'https://registry.npmjs.org/example.tgz' },
  },
};
const response = (time) => async () => ({ ok: true, json: async () => ({ time }) });

test('checks aliases and nested dependencies, accepting the seven-day boundary', async () => {
  const urls = [];
  const result = await checkReleaseAge(lock, {
    now,
    fetchMetadata: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ time: { '1.0.0': '2026-11-15T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' } }) };
    },
  });
  assert.deepEqual(result, { checked: 2, failures: [] });
  assert.ok(urls.includes('https://registry.npmjs.org/%40scope%2Fexample'));
});

test('empty lockfile requires no requests', async () => {
  assert.deepEqual(await checkReleaseAge({ lockfileVersion: 3, packages: {} }), { checked: 0, failures: [] });
});

test('reports recent, future, missing and invalid publication times', async () => {
  for (const published of ['2026-11-21T00:00:00Z', '2026-11-23T00:00:00Z', undefined, 'invalid']) {
    const result = await checkReleaseAge(lock, { now, fetchMetadata: response({ '1.0.0': published, '2.0.0': published }) });
    assert.equal(result.failures.length, 2);
  }
});

test('fails closed for HTTP, network and JSON errors', async () => {
  for (const fetchMetadata of [
    async () => ({ ok: false, status: 503 }),
    async () => { throw new Error('network unavailable'); },
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
  ]) {
    const result = await checkReleaseAge(lock, { now, fetchMetadata });
    assert.equal(result.failures.length, 2);
    assert.match(result.failures[0], /could not verify/);
  }
});

test('rejects unsupported lockfiles and unverifiable sources', async () => {
  await assert.rejects(checkReleaseAge({}), /lockfileVersion/);
  await assert.rejects(checkReleaseAge({ lockfileVersion: 3, packages: { 'node_modules/local': { version: 'file:local' } } }), /Cannot verify/);
});

test('limits concurrent requests and deduplicates name/version pairs', async () => {
  const packages = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [
    `node_modules/package-${i}`, { version: '1.0.0', resolved: 'https://registry.npmjs.org/package.tgz' },
  ]));
  packages['node_modules/nested/node_modules/package-0'] = packages['node_modules/package-0'];
  let active = 0;
  let peak = 0;
  const result = await checkReleaseAge({ lockfileVersion: 3, packages }, {
    now,
    fetchMetadata: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return { ok: true, json: async () => ({ time: { '1.0.0': '2026-11-01T00:00:00Z' } }) };
    },
  });
  assert.equal(peak, 8);
  assert.deepEqual(result, { checked: 20, failures: [] });
});

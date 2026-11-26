import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReleaseAge } from './check-release-age.mjs';

const now = Date.parse('2026-11-22T00:00:00Z');
const integrity = 'sha512-test';
const metadata = (time, tarball = 'https://registry.npmjs.org/example.tgz') => ({
  time,
  versions: Object.fromEntries(Object.keys(time).map((version) => [version, {
    dist: { integrity, tarball },
  }])),
});
const lock = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'root' },
    'node_modules/alias': { name: '@scope/example', version: '1.0.0', integrity, resolved: 'https://registry.npmjs.org/example.tgz' },
    'node_modules/parent/node_modules/example': { version: '2.0.0', integrity, resolved: 'https://registry.npmjs.org/example.tgz' },
  },
};
const response = (time) => async () => ({ ok: true, json: async () => metadata(time) });

test('checks aliases and nested dependencies, accepting the seven-day boundary', async () => {
  const urls = [];
  const result = await checkReleaseAge(lock, {
    now,
    fetchMetadata: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => metadata({ '1.0.0': '2026-11-15T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }) };
    },
  });
  assert.deepEqual(result, { checked: 2, failures: [] });
  assert.ok(urls.includes('https://registry.npmjs.org/%40scope%2Fexample'));
});

test('empty lockfile requires no requests', async () => {
  assert.deepEqual(await checkReleaseAge({ lockfileVersion: 3, packages: {} }), { checked: 0, failures: [] });
});

test('skips bundled entries without resolved URLs, but still checks the parent', async () => {
  const bundledLock = {
    lockfileVersion: 3,
    packages: {
      'node_modules/parent': { version: '1.0.0', integrity, resolved: 'https://registry.npmjs.org/parent.tgz' },
      'node_modules/parent/node_modules/bundled': { version: '1.0.0', inBundle: true },
    },
  };
  const urls = [];
  const result = await checkReleaseAge(bundledLock, {
    now,
    fetchMetadata: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => metadata({ '1.0.0': '2026-11-01T00:00:00Z' }, 'https://registry.npmjs.org/parent.tgz') };
    },
  });
  assert.deepEqual(urls, ['https://registry.npmjs.org/parent']);
  assert.deepEqual(result, { checked: 1, failures: [] });
});

test('base filtering ignores existing versions regardless of install path', async () => {
  const baseLock = structuredClone(lock);
  baseLock.packages['node_modules/moved'] = baseLock.packages['node_modules/alias'];
  delete baseLock.packages['node_modules/alias'];
  delete baseLock.packages['node_modules/parent/node_modules/example'];
  const urls = [];
  const result = await checkReleaseAge(lock, {
    baseLock,
    now,
    fetchMetadata: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => metadata({ '2.0.0': '2026-11-21T00:00:00Z' }) };
    },
  });
  assert.equal(result.checked, 1);
  assert.deepEqual(urls, ['https://registry.npmjs.org/example']);
  assert.match(result.failures[0], /example@2.0.0/);
});

test('checks an existing version when its integrity changes', async () => {
  const tampered = structuredClone(lock);
  tampered.packages['node_modules/alias'].integrity = 'sha512-tampered';
  const result = await checkReleaseAge(tampered, {
    baseLock: lock,
    now,
    fetchMetadata: response({ '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }),
  });
  assert.equal(result.checked, 1);
  assert.ok(result.failures.some((failure) => /lockfile integrity does not match registry dist\.integrity/.test(failure)));
});

test('checks an existing version when its resolved URL changes', async () => {
  const tampered = structuredClone(lock);
  tampered.packages['node_modules/alias'].resolved = 'https://registry.npmjs.org/tampered.tgz';
  const result = await checkReleaseAge(tampered, {
    baseLock: lock,
    now,
    fetchMetadata: response({ '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }),
  });
  assert.equal(result.checked, 1);
  assert.ok(result.failures.some((failure) => /lockfile resolved does not match registry dist\.tarball/.test(failure)));
});

test('identical base skips all requests; empty base checks all versions', async () => {
  assert.deepEqual(await checkReleaseAge(lock, {
    baseLock: lock,
    fetchMetadata: async () => { throw new Error('unexpected request'); },
  }), { checked: 0, failures: [] });
  const result = await checkReleaseAge(lock, {
    baseLock: { lockfileVersion: 3, packages: {} }, now,
    fetchMetadata: response({ '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }),
  });
  assert.deepEqual(result, { checked: 2, failures: [] });
  await assert.rejects(checkReleaseAge(lock, { baseLock: {} }), /lockfileVersion/);
});

test('reports recent, future, missing and invalid publication times', async () => {
  for (const published of ['2026-11-21T00:00:00Z', '2026-11-23T00:00:00Z', undefined, 'invalid']) {
    const result = await checkReleaseAge(lock, { now, fetchMetadata: response({ '1.0.0': published, '2.0.0': published }) });
    assert.equal(result.failures.length, 2);
  }
});

test('rejects missing, mismatched and conflicting lockfile integrities', async () => {
  for (const value of [undefined, '', 'sha512-tampered']) {
    const tampered = structuredClone(lock);
    tampered.packages['node_modules/alias'].integrity = value;
    const result = await checkReleaseAge(tampered, {
      now, fetchMetadata: response({ '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }),
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /integrity/);
  }
  const conflicting = structuredClone(lock);
  conflicting.packages['node_modules/nested/node_modules/alias'] = {
    ...conflicting.packages['node_modules/alias'], integrity: 'sha512-other',
  };
  const result = await checkReleaseAge(conflicting, {
    now, fetchMetadata: response({ '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }),
  });
  assert.ok(result.failures.some((failure) => /conflicting lockfile integrity/.test(failure)));
});

test('fails closed when registry integrity is missing or empty', async () => {
  for (const versions of [undefined, {}, { '1.0.0': { dist: {} } }, { '1.0.0': { dist: { integrity: '' } } }]) {
    const result = await checkReleaseAge(lock, {
      now,
      fetchMetadata: async () => ({ ok: true, json: async () => ({
        time: { '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' }, versions,
      }) }),
    });
    const integrityFailures = result.failures.filter((failure) => /missing registry dist.integrity/.test(failure));
    assert.equal(integrityFailures.length, 2);
  }
});

test('fails closed when registry tarball is missing or empty', async () => {
  for (const dist of [undefined, {}, { integrity }, { integrity, tarball: '' }]) {
    const versionMetadata = dist === undefined ? {} : { dist };
    const result = await checkReleaseAge(lock, {
      now,
      fetchMetadata: async () => ({ ok: true, json: async () => ({
        time: { '1.0.0': '2026-11-01T00:00:00Z', '2.0.0': '2026-11-01T00:00:00Z' },
        versions: { '1.0.0': versionMetadata, '2.0.0': versionMetadata },
      }) }),
    });
    const tarballFailures = result.failures.filter((failure) => /missing registry dist.tarball/.test(failure));
    assert.equal(tarballFailures.length, 2);
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
    `node_modules/package-${i}`, { version: '1.0.0', integrity, resolved: 'https://registry.npmjs.org/package.tgz' },
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
      return { ok: true, json: async () => metadata({ '1.0.0': '2026-11-01T00:00:00Z' }, 'https://registry.npmjs.org/package.tgz') };
    },
  });
  assert.equal(peak, 8);
  assert.deepEqual(result, { checked: 20, failures: [] });
});

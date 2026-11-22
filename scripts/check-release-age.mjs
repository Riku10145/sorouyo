import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const minimumAge = 7 * 24 * 60 * 60 * 1000;

function collectPackages(lock) {
  if (!lock.packages || ![2, 3].includes(lock.lockfileVersion)) {
    throw new Error('Expected a package-lock.json with lockfileVersion 2 or 3 and packages');
  }

  const packages = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.link || entry.inBundle) continue;
    const name = entry.name ?? path.split('node_modules/').at(-1);
    if (!name || !entry.version || !entry.resolved?.startsWith('https://registry.npmjs.org/')) {
      throw new Error(`Cannot verify registry release age for ${path}`);
    }
    if (!packages.has(name)) packages.set(name, new Set());
    packages.get(name).add(entry.version);
  }

  return packages;
}

export async function checkReleaseAge(lock, { baseLock, fetchMetadata = fetch, now = Date.now() } = {}) {
  const packages = collectPackages(lock);
  const basePackages = baseLock ? collectPackages(baseLock) : new Map();
  const queue = [...packages].map(([name, versions]) => [
    name, new Set([...versions].filter((version) => !basePackages.get(name)?.has(version))),
  ]).filter(([, versions]) => versions.size);
  const failures = [];
  let checked = 0;
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      const [name, versions] = queue.shift();
      try {
        const response = await fetchMetadata(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
          signal: AbortSignal.timeout(30_000),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
        const metadata = await response.json();
        for (const version of versions) {
          const published = metadata.time?.[version];
          const timestamp = typeof published === 'string' ? Date.parse(published) : NaN;
          if (!Number.isFinite(timestamp)) {
            failures.push(`${name}@${version}: missing or invalid registry publication time`);
          } else if (now - timestamp < minimumAge) {
            failures.push(`${name}@${version}: published ${published} (less than 7 days ago)`);
          }
          checked++;
        }
      } catch (error) {
        failures.push(`${name}: could not verify ${[...versions].join(', ')}: ${error.message}`);
      }
    }
  }));
  return { checked, failures: failures.sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({
      options: { base: { type: 'string' } },
      allowPositionals: true,
    });
    if (positionals.length > 1) throw new Error('Usage: check-release-age.mjs [--base <git-ref>] [lockfile-path]');
    const lock = JSON.parse(await readFile(positionals[0] ?? 'package-lock.json', 'utf8'));
    let baseLock;
    if (values.base !== undefined) {
      const git = promisify(execFile);
      const { stdout: commit } = await git('git', ['rev-parse', '--verify', '--end-of-options', `${values.base}^{commit}`]);
      const ref = commit.trim();
      const { stdout: path } = await git('git', ['ls-tree', '--name-only', ref, '--', 'package-lock.json']);
      if (path.trim()) {
        const { stdout } = await git('git', ['show', `${ref}:package-lock.json`], { maxBuffer: 20 * 1024 * 1024 });
        baseLock = JSON.parse(stdout);
      }
    }
    const { checked, failures } = await checkReleaseAge(lock, { baseLock });
    if (failures.length) {
      console.error(`Release-age check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      if (values.base !== undefined && checked === 0) {
        console.log('Release-age check passed: no new package versions to check.');
      } else {
        const qualifier = values.base !== undefined ? 'new ' : '';
        console.log(`Release-age check passed: ${checked} ${qualifier}package versions checked (all published ≥7 days ago).`);
      }
    }
  } catch (error) {
    console.error(`Release-age check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

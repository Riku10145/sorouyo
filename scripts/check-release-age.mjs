import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const minimumAge = 7 * 24 * 60 * 60 * 1000;

export async function checkReleaseAge(lock, { fetchMetadata = fetch, now = Date.now() } = {}) {
  if (!lock.packages || ![2, 3].includes(lock.lockfileVersion)) {
    throw new Error('Expected a package-lock.json with lockfileVersion 2 or 3 and packages');
  }

  const packages = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.link) continue;
    const name = entry.name ?? path.split('node_modules/').at(-1);
    if (!name || !entry.version || !entry.resolved?.startsWith('https://registry.npmjs.org/')) {
      throw new Error(`Cannot verify registry release age for ${path}`);
    }
    if (!packages.has(name)) packages.set(name, new Set());
    packages.get(name).add(entry.version);
  }

  const queue = [...packages];
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
    const lock = JSON.parse(await readFile(process.argv[2] ?? 'package-lock.json', 'utf8'));
    const { checked, failures } = await checkReleaseAge(lock);
    if (failures.length) {
      console.error(`Release-age check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`Release-age check passed: ${checked} package versions are at least 7 days old.`);
    }
  } catch (error) {
    console.error(`Release-age check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

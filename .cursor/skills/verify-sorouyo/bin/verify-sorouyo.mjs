#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(binDir, '../../../..');
const wranglerBin = path.join(repoRoot, 'node_modules/wrangler/bin/wrangler.js');
const viteBin = path.join(repoRoot, 'node_modules/vite/bin/vite.js');
const defaultCdpUrl = process.env.CDP_URL ?? 'http://localhost:29229';

const usage = `Usage:
  node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs launch [--run-dir DIR] [--port N]
  node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs doctor --run-dir DIR
  node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs seed-invite --run-dir DIR
  node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs drive FEATURE --run-dir DIR [--cdp URL]
  node .cursor/skills/verify-sorouyo/bin/verify-sorouyo.mjs cleanup --run-dir DIR

Features: guest-answer, sample-calendar, sample-poll-status, invite-error-states, login-boundary, plan-free-notice
`;

function parse(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) options[key] = true;
      else options[key] = rest[++i];
    }
  }
  return { command, positional, options };
}

function requiredRunDir(options) {
  if (!options['run-dir']) throw new Error('--run-dir is required');
  return path.resolve(repoRoot, options['run-dir']);
}

function defaultRunDir() {
  return path.join(repoRoot, '.verification', `run-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '')}-${crypto.randomBytes(3).toString('hex')}`);
}

function paths(runDir) {
  return {
    runDir,
    stateDir: path.join(runDir, 'state'),
    evidenceDir: path.join(runDir, 'evidence'),
    runJson: path.join(runDir, 'run.json'),
    fixtureJson: path.join(runDir, 'fixture.json'),
    serverLog: path.join(runDir, 'server.log'),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`command failed: node ${script} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function wrangler(args) {
  return runNode(wranglerBin, args);
}

function applyMigrations(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  wrangler(['d1', 'migrations', 'apply', 'sorouyo', '--local', '--persist-to', stateDir]);
}

function executeSql(stateDir, sql) {
  const output = wrangler(['d1', 'execute', 'sorouyo', '--local', '--persist-to', stateDir, '--json', '--command', sql]);
  const parsed = JSON.parse(output);
  if (!parsed[0]?.success) throw new Error(`D1 command failed: ${output}`);
  return parsed[0];
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function splitNullSeparated(output) {
  return output.split('\0').filter(Boolean);
}

function workingTreeFingerprint(excludeDir = null) {
  const relativeExclude = excludeDir ? path.relative(repoRoot, excludeDir).split(path.sep).join('/') : null;
  const excludeInsideRepo = Boolean(
    relativeExclude && relativeExclude !== '..' && !relativeExclude.startsWith('../') && !path.isAbsolute(relativeExclude),
  );
  const isExcluded = file => excludeInsideRepo && (file === relativeExclude || file.startsWith(`${relativeExclude}/`));
  const tracked = splitNullSeparated(git(['diff', 'HEAD', '--name-only', '-z'])).filter(file => !isExcluded(file));
  const untracked = splitNullSeparated(git(['ls-files', '-o', '--exclude-standard', '-z'])).filter(file => !isExcluded(file));
  const files = [...new Set([...tracked, ...untracked])].sort();
  const hash = crypto.createHash('sha256');
  hash.update(git(['diff', 'HEAD', '--raw']));
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    try {
      hash.update(fs.readFileSync(path.join(repoRoot, file)));
    } catch {
      hash.update('<missing>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function lsofAvailable() {
  const result = spawnSync('lsof', ['-v'], { stdio: 'ignore' });
  return !result.error;
}

function processEnvironmentHasToken(pid, token) {
  if (!token || process.platform === 'win32') return null;
  try {
    return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`SOROUYO_VERIFY_TOKEN=${token}`);
  } catch {
    return null;
  }
}

function processCommandLine(pid) {
  if (process.platform === 'win32') return '';
  const result = spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.error || result.status !== 0 ? '' : result.stdout.trim();
}

function processMatchesRun(pid, run) {
  if (!pid || !processAlive(pid)) return false;
  const tokenMatch = processEnvironmentHasToken(pid, run.processToken);
  if (tokenMatch !== null) return tokenMatch;
  const command = processCommandLine(pid);
  return command.includes(viteBin) && command.includes(`--port ${run.port}`);
}

async function waitForHealth(url, child, timeoutMs = 45_000) {
  const started = Date.now();
  let lastError = 'not checked';
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`dev server exited with ${child.exitCode}; see server.log`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok && (await response.json()).ok === true) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`dev server did not become healthy: ${lastError}`);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portOwnerPids(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return [];
  return result.stdout.split('\n').filter(line => line.startsWith('p')).map(line => Number(line.slice(1))).filter(Number.isInteger);
}

async function launch(options) {
  const runDir = options['run-dir'] ? path.resolve(repoRoot, options['run-dir']) : defaultRunDir();
  const p = paths(runDir);
  if (process.platform === 'win32') throw new Error('verify-sorouyo currently supports Linux and macOS only');
  if (fs.existsSync(runDir) && fs.readdirSync(runDir).length > 0) {
    throw new Error(`${runDir} already exists and is not empty; use a new empty run directory. Cleanup intentionally retains evidence`);
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(p.evidenceDir, { recursive: true });
  applyMigrations(p.stateDir);

  const port = options.port ? Number(options.port) : await freePort();
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid port: ${options.port}`);
  const processToken = crypto.randomUUID();
  const logFd = fs.openSync(p.serverLog, 'a');
  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, SOROUYO_PERSIST_STATE: p.stateDir, SOROUYO_VERIFY_TOKEN: processToken },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  child.unref();
  const url = `http://127.0.0.1:${port}`;
  const metadata = {
    app: 'sorouyo',
    url,
    port,
    pid: child.pid,
    processToken,
    stateDir: p.stateDir,
    evidenceDir: p.evidenceDir,
    serverLog: p.serverLog,
    repoRoot,
    startedAt: new Date().toISOString(),
    node: process.version,
    gitRevision: git(['rev-parse', 'HEAD']),
    gitStatus: git(['status', '--porcelain']),
    gitWorkingTreeFingerprint: workingTreeFingerprint(runDir),
  };
  writeJson(p.runJson, metadata);

  const abortLaunch = signal => {
    process.stderr.write(`launch interrupted; stopping verification server ${child.pid}. Run cleanup for ${runDir}.\n`);
    stopProcess(child.pid);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const onSigint = () => abortLaunch('SIGINT');
  const onSigterm = () => abortLaunch('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    await waitForHealth(url, child);
  } catch (error) {
    stopProcess(child.pid);
    throw error;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }

  writeJson(p.runJson, { ...metadata, readyAt: new Date().toISOString() });
  printJson({ ok: true, runDir, url, pid: child.pid, evidenceDir: p.evidenceDir });
}

function loadRun(runDir) {
  const p = paths(runDir);
  if (!fs.existsSync(p.runJson)) throw new Error(`missing ${p.runJson}; launch first`);
  return { p, run: readJson(p.runJson) };
}

async function doctor(options) {
  const runDir = requiredRunDir(options);
  const cdpUrl = options.cdp ?? defaultCdpUrl;
  const { p, run } = loadRun(runDir);
  const checks = {};
  checks.processAlive = processAlive(run.pid);
  checks.processMatchesLaunch = processMatchesRun(run.pid, run);
  checks.lsofAvailable = lsofAvailable();
  const owners = portOwnerPids(run.port);
  checks.portOwnedByLaunchedProcess = checks.lsofAvailable && owners.includes(run.pid);
  checks.portOwnerPids = owners;
  try {
    const response = await fetch(`${run.url}/api/health`);
    checks.healthStatus = response.status;
    checks.health = response.ok && (await response.json()).ok === true;
  } catch {
    checks.healthStatus = 0;
    checks.health = false;
  }
  try {
    const response = await fetch(`${run.url}/`);
    const html = await response.text();
    checks.homeStatus = response.status;
    checks.homeIsSorouyo = response.ok && html.includes('<title>そろうよ</title>');
  } catch {
    checks.homeStatus = 0;
    checks.homeIsSorouyo = false;
  }
  try {
    const response = await fetch(`${run.url}/api/auth/me`, { redirect: 'manual' });
    checks.authMeStatus = response.status;
    checks.authBoundaryExpected = response.status === 401 || response.status === 503;
  } catch {
    checks.authMeStatus = 0;
    checks.authBoundaryExpected = false;
  }
  try {
    const response = await fetch(`${cdpUrl}/json/version`);
    checks.cdpStatus = response.status;
    checks.cdpReachable = response.ok;
    checks.cdpBrowser = response.ok ? (await response.json()).Browser : null;
  } catch {
    checks.cdpStatus = 0;
    checks.cdpReachable = false;
    checks.cdpBrowser = null;
  }
  checks.gitRevision = run.gitRevision;
  checks.currentGitRevision = git(['rev-parse', 'HEAD']);
  checks.gitRevisionMatches = !run.gitRevision || run.gitRevision === checks.currentGitRevision;
  checks.gitStatusMatches = run.gitStatus === git(['status', '--porcelain']);
  checks.currentGitWorkingTreeFingerprint = workingTreeFingerprint(runDir);
  checks.gitWorkingTreeFingerprintMatches = !run.gitWorkingTreeFingerprint || run.gitWorkingTreeFingerprint === checks.currentGitWorkingTreeFingerprint;
  checks.ok = Boolean(
    checks.processMatchesLaunch && checks.portOwnedByLaunchedProcess && checks.health &&
    checks.homeIsSorouyo && checks.authBoundaryExpected && checks.cdpReachable && checks.gitRevisionMatches && checks.gitStatusMatches && checks.gitWorkingTreeFingerprintMatches,
  );
  checks.runDir = runDir;
  checks.url = run.url;
  checks.evidenceDir = p.evidenceDir;
  printJson(checks);
  if (!checks.ok) process.exitCode = 1;
}

function plusDays(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function seedInvite(options) {
  const runDir = requiredRunDir(options);
  const { p, run } = loadRun(runDir);
  if (fs.existsSync(p.fixtureJson)) {
    printJson({ ok: true, reused: true, fixture: readJson(p.fixtureJson) });
    return;
  }
  applyMigrations(p.stateDir);
  const suffix = crypto.randomBytes(3).toString('hex');
  const ids = {
    group: crypto.randomUUID(),
    poll: crypto.randomUUID(),
    invite: crypto.randomUUID(),
    candidates: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  };
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const title = `検証の日程調整-${suffix}`;
  const groupName = `検証グループ-${suffix}`;
  const candidates = [
    { id: ids.candidates[0], position: 0, date: plusDays(14), startTime: '12:00' },
    { id: ids.candidates[1], position: 1, date: plusDays(15), startTime: '19:00' },
    { id: ids.candidates[2], position: 2, date: plusDays(16), startTime: null },
  ];
  const sql = `
    INSERT INTO groups (id, name, color, created_by, created_at) VALUES (${quote(ids.group)}, ${quote(groupName)}, '#4E8A5A', ${quote(`verify-${suffix}`)}, ${quote(now)});
    INSERT INTO polls (id, group_id, creator_id, title, deadline_at, status, created_at, edit_version, reopen_pending)
      VALUES (${quote(ids.poll)}, ${quote(ids.group)}, ${quote(`verify-${suffix}`)}, ${quote(title)}, NULL, 'open', ${quote(now)}, 0, 0);
    ${candidates.map(candidate => `INSERT INTO candidates (id, poll_id, position, date, start_time) VALUES (${quote(candidate.id)}, ${quote(ids.poll)}, ${candidate.position}, ${quote(candidate.date)}, ${candidate.startTime ? quote(candidate.startTime) : 'NULL'});`).join('\n')}
    INSERT INTO invites (id, purpose, poll_id, token_hash, created_at) VALUES (${quote(ids.invite)}, 'answer', ${quote(ids.poll)}, ${quote(tokenHash)}, ${quote(now)});
  `;
  executeSql(p.stateDir, sql);
  const fixture = {
    groupId: ids.group,
    pollId: ids.poll,
    inviteId: ids.invite,
    token,
    title,
    groupName,
    candidates,
    url: `${run.url}/r#${token}`,
    respondentName: `検証回答者${suffix}`,
    comment: '検証用のひとことです',
  };
  writeJson(p.fixtureJson, fixture);
  printJson({ ok: true, fixture });
}

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
function dateLabel(key) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${date.getMonth() + 1}月${date.getDate()}日（${DAYS[date.getDay()]}）`;
}
function timeLabel(time) {
  return time ? `${time}〜` : '終日';
}

async function capture(page, directory, name) {
  fs.mkdirSync(directory, { recursive: true });
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  const aria = await page.locator('body').ariaSnapshot();
  fs.writeFileSync(path.join(directory, `${name}.aria.txt`), `${aria}\n`);
}

async function withMobilePage(cdpUrl, callback) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    return await callback(page, context);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function answerRows(stateDir, pollId) {
  return executeSql(stateDir, `
    SELECT a.id AS answer_id, a.display_name, a.comment, v.candidate_id, v.value
    FROM answers a LEFT JOIN votes v ON v.answer_id = a.id
    WHERE a.poll_id = ${quote(pollId)}
    ORDER BY v.candidate_id
  `).results;
}

function resetAnswers(stateDir, pollId) {
  executeSql(stateDir, `
    DELETE FROM votes WHERE answer_id IN (SELECT id FROM answers WHERE poll_id = ${quote(pollId)});
    DELETE FROM answers WHERE poll_id = ${quote(pollId)};
  `);
}

async function driveGuestAnswer(runDir, cdpUrl) {
  const { p, run } = loadRun(runDir);
  if (!fs.existsSync(p.fixtureJson)) throw new Error('missing fixture.json; run seed-invite first');
  const fixture = readJson(p.fixtureJson);
  resetAnswers(p.stateDir, fixture.pollId);
  const directory = path.join(p.evidenceDir, 'guest-answer');
  const votes = ['yes', 'maybe', 'no'];
  const radioNames = { yes: '○ 参加', maybe: '△ 未定', no: '× 欠席' };
  const summary = await withMobilePage(cdpUrl, async (page, context) => {
    await page.goto(fixture.url);
    await page.getByRole('heading', { name: fixture.title }).waitFor();
    await capture(page, directory, '01-open');

    for (const [index, candidate] of fixture.candidates.entries()) {
      const groupLabel = `${dateLabel(candidate.date)} ${timeLabel(candidate.startTime)}`;
      const group = page.getByRole('radiogroup', { name: groupLabel });
      await group.getByRole('radio', { name: radioNames[votes[index]] }).click();
    }
    await page.getByLabel('お名前').fill(fixture.respondentName);
    await capture(page, directory, '02-filled-no-comment');

    await page.getByRole('button', { name: '回答を送る' }).click();
    await page.getByRole('heading', { name: '回答を送りました' }).waitFor();
    assert.equal(await page.getByText('ひとこと：').count(), 0, 'empty comment must not render a receipt comment');
    await capture(page, directory, '03-sent-no-comment');

    const emptyRows = answerRows(p.stateDir, fixture.pollId);
    writeJson(path.join(directory, 'db-answer-empty.json'), emptyRows);
    assert.equal(emptyRows.length, fixture.candidates.length, 'empty-comment submission must create one vote row per candidate');
    assert.equal(new Set(emptyRows.map(row => row.answer_id)).size, 1, 'empty-comment submission must create exactly one answer');
    assert.equal(emptyRows[0]?.display_name, fixture.respondentName);
    assert.equal(emptyRows[0]?.comment ?? '', '', 'empty comment answer is saved without a comment');
    const emptyVotes = Object.fromEntries(emptyRows.map(row => [row.candidate_id, row.value]));
    for (const [index, candidate] of fixture.candidates.entries()) {
      assert.equal(emptyVotes[candidate.id], votes[index], `empty-comment vote stored for ${candidate.id}`);
    }

    await page.getByRole('button', { name: '回答を変更する' }).click();
    await page.getByRole('heading', { name: '候補日' }).waitFor();
    await page.getByLabel('ひとこと（任意）').fill(fixture.comment);
    await capture(page, directory, '04-comment-added');
    await page.getByRole('button', { name: '回答を送る' }).click();
    await page.getByRole('heading', { name: '回答を送りました' }).waitFor();
    await page.getByText(`ひとこと：${fixture.comment}`).waitFor();
    await capture(page, directory, '05-sent-with-comment');
    await page.getByRole('button', { name: '回答を変更する' }).click();
    await page.getByRole('heading', { name: '候補日' }).waitFor();
    await capture(page, directory, '06-editing');

    const rows = answerRows(p.stateDir, fixture.pollId);
    writeJson(path.join(directory, 'db-answer.json'), rows);
    const byCandidate = Object.fromEntries(rows.map(row => [row.candidate_id, row.value]));
    assert.equal(rows.length, fixture.candidates.length, 'comment edit must keep one vote row per candidate');
    assert.equal(new Set(rows.map(row => row.answer_id)).size, 1, 'comment edit must keep exactly one answer');
    assert.equal(rows[0]?.answer_id, emptyRows[0]?.answer_id, 'editing must update the same answer row');
    assert.equal(rows[0]?.display_name, fixture.respondentName);
    assert.equal(rows[0]?.comment, fixture.comment);
    for (const [index, candidate] of fixture.candidates.entries()) {
      assert.equal(byCandidate[candidate.id], votes[index], `vote stored for ${candidate.id}`);
    }

    const reopened = await context.newPage();
    reopened.setDefaultTimeout(10_000);
    await reopened.goto(fixture.url);
    await reopened.getByLabel('お名前').waitFor();
    assert.equal(await reopened.getByLabel('お名前').inputValue(), fixture.respondentName);
    assert.equal(await reopened.getByLabel('ひとこと（任意）').inputValue(), fixture.comment);
    for (const [index, candidate] of fixture.candidates.entries()) {
      const groupLabel = `${dateLabel(candidate.date)} ${timeLabel(candidate.startTime)}`;
      const radio = reopened.getByRole('radiogroup', { name: groupLabel }).getByRole('radio', { name: radioNames[votes[index]] });
      assert.equal(await radio.getAttribute('aria-checked'), 'true', `reopened vote for ${candidate.id}`);
    }
    await capture(reopened, directory, '07-reopened');
    return {
      feature: 'guest-answer',
      url: fixture.url,
      assertions: [
        'invite form rendered from the seeded D1 fixture',
        'three votes and a name were submitted through the browser without a comment',
        'the empty-comment answer completed normally and was read back from isolated local D1 without a comment',
        'editing the same answer added a comment and the receipt displayed it',
        'answers and votes rows were read back from the isolated local D1 database',
        'reopening the same invite in the same browser context restored the saved answer and comment',
      ],
      artifacts: ['01-open.png', '01-open.aria.txt', '02-filled-no-comment.png', '02-filled-no-comment.aria.txt', '03-sent-no-comment.png', '03-sent-no-comment.aria.txt', 'db-answer-empty.json', '04-comment-added.png', '04-comment-added.aria.txt', '05-sent-with-comment.png', '05-sent-with-comment.aria.txt', '06-editing.png', '06-editing.aria.txt', 'db-answer.json', '07-reopened.png', '07-reopened.aria.txt'],
    };
  });
  writeJson(path.join(directory, 'summary.json'), summary);
  printJson({ ok: true, evidenceDir: directory, summary });
}

async function driveSampleCalendar(runDir, cdpUrl) {
  const { p, run } = loadRun(runDir);
  const directory = path.join(p.evidenceDir, 'sample-calendar');
  const summary = await withMobilePage(cdpUrl, async page => {
    await page.goto(`${run.url}/`);
    await page.getByRole('grid').first().waitFor();
    await capture(page, directory, '00-default-home');
    await page.goto(`${run.url}/?date=2026-11-21`);
    await page.getByRole('grid', { name: '2026年11月のカレンダー' }).waitFor();
    assert.equal(await page.locator('[data-date="2026-11-21"]').getAttribute('aria-selected'), 'true');
    await page.getByRole('listitem').filter({ hasText: 'おうちランチ' }).first().waitFor();
    await page.getByRole('listitem').filter({ hasText: '映画デート' }).first().waitFor();
    await capture(page, directory, '01-november-selected-day');
    await page.locator('[data-date="2026-11-22"]').click();
    assert.equal(await page.locator('[data-date="2026-11-22"]').getAttribute('aria-selected'), 'true');
    await page.locator('[data-date="2026-11-21"]').click();
    assert.equal(await page.locator('[data-date="2026-11-21"]').getAttribute('aria-selected'), 'true');
    await page.getByRole('listitem').filter({ hasText: 'おうちランチ' }).first().waitFor();
    await capture(page, directory, '02-day-switch');
    await page.getByRole('button', { name: '次の月' }).click();
    await page.getByRole('grid', { name: '2026年12月のカレンダー' }).waitFor();
    await capture(page, directory, '03-december');
    await page.getByRole('button', { name: '前の月' }).click();
    await page.getByRole('grid', { name: '2026年11月のカレンダー' }).waitFor();
    return {
      feature: 'sample-calendar',
      url: `${run.url}/?date=2026-11-21`,
      assertions: [
        'the unsigned-in home route rendered a sample calendar',
        'November 2026 sample calendar rendered at the requested selected date',
        'sample events for 2026-11-21 were visible in the day list',
        'clicking day cells moved the selected date and restored the event list',
        'next-month and previous-month controls changed the rendered calendar month',
      ],
      artifacts: ['00-default-home.png', '00-default-home.aria.txt', '01-november-selected-day.png', '01-november-selected-day.aria.txt', '02-day-switch.png', '02-day-switch.aria.txt', '03-december.png', '03-december.aria.txt'],
    };
  });
  writeJson(path.join(directory, 'summary.json'), summary);
  printJson({ ok: true, evidenceDir: directory, summary });
}

async function driveSamplePollStatus(runDir, cdpUrl) {
  const { p, run } = loadRun(runDir);
  const directory = path.join(p.evidenceDir, 'sample-poll-status');
  const summary = await withMobilePage(cdpUrl, async page => {
    await page.goto(`${run.url}/polls/sample`);
    await page.getByRole('heading', { name: '餃子の会' }).waitFor();
    await page.goto(`${run.url}/polls`);
    await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
    await page.getByRole('link', { name: 'サンプルの日程調整画面を見る' }).click();
    await page.getByRole('heading', { name: '餃子の会' }).waitFor();
    await page.getByRole('heading', { name: 'ひとこと' }).waitFor();
    await page.getByRole('region', { name: '回答のひとこと' }).getByRole('listitem').filter({ hasText: 'はな' }).filter({ hasText: '19時以降なら参加できます' }).first().waitFor();
    await capture(page, directory, '01-status');
    await page.getByRole('button', { name: /11月28日（土） 19:00〜.*この候補日を選ぶ/ }).click();
    await page.getByRole('article', { name: /11月28日（土） 19:00〜（選択中）/ }).waitFor();
    await capture(page, directory, '02-candidate-selected');
    await page.getByRole('button', { name: '11月28日(土)に確定する' }).click();
    await page.getByRole('heading', { name: '日程が決まりました' }).waitFor();
    await page.getByText('11月28日（土） 19:00〜').first().waitFor();
    await capture(page, directory, '03-confirmed');
    return {
      feature: 'sample-poll-status',
      url: `${run.url}/polls/sample`,
      assertions: [
        'sample poll status rendered by both direct URL and the signed-out sample link',
        'the host-status sample rendered the named answer comment with the poll answers',
        'choosing another candidate moved it into the selected candidate card',
        'the confirm button reached the completion screen for the chosen sample candidate',
      ],
      artifacts: ['01-status.png', '01-status.aria.txt', '02-candidate-selected.png', '02-candidate-selected.aria.txt', '03-confirmed.png', '03-confirmed.aria.txt'],
    };
  });
  writeJson(path.join(directory, 'summary.json'), summary);
  printJson({ ok: true, evidenceDir: directory, summary });
}

async function driveInviteErrorStates(runDir, cdpUrl) {
  const { p, run } = loadRun(runDir);
  const directory = path.join(p.evidenceDir, 'invite-error-states');
  const summary = await withMobilePage(cdpUrl, async page => {
    await page.goto(`${run.url}/r#sample-closed`);
    await page.getByRole('heading', { name: '回答は締め切りました' }).waitFor();
    await capture(page, directory, '01-closed-sample');
    await page.goto(`${run.url}/r#invalid-token-for-verification`);
    await page.getByRole('heading', { name: '招待を開けません' }).waitFor();
    await capture(page, directory, '02-invalid-token');
    await page.goto(`${run.url}/r`);
    await page.getByRole('heading', { name: '招待を開けません' }).waitFor();
    await capture(page, directory, '03-no-token');
    return {
      feature: 'invite-error-states',
      assertions: [
        'sample closed invite rendered the closed state',
        'unknown remote invite token rendered the invalid-link state',
        'the tokenless /r route rendered the invalid-link state',
      ],
      artifacts: ['01-closed-sample.png', '01-closed-sample.aria.txt', '02-invalid-token.png', '02-invalid-token.aria.txt', '03-no-token.png', '03-no-token.aria.txt'],
    };
  });
  writeJson(path.join(directory, 'summary.json'), summary);
  printJson({ ok: true, evidenceDir: directory, summary });
}

async function driveLoginBoundary(runDir, cdpUrl) {
  const { p, run } = loadRun(runDir);
  const directory = path.join(p.evidenceDir, 'login-boundary');
  const summary = await withMobilePage(cdpUrl, async page => {
    await page.goto(`${run.url}/polls`);
    await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
    await page.getByRole('link', { name: 'サンプルの日程調整画面を見る' }).waitFor();
    await capture(page, directory, '01-login-required');
    await page.getByRole('link', { name: 'サンプルの日程調整画面を見る' }).click();
    await page.getByRole('heading', { name: '餃子の会' }).waitFor();
    await capture(page, directory, '02-sample-link');
    await page.goto(`${run.url}/`);
    await page.getByRole('link', { name: '日程調整' }).click();
    await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
    const loginResponse = await fetch(`${run.url}/api/auth/login`, { redirect: 'manual' });
    let authUnavailableShown = false;
    if (loginResponse.status === 503) {
      await page.getByRole('link', { name: 'ログイン' }).first().click();
      await page.getByText('ログイン機能はまだ設定されていません。').waitFor();
      authUnavailableShown = true;
      await capture(page, directory, '03-auth-unavailable');
    }
    return {
      feature: 'login-boundary',
      authMeaningful: loginResponse.status !== 503,
      assertions: [
        'poll list requires a member login instead of exposing member data through direct URL and bottom navigation',
        'the sample poll link opens the sample poll for signed-out visitors',
        ...(authUnavailableShown ? ['the unconfigured-auth environment explains that login is not set up'] : ['auth is configured, so the login redirect was not exercised']),
      ],
      artifacts: authUnavailableShown
        ? ['01-login-required.png', '01-login-required.aria.txt', '02-sample-link.png', '02-sample-link.aria.txt', '03-auth-unavailable.png', '03-auth-unavailable.aria.txt']
        : ['01-login-required.png', '01-login-required.aria.txt', '02-sample-link.png', '02-sample-link.aria.txt'],
    };
  });
  writeJson(path.join(directory, 'summary.json'), summary);
  printJson({ ok: true, evidenceDir: directory, summary });
}

async function assertExactPlanNotice(page, notice) {
  const noticeLocator = page.locator('section[aria-labelledby="free-plan-heading"] p');
  await noticeLocator.waitFor({ state: 'visible' });
  const box = await noticeLocator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'plan notice is not visibly rendered');
  const actual = await noticeLocator.innerText();
  assert.equal(actual.replace(/\s+/g, ' ').trim(), notice);
  const body = await page.locator('body').innerText();
  for (const forbidden of [/[¥￥]/, /円/, /月額/, /年額/, /課金開始/, /有料機能/, /解約/, /返金/]) {
    assert.equal(forbidden.test(body), false, `plan notice contains undecided billing term matching ${forbidden}`);
  }
}

async function drivePlanFreeNotice(runDir, cdpUrl) {
  const { p, run } = loadRun(runDir);
  const directory = path.join(p.evidenceDir, 'plan-free-notice');
  const notice = 'いまは無料期間です。1人5グループまで作れます（招待されて参加したグループは数えません）。今後有料プランを始める場合も、それまでに作ったグループはずっと無料で使えます。日程調整への回答は、登録なしでいつでも無料です。';
  const summary = await withMobilePage(cdpUrl, async page => {
    await page.goto(`${run.url}/`);
    await page.getByRole('link', { name: 'プラン' }).click();
    await page.getByRole('heading', { name: 'プラン' }).waitFor();
    await page.getByRole('heading', { name: 'ご案内' }).waitFor();
    await assertExactPlanNotice(page, notice);
    await capture(page, directory, '01-plan-from-nav');
    await page.goto(`${run.url}/plan`);
    await page.getByRole('heading', { name: 'プラン' }).waitFor();
    await assertExactPlanNotice(page, notice);
    await capture(page, directory, '02-plan-direct');
    return {
      feature: 'plan-free-notice',
      url: `${run.url}/plan`,
      assertions: [
        'the bottom navigation plan link opened the plan page',
        'the plan page rendered the exact free-period notice with no appended or undecided billing terms',
        'the direct /plan route rendered the same exact notice',
      ],
      artifacts: ['01-plan-from-nav.png', '01-plan-from-nav.aria.txt', '02-plan-direct.png', '02-plan-direct.aria.txt'],
    };
  });
  writeJson(path.join(directory, 'summary.json'), summary);
  printJson({ ok: true, evidenceDir: directory, summary });
}

async function drive(positional, options) {
  const feature = positional[0];
  const runDir = requiredRunDir(options);
  const cdpUrl = options.cdp ?? defaultCdpUrl;
  const drivers = {
    'guest-answer': driveGuestAnswer,
    'sample-calendar': driveSampleCalendar,
    'sample-poll-status': driveSamplePollStatus,
    'invite-error-states': driveInviteErrorStates,
    'login-boundary': driveLoginBoundary,
    'plan-free-notice': drivePlanFreeNotice,
  };
  if (!drivers[feature]) throw new Error(`unknown feature ${feature}; expected one of ${Object.keys(drivers).join(', ')}`);
  loadRun(runDir);
  const directory = path.join(paths(runDir).evidenceDir, feature);
  fs.rmSync(path.join(directory, 'summary.json'), { force: true });
  try {
    await drivers[feature](runDir, cdpUrl);
  } catch (error) {
    writeJson(path.join(directory, 'summary.json'), {
      feature,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      failedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function stopProcess(pid) {
  if (!pid || !processAlive(pid)) return;
  try {
    if (process.platform === 'win32') process.kill(pid, 'SIGTERM');
    else process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && processAlive(pid)) {
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 100)']);
  }
  if (processAlive(pid)) {
    try {
      if (process.platform === 'win32') process.kill(pid, 'SIGKILL');
      else process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ }
    }
  }
}

function cleanupFixture(p) {
  if (!fs.existsSync(p.fixtureJson)) return;
  const fixture = readJson(p.fixtureJson);
  executeSql(p.stateDir, `
    DELETE FROM analytics_events WHERE poll_id = ${quote(fixture.pollId)};
    DELETE FROM votes WHERE answer_id IN (SELECT id FROM answers WHERE poll_id = ${quote(fixture.pollId)});
    DELETE FROM answers WHERE poll_id = ${quote(fixture.pollId)};
    DELETE FROM candidates WHERE poll_id = ${quote(fixture.pollId)};
    DELETE FROM invites WHERE id = ${quote(fixture.inviteId)};
    DELETE FROM polls WHERE id = ${quote(fixture.pollId)};
    DELETE FROM groups WHERE id = ${quote(fixture.groupId)};
  `);
  fs.rmSync(p.fixtureJson, { force: true });
}

function cleanup(options) {
  const runDir = requiredRunDir(options);
  const { p, run } = loadRun(runDir);
  let fixtureError = null;
  try {
    cleanupFixture(p);
  } catch (error) {
    fixtureError = error instanceof Error ? error.message : String(error);
  }
  const serverProcessMatched = processMatchesRun(run.pid, run);
  if (serverProcessMatched) stopProcess(run.pid);
  fs.mkdirSync(p.evidenceDir, { recursive: true });
  fs.cpSync(p.runJson, path.join(p.evidenceDir, 'run.json'));
  if (fs.existsSync(p.serverLog)) fs.cpSync(p.serverLog, path.join(p.evidenceDir, 'server.log'));
  fs.rmSync(p.stateDir, { recursive: true, force: true });
  fs.rmSync(p.runJson, { force: true });
  fs.rmSync(p.serverLog, { force: true });
  const result = {
    ok: !fixtureError,
    runDir,
    evidenceDir: p.evidenceDir,
    evidenceRetained: fs.existsSync(p.evidenceDir),
    removed: ['state/', 'run.json', 'server.log', 'fixture.json'],
    fixtureError,
    serverProcessMatched,
  };
  printJson(result);
  if (fixtureError) process.exitCode = 1;
}

async function main() {
  const { command, positional, options } = parse(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(usage);
    return;
  }
  if (command === 'launch') await launch(options);
  else if (command === 'doctor') await doctor(options);
  else if (command === 'seed-invite') seedInvite(options);
  else if (command === 'drive') await drive(positional, options);
  else if (command === 'cleanup') cleanup(options);
  else throw new Error(`unknown command ${command}\n${usage}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

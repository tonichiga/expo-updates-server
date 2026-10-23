import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { parseDoctorArgs, readDoctorEnv, runDoctor } from './doctor.mjs';
import { probeServer } from './doctor-probes.mjs';
let root, key, certificate;
const secret = 'do-not-print-password#private';
const check = (result, id) => result.checks.find((item) => item.id === id);
async function fixture() {
  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  await fs.symlink(path.resolve('node_modules'), path.join(dir, 'node_modules'));
  await fs.writeFile(path.join(dir, 'package.json'), '{}');
  await fs.writeFile(path.join(dir, 'server.env'), `CODE_SIGNING_PRIVATE_KEY_PATH=${key}\nOTA_PUBLIC_BASE_URL=https://ota.test\nDATABASE_PROVIDER=pg\nDATABASE_URL=postgresql://tester:${encodeURIComponent(secret)}@127.0.0.1:1/ota\nR2_ENDPOINT=http://127.0.0.1:1\nR2_ACCESS_KEY_ID=test\nR2_SECRET_ACCESS_KEY='${secret}'\nR2_BUCKET=test\n`);
  return dir;
}
const offline = (cwd, extra = {}) => runDoctor({ cwd, mode: 'remote', serverEnv: 'server.env', offline: true, certificate, ...extra });
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ota-doctor-'));
  key = path.join(root, 'key.pem'); certificate = path.join(root, 'certificate.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=doctor-test', '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=codeSigning', '-keyout', key, '-out', certificate], { stdio: 'ignore', timeout: 10000 });
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('doctor read-only contract', () => {
  it('checks a valid offline setup and matching cert without networking or modifying files/env', async () => {
    const cwd = await fixture();
    const before = await fs.readFile(path.join(cwd, 'server.env'), 'utf8');
    const ambient = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://ambient-secret@production.invalid/db';
    try {
      const result = await offline(cwd);
      expect(result.status).toBe('pass');
      expect(check(result, 'signing.match').status).toBe('pass');
      expect(check(result, 'database.connection').status).toBe('skip');
      expect(await fs.readFile(path.join(cwd, 'server.env'), 'utf8')).toBe(before);
      expect(process.env.DATABASE_URL).toContain('ambient-secret');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
    } finally { if (ambient === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = ambient; }
  });
  it('parses quoted credentials without shell execution or ambient expansion', async () => {
    const file = path.join(await fixture(), 'quoted.env');
    await fs.writeFile(file, `PASSWORD="hash#value"\nLITERAL='$(touch nope)\u0024{HOME}'\n`);
    expect(await readDoctorEnv(file)).toEqual({ PASSWORD: 'hash#value', LITERAL: '$(touch nope)${HOME}' });
  });
  it('reports missing key and wrong certificate as distinct problems', async () => {
    const cwd = await fixture();
    await fs.appendFile(path.join(cwd, 'server.env'), '\nCODE_SIGNING_PRIVATE_KEY_PATH=/nonexistent-doctor-key\n');
    const missing = await offline(cwd);
    expect(check(missing, 'signing.key').status).toBe('fail');
    expect(check(missing, 'signing.match').status).toBe('skip');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const second = await fixture();
    await fs.writeFile(path.join(second, 'other.pem'), other);
    await fs.appendFile(path.join(second, 'server.env'), `\nCODE_SIGNING_PRIVATE_KEY_PATH=${path.join(second, 'other.pem')}\n`);
    expect(check(await offline(second), 'signing.match').status).toBe('fail');
  });
  it('does not fall back to ambient env when selected file is missing', async () => {
    const result = await offline(await fixture(), { serverEnv: 'absent.env' });
    expect(result.status).toBe('fail');
    expect(check(result, 'server.env').status).toBe('fail');
  });
  it('reports database and bucket failures without leaking credentials', async () => {
    const env = await readDoctorEnv(path.join(await fixture(), 'server.env'));
    const result = await probeServer({ env, timeout: 500 });
    expect(check(result, 'database.connection').status).toBe('fail');
    expect(check(result, 'storage.bucket').status).toBe('fail');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(secret));
  });
  it('uses only read-only requests against a missing S3 bucket', async () => {
    const methods = [];
    const server = createServer((req, res) => { methods.push(req.method); res.writeHead(404); res.end(); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const env = await readDoctorEnv(path.join(await fixture(), 'server.env'));
      env.R2_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
      env.R2_REGION = 'us-east-1'; env.S3_FORCE_PATH_STYLE = 'true'; env.DATABASE_URL = '';
      const result = await probeServer({ env, timeout: 1000 });
      expect(check(result, 'storage.bucket').status).toBe('fail');
      expect(methods).toEqual(['HEAD']);
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  });
  it('bounds a stalled storage request', async () => {
    const server = createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const env = await readDoctorEnv(path.join(await fixture(), 'server.env'));
      env.R2_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
      env.R2_REGION = 'us-east-1'; env.S3_FORCE_PATH_STYLE = 'true'; env.DATABASE_URL = '';
      const before = Date.now();
      expect(check(await probeServer({ env, timeout: 500 }), 'storage.bucket').status).toBe('fail');
      expect(Date.now() - before).toBeLessThan(2500);
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  });
  it('selects the requested Docker project/files, contains no secrets in argv and reports drift', async () => {
    const cwd = await fixture();
    let invocation;
    const result = await runDoctor({ cwd, serverEnv: 'server.env', project: 'isolated', composeFiles: ['docker-compose.yml', 'override.yml'] }, {
      exec: async (...args) => { invocation = args; return { stdout: JSON.stringify({ checks: [], publicUrl: 'https://stale.test' }) }; },
      fetch: async () => new Response(JSON.stringify({ status: 'ok', checks: { database: 'ok' } })),
    });
    expect(invocation[1]).toContain('isolated');
    expect(invocation[1]).toContain(path.join(cwd, 'override.yml'));
    expect(invocation[1]).toContain('-T');
    expect(JSON.stringify(invocation)).not.toContain(secret);
    expect(check(result, 'docker.env-drift').status).toBe('fail');
  });
  it('does not expose Docker stderr or exception text', async () => {
    const result = await runDoctor({ cwd: await fixture(), serverEnv: 'server.env' }, {
      exec: async () => { throw new Error(`Credentials ${secret}`); },
      fetch: async () => { throw new Error(secret); },
    });
    expect(check(result, 'docker.app').status).toBe('fail');
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('never executes dynamic Expo config', async () => {
    const cwd = await fixture();
    const app = path.join(cwd, 'app'); await fs.mkdir(app);
    await fs.writeFile(path.join(app, 'app.config.js'), 'throw new Error("must never execute")');
    const result = await offline(cwd, { app });
    expect(check(result, 'app.config').status).toBe('fail');
    expect(JSON.stringify(result)).not.toContain('must never execute');
  });
  it('reports URL mismatch and missing client/root without modifying an app', async () => {
    const cwd = await fixture(); const app = path.join(cwd, 'app'); await fs.mkdir(app);
    const contents = JSON.stringify({ expo: { runtimeVersion: 'one', updates: { url: 'https://wrong.test/api/manifest', checkAutomatically: 'NEVER', requestHeaders: { 'expo-channel-name': 'test' } } } });
    await fs.writeFile(path.join(app, 'app.json'), contents);
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ main: 'expo-router/entry' }));
    await fs.mkdir(path.join(app, 'app'));
    await fs.writeFile(path.join(app, 'app/_layout.tsx'), 'export default function Layout() { return null; }');
    const result = await offline(cwd, { app });
    expect(check(result, 'app.url').status).toBe('fail');
    expect(check(result, 'app.identity').status).toBe('fail');
    expect(check(result, 'app.root').status).toBe('fail');
    expect(await fs.readFile(path.join(app, 'app.json'), 'utf8')).toBe(contents);
    expect(await fs.readFile(path.join(app, 'app/_layout.tsx'), 'utf8')).toBe('export default function Layout() { return null; }');
  });
  it('rejects TLS-only certificates even when the RSA key matches', async () => {
    const cwd = await fixture();
    const tls = path.join(cwd, 'tls.pem');
    execFileSync('openssl', ['req', '-new', '-x509', '-key', key, '-days', '2', '-subj', '/CN=tls-only', '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,keyEncipherment', '-addext', 'extendedKeyUsage=serverAuth', '-out', tls], { stdio: 'ignore', timeout: 10000 });
    const result = await offline(cwd, { certificate: tls });
    expect(check(result, 'signing.certificate').status).toBe('fail');
  });
  it('rejects ambient PG identity fallback and makes the default port explicit', async () => {
    const env = await readDoctorEnv(path.join(await fixture(), 'server.env'));
    env.DATABASE_URL = 'postgresql://127.0.0.1/ota';
    const result = await probeServer({ env, network: false });
    expect(check(result, 'database.config').status).toBe('fail');
    env.DATABASE_URL = 'postgresql://tester:password@127.0.0.1/ota?password=';
    expect(check(await probeServer({ env, network: false }), 'database.config').status).toBe('fail');
  });
  it('detects missing migration objects and uses read-only queries with isolated connection options', async () => {
    let config;
    const statements = [];
    vi.doMock('pg', () => ({ default: { Client: class {
      constructor(value) { config = value; }
      on() {}
      async connect() {}
      async end() {}
      async query(sql) { statements.push(sql); return { rows: [{ ready: false }] }; }
    } } }));
    try {
      const env = await readDoctorEnv(path.join(await fixture(), 'server.env'));
      env.DATABASE_URL = 'postgresql://tester:password@127.0.0.1/ota'; env.R2_ENDPOINT = '';
      const result = await probeServer({ env, timeout: 500 });
      expect(check(result, 'database.connection').status).toBe('pass');
      expect(check(result, 'database.schema').status).toBe('fail');
      expect(new URL(config.connectionString).port).toBe('5432');
      expect(config.options).toBe('-c default_transaction_read_only=on');
      expect(config.query_timeout).toBe(500);
      const ambientKeys = ['PGUSER', 'PGPASSWORD', 'PGHOST', 'PGDATABASE', 'PGPORT', 'PGREPLICATION', 'PGCLIENT_ENCODING'];
      const previous = Object.fromEntries(ambientKeys.map((name) => [name, process.env[name]]));
      try {
        for (const name of ambientKeys) process.env[name] = name === 'PGPORT' ? '9999' : 'ambient-unwanted';
        const actualPg = await vi.importActual('pg');
        const actual = new actualPg.default.Client(config).connectionParameters;
        expect({ user: actual.user, password: actual.password, host: actual.host, database: actual.database, port: actual.port, replication: actual.replication, encoding: actual.client_encoding }).toEqual({ user: 'tester', password: 'password', host: '127.0.0.1', database: 'ota', port: 5432, replication: 'false', encoding: 'utf8' });
      } finally {
        for (const name of ambientKeys) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
      }
      expect(statements.every((sql) => sql.trim().startsWith('SELECT'))).toBe(true);
      expect(statements.at(-1)).toContain('trg_ota_updates_activate_audience');
    } finally { vi.doUnmock('pg'); }
  });
  it('validates a complete generated app, then detects missing client files and noncanonical scope', async () => {
    const cwd = await fixture(); const app = path.join(cwd, 'app'); await fs.mkdir(app);
    const deps = ['expo', 'expo-updates', 'expo-application', 'expo-crypto', 'expo-secure-store', '@react-native-async-storage/async-storage'];
    for (const name of deps) {
      const dir = path.join(app, 'node_modules', name); await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'index.js'), '');
    }
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ main: 'ota-entry.js', dependencies: Object.fromEntries(deps.map((name) => [name, '1'])), scripts: { 'ota:publish': 'node scripts/ota-publish/index.mjs' } }));
    const config = { expo: { runtimeVersion: 'v1', updates: { url: 'https://ota.test/api/manifest', checkAutomatically: 'NEVER', requestHeaders: { 'expo-channel-name': 'test' }, codeSigningCertificate: certificate, codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' } } } };
    await fs.writeFile(path.join(app, 'app.json'), JSON.stringify(config));
    await fs.cp(path.resolve('templates/expo-app/ota-client'), path.join(app, 'ota-client'), { recursive: true });
    await fs.writeFile(path.join(app, 'ota-client/config.json'), JSON.stringify({ channel: 'test', heartbeatUrl: 'https://ota.test/api/device-heartbeat', identityNamespace: 'stable-test' }));
    await fs.writeFile(path.join(app, 'ota-entry.js'), "require('./ota-client').start(); require('expo/AppEntry');");
    await fs.writeFile(path.join(app, 'ota-client-entry.json'), JSON.stringify({ originalEntry: 'expo/AppEntry' }));
    const { patchOtaRootHook } = await import('./ota-root-hook-patcher.mjs');
    const source = patchOtaRootHook('export default function App() { return null; }', path.join(app, 'App.tsx'), app);
    await fs.writeFile(path.join(app, 'App.tsx'), source);
    await fs.writeFile(path.join(app, '.env.ota'), 'EXPO_UPDATE_CHANNEL=test\nOTA_SERVER_URL=https://ota.test\nOTA_DATABASE_URL=postgresql://user:pass@127.0.0.1/db\nR2_ENDPOINT=http://127.0.0.1:9000\nR2_ACCESS_KEY_ID=key\nR2_SECRET_ACCESS_KEY=secret\nR2_BUCKET=test\n');
    const valid = await offline(cwd, { app });
    expect(valid.checks.filter((item) => item.status === 'fail')).toEqual([]);
    expect(check(valid, 'app.root').status).toBe('pass');
    expect(await fs.readFile(path.join(app, 'App.tsx'), 'utf8')).toBe(source);
    await fs.unlink(path.join(app, 'ota-client/runtime.ts'));
    expect(check(await offline(cwd, { app }), 'app.client').status).toBe('fail');
    config.expo.updates.requestHeaders['expo-channel-name'] = 'Test'; config.expo.runtimeVersion = ' v1 ';
    await fs.writeFile(path.join(app, 'app.json'), JSON.stringify(config));
    const invalid = await offline(cwd, { app });
    expect(check(invalid, 'app.scope').status).toBe('fail');
    expect(check(invalid, 'app.publisher-channel').status).toBe('fail');
  });
  it('checks Supabase with GET only and reports missing REST tables', async () => {
    const requests = []; let missing = false;
    const server = createServer((req, res) => {
      requests.push(req.method);
      res.writeHead(missing && req.url.includes('ota_named_devices') ? 404 : 200, { 'content-type': 'application/json' }); res.end('[]');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const env = { CODE_SIGNING_PRIVATE_KEY_PATH: key, OTA_PUBLIC_BASE_URL: 'https://ota.test', DATABASE_PROVIDER: 'supabase', SUPABASE_PROJECT_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: secret };
      const valid = await probeServer({ env, timeout: 500 });
      expect(check(valid, 'database.schema').status).toBe('pass');
      expect(check(valid, 'database.schema-functions').status).toBe('warn');
      expect(check(valid, 'storage.bucket').status).toBe('pass');
      missing = true;
      expect(check(await probeServer({ env, timeout: 500 }), 'database.schema').status).toBe('fail');
      expect(requests.every((method) => method === 'GET')).toBe(true);
      expect(JSON.stringify(valid)).not.toContain(secret);
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  });
  it('reports a private-key file that cannot be read as a signing failure', async () => {
    const cwd = await fixture(); const unreadable = path.join(cwd, 'unreadable.pem');
    await fs.copyFile(key, unreadable); await fs.chmod(unreadable, 0);
    try {
      // Root can bypass Unix permissions; a directory still exercises a read failure there.
      const inaccessible = process.getuid?.() === 0 ? cwd : unreadable;
      await fs.appendFile(path.join(cwd, 'server.env'), `\nCODE_SIGNING_PRIVATE_KEY_PATH=${inaccessible}\n`);
      expect(check(await offline(cwd), 'signing.key').status).toBe('fail');
    } finally { await fs.chmod(unreadable, 0o600); }
  });
  it('validates CLI options and produces parseable JSON/exit codes', async () => {
    expect(parseDoctorArgs(['--offline', '--compose-file', 'a', '--compose-file', 'b']).composeFiles).toEqual(['a', 'b']);
    expect(() => parseDoctorArgs(['--timeout', '0'])).toThrow();
    expect(() => parseDoctorArgs(['--mode', 'remote', '--project', 'test'])).toThrow();
    expect(() => parseDoctorArgs(['--server-env'])).toThrow();
    const cli = path.resolve('scripts/doctor.mjs');
    const cwd = await fixture();
    const valid = execFileSync(process.execPath, [cli, '--mode', 'remote', '--server-env', 'server.env', '--offline', '--json'], { cwd, encoding: 'utf8' });
    expect(JSON.parse(valid).status).toBe('pass');
    try { execFileSync(process.execPath, [cli, '--server-env', 'missing', '--json'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); expect.unreachable(); }
    catch (error) { expect(error.status).toBe(1); expect(JSON.parse(error.stdout).status).toBe('fail'); }
  });
});

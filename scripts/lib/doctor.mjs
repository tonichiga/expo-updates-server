import fs from 'node:fs/promises';
import path from 'node:path';
import * as util from 'node:util';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { probeServer } from './doctor-probes.mjs';

const exec = util.promisify(execFile);
const present = (value) => typeof value === 'string' && Boolean(value.trim()) && !/(?:<[^>]+>|replace-with|YOUR_|choose-a-|:\/\/USER:PASSWORD@HOST|:\/\/user:password@host|updates\.example\.com|storage\.example\.com)/.test(value);
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = async (file) => fs.access(file).then(() => true, () => false);
export function baseUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/api\/(manifest|device-heartbeat)\/?$/, '').replace(/\/+$/, '')}`;
  } catch { return null; }
}
export async function readDoctorEnv(file) {
  if (!util.parseEnv) throw new Error('Node 20.12+ is required for doctor env parsing.');
  // Explicit file only: never load .env.local, execute app config, expand shell variables,
  // or mutate process.env. Docker evaluates its own env file when starting the service.
  return util.parseEnv(await fs.readFile(file, 'utf8'));
}
export function parseDoctorArgs(argv) {
  const options = { mode: 'docker', timeout: 5000, composeFiles: [] };
  const values = new Map([['--mode', 'mode'], ['--server-env', 'serverEnv'], ['--app', 'app'], ['--certificate', 'certificate'], ['--timeout', 'timeout'], ['--compose-file', 'composeFile'], ['--project', 'project']]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--offline', '--json', '--help'].includes(arg)) { options[arg.slice(2)] = true; continue; }
    const key = values.get(arg);
    const value = argv[++index];
    if (!key || !value || value.startsWith('--')) throw new Error('Invalid doctor arguments. Use --help.');
    if (key === 'composeFile') options.composeFiles.push(value); else options[key] = value;
  }
  options.timeout = Number(options.timeout);
  if (!['docker', 'remote'].includes(options.mode) || !Number.isInteger(options.timeout) || options.timeout < 500 || options.timeout > 30000) throw new Error('Use --mode docker|remote and --timeout between 500 and 30000 milliseconds.');
  if (options.mode === 'remote' && (options.project || options.composeFiles.length)) throw new Error('Compose options require --mode docker.');
  return options;
}

async function inspectApplication(appRoot, serverUrl, add) {
  let certificate;
  const dynamic = await Promise.all(['ts', 'js', 'mjs', 'cjs'].map((extension) => exists(path.join(appRoot, `app.config.${extension}`))));
  if (dynamic.some(Boolean)) {
    add('app.config', 'fail', 'Dynamic app.config.* cannot be verified by the static configurator/publisher.', 'Doctor does not execute app code. Use manual client integration and a publishing flow that supports your dynamic configuration.');
    return {};
  }
  let expo, pkg;
  try {
    expo = (await readJson(path.join(appRoot, 'app.json'))).expo;
    pkg = await readJson(path.join(appRoot, 'package.json'));
    if (!expo || !pkg) throw new Error('config');
    add('app.config', 'pass', 'Static Expo configuration and package.json are readable.');
  } catch {
    add('app.config', 'fail', 'App directory needs valid app.json and package.json.', 'Pass --app with the Expo application directory.');
    return {};
  }
  const require = createRequire(path.join(appRoot, 'package.json'));
  const dependencies = ['expo', 'expo-updates', 'expo-application', 'expo-crypto', 'expo-secure-store', '@react-native-async-storage/async-storage'];
  const missing = dependencies.filter((name) => {
    if (!pkg.dependencies?.[name]) return true;
    try { require.resolve(name); return false; } catch { return true; }
  });
  add('app.dependencies', missing.length ? 'fail' : 'pass', missing.length ? `Missing client dependencies: ${missing.join(', ')}.` : 'Client dependencies are declared and resolvable.', missing.length ? 'Run configure-app or install the documented Expo-compatible client dependencies in the app.' : undefined);
  const clientFiles = ['index.ts', 'types.ts', 'runtime.ts', 'controller.ts', 'device-identity.ts', 'model/update-controller.ts', 'model/hooks/useOtaUpdates.ts', 'ui/ota-updates.tsx', 'ui/ota-update-gate.tsx'];
  const clientFilesPresent = (await Promise.all(clientFiles.map((file) => exists(path.join(appRoot, 'ota-client', file))))).every(Boolean);
  add('app.client', clientFilesPresent ? 'pass' : 'fail', clientFilesPresent ? 'Generated client implementation files are present.' : 'Generated client implementation files are incomplete.', clientFilesPresent ? undefined : 'Run configure-app or copy the complete ota-client directory using the manual integration guide.');
  const updates = expo.updates || {};
  const channel = updates.requestHeaders?.['expo-channel-name'];
  const runtime = expo.runtimeVersion?.policy === 'appVersion' ? expo.version : expo.runtimeVersion;
  const configured = updates.enabled !== false && typeof channel === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(channel) && typeof runtime === 'string' && runtime.length > 0 && runtime.length <= 100 && runtime === runtime.trim();
  add('app.scope', configured ? 'pass' : 'fail', configured ? 'OTA is enabled with a channel and supported runtime.' : 'OTA is disabled or channel/runtime configuration is missing.', configured ? undefined : 'Use a lowercase channel (letters/numbers/dot/underscore/hyphen, up to 64 characters) and a nonempty runtime up to 100 characters without surrounding whitespace.');
  for (const platform of ['ios', 'android']) {
    if (expo[platform]?.updates || expo[platform]?.runtimeVersion) add(`app.${platform}-overrides`, 'warn', 'Platform-specific update/runtime overrides need manual verification.', 'The bundled publisher reads the top-level app.json scope. Verify the installed native scope and export match.');
  }
  const appBase = baseUrl(updates.url);
  const expectedManifest = appBase && `${appBase}/api/manifest`;
  const urlMatches = expectedManifest && updates.url?.replace(/\/+$/, '') === expectedManifest && (!serverUrl || appBase === baseUrl(serverUrl));
  add('app.url', urlMatches ? 'pass' : 'fail', urlMatches ? 'Manifest URL matches the configured server (when available).' : 'Manifest URL is invalid or differs from the server public URL.', urlMatches ? undefined : 'Use the server OTA_PUBLIC_BASE_URL plus /api/manifest. Rebuild native binaries after changing the URL.');
  add('app.native-checks', updates.checkAutomatically === 'NEVER' ? 'pass' : 'fail', updates.checkAutomatically === 'NEVER' ? 'Native automatic checks are disabled for hook orchestration.' : 'Native automatic checks can bypass the hook lifecycle.', updates.checkAutomatically === 'NEVER' ? undefined : 'Set expo.updates.checkAutomatically to NEVER and rebuild.');
  if (typeof updates.codeSigningCertificate === 'string') certificate = path.resolve(appRoot, updates.codeSigningCertificate);
  add('app.signing-config', certificate && updates.codeSigningMetadata?.alg === 'rsa-v1_5-sha256' && updates.codeSigningMetadata?.keyid === 'main' ? 'pass' : 'fail', 'App signing requires a certificate, rsa-v1_5-sha256 and keyid main.', 'Use configure-app to set the certificate and signing metadata.');
  try {
    const config = await readJson(path.join(appRoot, 'ota-client/config.json'));
    if (typeof config.identityNamespace !== 'string' || !config.identityNamespace.trim() || config.channel !== channel || config.heartbeatUrl !== `${appBase}/api/device-heartbeat`) throw new Error('client');
    add('app.identity', 'pass', 'Identity namespace, telemetry endpoint and channel are configured.');
  } catch {
    add('app.identity', 'fail', 'Client config is missing or differs from the app scope/endpoint.', 'Review ota-client/config.json. Preserve identityNamespace when changing a tunnel URL; do not regenerate it for every runtime.');
  }
  try {
    let originalEntry = pkg.main || '__platform_default__';
    if (['ota-entry.js', './ota-entry.js'].includes(originalEntry)) {
      originalEntry = (await readJson(path.join(appRoot, 'ota-client-entry.json'))).originalEntry;
      if (!(await fs.readFile(path.join(appRoot, 'ota-entry.js'), 'utf8')).includes('.start()')) throw new Error('entry');
    }
    const { planOtaRootHook } = await import('./ota-root-hook-patcher.mjs');
    const plan = planOtaRootHook({ appRoot, originalEntry });
    if (!plan.files.length) {
      add('app.root', 'warn', 'Custom entry/root cannot be verified automatically.', 'Verify one unconditional useOtaUpdates call and a mounted OtaUpdateGate in the actual root.');
    } else {
      const changes = await Promise.all(plan.files.map(async ([file, content]) => content !== await fs.readFile(path.join(appRoot, file), 'utf8')));
      if (changes.some(Boolean)) throw new Error('root');
      add('app.root', 'pass', 'Recognized root OTA component wiring is present (source inspection only).');
    }
  } catch {
    add('app.root', 'fail', 'Root OTA component or bootstrap metadata is missing or unsupported.', 'Run configure-app or review manual component integration. Doctor never applies the patch.');
  }
  try {
    const publisher = await readDoctorEnv(path.join(appRoot, '.env.ota'));
    let databaseUrlValid = false;
    try { const url = new URL(publisher.OTA_DATABASE_URL); databaseUrlValid = ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname && url.pathname.length > 1) && present(publisher.OTA_DATABASE_URL); } catch { /* Fixed diagnostic below. */ }
    const configured = databaseUrlValid && Boolean(baseUrl(publisher.R2_ENDPOINT)) && ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].every((key) => present(publisher[key]));
    add('app.publisher', configured && Boolean(pkg.scripts?.['ota:publish']) ? 'pass' : 'fail', configured ? 'Publisher credentials are present; permissions were not exercised.' : 'Publisher database/storage credentials are incomplete.', 'Keep existing .env.ota; fill missing values. An access token does not replace publisher DB/S3 credentials.');
    const publisherChannel = publisher.EXPO_UPDATE_CHANNEL?.trim().toLowerCase();
    if (publisherChannel && publisherChannel !== channel) add('app.publisher-channel', 'fail', 'Publisher channel differs from the native app channel.', 'Align EXPO_UPDATE_CHANNEL with expo-channel-name.');
    if (publisher.OTA_SERVER_URL && baseUrl(publisher.OTA_SERVER_URL) !== appBase) add('app.registration-url', 'fail', 'Registrar URL differs from the app/server URL.', 'Align OTA_SERVER_URL in .env.ota with the public server base.');
    const registration = databaseUrlValid || (present(publisher.OTA_ACCESS_TOKEN) && Boolean(baseUrl(publisher.OTA_SERVER_URL)));
    add('app.registration', registration ? 'pass' : 'fail', registration ? 'Embedded registration credentials are present (scope/permissions not exercised).' : 'No usable embedded registration credentials found.', registration ? undefined : 'Set OTA_DATABASE_URL or OTA_SERVER_URL + OTA_ACCESS_TOKEN with updates:write.');
  } catch {
    add('app.publisher', 'fail', 'App .env.ota is missing or unreadable.', 'Create it from .env.ota.example only if absent, then fill publisher and registrar credentials.');
  }
  add('app.native-build', 'warn', 'Source configuration does not prove what is installed on the phone.', 'Build/install a native release after native configuration changes. Include manual download/reload controls or enable hook automation before the first build.');
  return { certificate };
}

export async function runDoctor(rawOptions = {}, dependencies = {}) {
  const options = { mode: 'docker', timeout: 5000, composeFiles: [], ...rawOptions };
  const cwd = path.resolve(options.cwd || process.cwd());
  const checks = [];
  const add = (id, status, message, remedy) => checks.push({ id, status, message, ...(remedy ? { remedy } : {}) });
  const finish = () => ({ version: 1, mode: options.mode, offline: Boolean(options.offline), status: checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass', checks });
  if (!util.parseEnv) { add('runtime.node', 'fail', 'Doctor requires Node.js 20.12+ (recommended project runtime: Node.js 24).', 'Update Node.js before running doctor.'); return finish(); }
  add('runtime.node', 'pass', 'Node.js supports the required env parser.');
  const require = createRequire(path.join(cwd, 'package.json'));
  for (const name of ['typescript', 'pg', '@aws-sdk/client-s3']) {
    try { require.resolve(name); add(`dependencies.${name}`, 'pass', `Server dependency ${name} is available.`); }
    catch { add(`dependencies.${name}`, 'fail', `Server dependency ${name} is missing.`, 'Run npm ci in the server directory.'); }
  }
  let env;
  const envPath = path.resolve(cwd, options.serverEnv || (options.mode === 'docker' ? '.env' : '.env.local'));
  try { env = await readDoctorEnv(envPath); add('server.env', 'pass', 'Selected env file is readable. Ambient server credentials are not merged.'); }
  catch { add('server.env', 'fail', 'Selected server env file is missing or unreadable.', 'Pass --server-env with a valid file; create it from the appropriate example if absent.'); return finish(); }
  if (Object.values(env).some((value) => /\$\{[^}]+\}/.test(value))) add('server.env-expansion', 'warn', 'Env interpolation is present and is not evaluated by static diagnostics.', 'Use explicit values for remote mode. Docker online probes inspect the actual running process environment.');
  let result;
  if (options.mode === 'docker' && !options.offline) {
    const args = ['compose', '--env-file', envPath];
    if (options.project) args.push('--project-name', options.project);
    for (const file of options.composeFiles.length ? options.composeFiles : ['docker-compose.yml']) args.push('--file', path.resolve(cwd, file));
    const script = `const probe = ${probeServer.toString()}; process.stdout.write(JSON.stringify(await probe({env: process.env, timeout: ${options.timeout}})));`;
    // Forward only execution/Docker context settings, never arbitrary application env overrides.
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|TMPDIR|SystemRoot|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|SSH_AUTH_SOCK|XDG_RUNTIME_DIR)$/.test(key)));
    try {
      const output = await (dependencies.exec || exec)('docker', [...args, 'exec', '-T', 'app', 'node', '--input-type=module', '-e', script], { cwd, env: childEnv, timeout: options.timeout * 12 + 10000, maxBuffer: 1024 * 1024 });
      result = JSON.parse(output.stdout);
      if (!Array.isArray(result.checks)) throw new Error('probe');
      add('docker.app', 'pass', 'Read-only probes executed as the running app container user.');
      if (env.OTA_PUBLIC_BASE_URL && baseUrl(env.OTA_PUBLIC_BASE_URL) !== baseUrl(result.publicUrl)) add('docker.env-drift', 'fail', 'Running container public URL differs from the selected env file.', 'Check Compose overrides and recreate the app after reviewing the environment change.');
    } catch {
      add('docker.app', 'fail', 'Cannot run probes in the selected app container.', 'Check Docker availability, project/files, and that service app is running. Use --offline to inspect files before startup.');
    }
  } else {
    let configured = { ...env };
    if (options.mode === 'docker') {
      configured = { ...env, DATABASE_PROVIDER: 'pg',
        R2_ENDPOINT: `http://127.0.0.1:${env.MINIO_API_PORT || '9000'}`, R2_ACCESS_KEY_ID: env.MINIO_ROOT_USER || 'expo_updates', R2_SECRET_ACCESS_KEY: env.MINIO_ROOT_PASSWORD,
        OTA_PUBLIC_BASE_URL: env.OTA_PUBLIC_BASE_URL || 'http://localhost:3000', CODE_SIGNING_PRIVATE_KEY_PATH: path.join(cwd, 'secrets/code-signing-private-key.pem') };
      configured.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER || 'expo_updates')}:${encodeURIComponent(env.POSTGRES_PASSWORD || '')}@127.0.0.1:${env.POSTGRES_PORT || '5432'}/${encodeURIComponent(env.POSTGRES_DB || 'expo_updates')}`;
      add('docker.offline', 'skip', 'Container permissions, actual Compose overrides and connectivity are not checked offline.');
      if (!present(env.POSTGRES_PASSWORD) || !present(env.MINIO_ROOT_PASSWORD)) add('docker.credentials', 'fail', 'Docker database/storage passwords are missing or placeholders.', 'Set separate strong POSTGRES_PASSWORD and MINIO_ROOT_PASSWORD values.');
    } else if (configured.CODE_SIGNING_PRIVATE_KEY_PATH) configured.CODE_SIGNING_PRIVATE_KEY_PATH = path.resolve(cwd, configured.CODE_SIGNING_PRIVATE_KEY_PATH);
    result = await (dependencies.probe || probeServer)({ env: configured, timeout: options.timeout, network: !options.offline });
  }
  if (options.mode === 'docker' && ['POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD'].some((key) => env[key] && /[^a-zA-Z0-9_-]/.test(env[key]))) add('docker.env-characters', 'warn', 'Docker passwords contain characters requiring env/URI escaping.', 'Current Compose/configurator handling is limited. Verify credentials round-trip correctly; random hex passwords avoid the known interpolation issue.');
  if (result) checks.push(...result.checks);
  const serverUrl = result?.publicUrl || env.OTA_PUBLIC_BASE_URL;
  if (!options.offline && baseUrl(serverUrl)) {
    try {
      const response = await (dependencies.fetch || fetch)(`${baseUrl(serverUrl)}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(options.timeout) });
      const body = await response.json();
      if (!response.ok || body.status !== 'ok' || body.checks?.database !== 'ok') throw new Error('health');
      add('server.health', 'pass', 'Public health endpoint is reachable from this host and reports database readiness.');
    } catch {
      add('server.health', 'fail', 'Public health endpoint is unreachable, redirected, invalid or unhealthy.', 'Check server startup, HTTPS/proxy/tunnel access and OTA_PUBLIC_BASE_URL. Device endpoints must not require browser sign-in.');
    }
  } else add('server.health', 'skip', 'Public health probe skipped (offline mode or invalid URL).');
  let app = {};
  if (options.app) app = await inspectApplication(path.resolve(cwd, options.app), serverUrl, add);
  else add('app.config', 'skip', 'No application selected. Use --app to verify client integration.');
  const certificatePath = options.certificate ? path.resolve(cwd, options.certificate) : app.certificate;
  if (certificatePath) {
    try {
      const cert = new X509Certificate(await fs.readFile(certificatePath));
      const now = Date.now();
      if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo) || cert.publicKey.asymmetricKeyType !== 'rsa' || cert.publicKey.asymmetricKeyDetails.modulusLength < 2048 || cert.ca) throw new Error('certificate');
      const details = await exec('openssl', ['x509', '-in', certificatePath, '-noout', '-text'], { timeout: options.timeout, maxBuffer: 1024 * 1024 });
      if (!/X509v3 Key Usage:[^\n]*\n\s*Digital Signature\b/.test(details.stdout)
        || !/X509v3 Extended Key Usage:[^\n]*\n\s*(?:[^\n]*,\s*)?Code Signing\b/.test(details.stdout)) throw new Error('certificate usage');
      add('signing.certificate', 'pass', 'Public RSA certificate is valid, current, non-CA and allows Digital Signature / Code Signing.');
      const fingerprint = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
      if (result?.keyFingerprint) add('signing.match', fingerprint === result.keyFingerprint ? 'pass' : 'fail', fingerprint === result.keyFingerprint ? 'App certificate matches the server signing key.' : 'Certificate and server signing key do not match.', fingerprint === result.keyFingerprint ? undefined : 'Use the matching certificate/key pair. Changing the app certificate requires a native rebuild.');
      else add('signing.match', 'skip', 'Cannot compare certificate without a readable server key.');
      if (options.certificate && app.certificate && path.resolve(cwd, options.certificate) !== app.certificate) add('signing.override', 'warn', 'Explicit certificate overrides the app certificate for comparison.', 'Omit --certificate to verify the certificate referenced by app.json.');
    } catch { add('signing.certificate', 'fail', 'Public certificate is missing, invalid, expired, not yet valid or unsuitable.', 'Install OpenSSL and use a current non-CA RSA certificate (at least 2048 bits) with Digital Signature and Code Signing usage, matching the server key.'); }
  } else add('signing.certificate', 'skip', 'No certificate selected. Use --certificate or --app to compare signing keys.');
  return finish();
}

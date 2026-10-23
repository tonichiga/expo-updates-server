#!/usr/bin/env node
import { parseDoctorArgs, runDoctor } from './lib/doctor.mjs';

const help = `Read-only OTA setup diagnostics. No files, database rows or releases are changed.

Usage: npm run doctor -- [options]
  --mode docker|remote  Docker app container or explicit remote env (default: docker)
  --server-env PATH     Exact env file (default: .env for Docker, .env.local for remote)
  --app PATH            Check a static app.json Expo application and .env.ota
  --certificate PATH    Public certificate (defaults to app.json certificate)
  --offline             Check files only; no Docker execution or network probes
  --compose-file PATH   Compose file, repeatable (default: docker-compose.yml)
  --project NAME        Docker Compose project name
  --timeout MS          Per-operation timeout, 500–30000 (default: 5000)
  --json                Structured JSON without credentials (use npm run --silent)
  --help                Show help

Run from the server directory with Node.js 20.12+ (project recommendation: 24).
Exit 0: no detected blockers (warnings/skips may remain). Exit 1: failed checks.
Exit 2: invalid arguments or unexpected diagnostic failure.
No dynamic app config is executed. Phone reachability/native binary state and
publisher write permissions still require a real device/release test.`;
let options;
try { options = parseDoctorArgs(process.argv.slice(2)); }
catch (error) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ version: 1, status: 'fail', checks: [{ id: 'cli.arguments', status: 'fail', message: error.message }] }));
  else console.error(error.message);
  process.exitCode = 2;
}
if (options) {
  if (options.help) console.log(help);
  else {
    try {
      const result = await runDoctor(options);
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`OTA doctor — ${result.mode}${result.offline ? ' (offline)' : ''}`);
        for (const check of result.checks) {
          console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
          if (check.remedy && check.status !== 'pass') console.log(`  → ${check.remedy}`);
        }
        console.log(`\nResult: ${result.status}. Passes cover only the checks above; warnings/skips are not proof of readiness.`);
      }
      process.exitCode = result.status === 'fail' ? 1 : 0;
    } catch {
      const failure = { version: 1, status: 'fail', checks: [{ id: 'doctor.internal', status: 'fail', message: 'Diagnostic execution failed. Check runtime, dependencies and file permissions; no raw exception is printed to avoid disclosing secrets.' }] };
      console.log(options.json ? JSON.stringify(failure) : failure.checks[0].message);
      process.exitCode = 2;
    }
  }
}

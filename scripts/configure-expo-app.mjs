#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { configureExpoApp } from "./lib/expo-app-configurator.mjs";
import { collectInteractiveOptions } from "./lib/expo-app-prompts.mjs";

function printHelp() {
  console.log(`
Configure an Expo application for this OTA server.

Interactive usage:
  npm run configure-app

Usage:
  npm run configure-app -- \\
    --app /path/to/expo-app \\
    --certificate /path/to/code-signing-certificate.pem \\
    --server-url https://updates.example.com \\
    --channel production \\
    --runtime-version 1.0.0

Required:
  --app              Expo application root containing app.json
  --certificate      Public PEM code-signing certificate
  --server-url       OTA server base URL or /api/manifest URL
  --channel          Expo update channel
  --runtime-version  Native runtime version

Optional:
  --platform         all, ios or android (default: all)
  --server-env       Local Docker env file (default: server .env)
  --force            Replace generated client, publisher and certificate files
  --help             Show this message
`);
}

function parseArgs(argv) {
  const options = {
    platform: "all",
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") {
      return { help: true };
    }
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;

    if (key === "server-env") options.serverEnv = value;
    else if (key === "app") options.app = value;
    else if (key === "certificate") options.certificate = value;
    else if (key === "server-url") options.serverUrl = value;
    else if (key === "channel") options.channel = value;
    else if (key === "runtime-version") options.runtimeVersion = value;
    else if (key === "platform") options.platform = value;
    else throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

try {
  const argv = process.argv.slice(2);
  let options = parseArgs(argv);
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const requiredValues = [
    options.app,
    options.certificate,
    options.serverUrl,
    options.channel,
    options.runtimeVersion,
  ];

  if (requiredValues.some((value) => !value)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      printHelp();
      throw new Error(
        "Missing required options and interactive input is unavailable.",
      );
    }

    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      options = await collectInteractiveOptions(options, {
        ask: (question) => readline.question(question),
        serverRoot: process.cwd(),
      });
    } finally {
      readline.close();
    }
  }

  const result = configureExpoApp(options);
  console.log("\nExpo OTA configuration completed.");
  console.log(`Application: ${result.appRoot}`);
  console.log(`Manifest: ${result.manifestUrl}`);
  console.log(`Channel: ${result.channel}`);
  console.log(`Runtime: ${result.runtimeVersion}`);
  console.log(`Platform: ${result.platform}`);
  console.log(
    `Publisher environment: ${
      result.publisherEnvConfigured
        ? "configured from local Docker .env"
        : "verify .env.ota credentials; create from .env.ota.example only if missing"
    }`,
  );
  if (result.migrationWarnings.length > 0) {
    console.warn("\nMigration warnings:");
    for (const warning of result.migrationWarnings) {
      console.warn(`- ${warning}`);
    }
  }
  console.log("\nNext:");
  let step = 1;
  if (!result.publisherEnvConfigured) {
    console.log(`${step++}. Keep any existing .env.ota; create it from .env.ota.example only if missing, then verify publisher/registration credentials.`);
  }
  console.log(`${step++}. In the app, add manual check/download/reload controls or enable hook automation before building. The generated root only auto-checks by default.`);
  console.log(`${step++}. Build and install a native binary with telemetry dependencies: npm run ota:build:android:apk or Xcode for iOS. Do this before delivering ota-client via OTA.`);
  console.log(`${step++}. Publish with: npm run ota:publish -- --message "Update description"`);
  console.log(`${step++}. Activate the update in the OTA admin panel.`);
} catch (error) {
  console.error(`Expo OTA configuration failed: ${error.message}`);
  process.exit(1);
}

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LEGACY_GENERATED_FILE_SHA256 = {
  embeddedRegistrars: [
    "29c48288d4804c072129da0ef60a12ad0892809eb8d57a14be94d039d990d6d7",
    "89997ef11a939ce00e65159bd8e04845f16b184d5192f8fb56b1bc4204b07bca",
  ],
  androidRegistrar:
    "45a0fddd24600d109359e90ea1f347c70b411307ec232beba22dd71d8c369fe4",
  iosRegistrar:
    "21e4a557a49feb40bbc391db5d44c64962fdb7d9db86394c477379861e571116",
  canonicalIosRegistrars: [
    "37e0edac0397e5dc1d48d1641a8ed1f113495e3d24ce1d3c66c62e31c0ca7198",
  ],
  xcodeCloudHook:
    "3dd1d92a782de37b8efd40662624dce21bc3d1b30442ee8dc1dd7d4c3a7b7823",
  iosPlugin:
    "9bd619449c3f2f6c91628bd0de885c60eab41fbecbae9420781d7929d83df844",
};
const ANDROID_REGISTER_SCRIPT =
  "scripts/ota-register-embedded/register-android.sh";
const LEGACY_ANDROID_REGISTER_SCRIPT =
  "scripts/ota-register-embedded/android-register-embedded-update.sh";
const PUBLISHER_DEPENDENCIES = [
  "@aws-sdk/client-s3",
  "dotenv",
  "pg",
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON file ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRequired(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function resolveManifestUrl(value) {
  const raw = normalizeRequired(value, "--server-url");
  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error("--server-url must be a valid HTTP or HTTPS URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--server-url must use HTTP or HTTPS.");
  }

  if (url.search || url.hash) {
    throw new Error("--server-url must not contain query parameters or a hash.");
  }

  const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, "");
  url.pathname =
    pathWithoutTrailingSlash.endsWith("/api/manifest")
      ? pathWithoutTrailingSlash
      : `${pathWithoutTrailingSlash}/api/manifest`.replace(/\/+/g, "/");

  return url.toString().replace(/\/$/, "");
}

function validateCertificate(certificatePath) {
  if (!fs.existsSync(certificatePath)) {
    throw new Error(`Certificate not found: ${certificatePath}`);
  }

  const content = fs.readFileSync(certificatePath, "utf8");
  if (!content.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error(
      "--certificate must point to a public PEM certificate, not a private key.",
    );
  }

  let certificateDetails;
  try {
    certificateDetails = execFileSync(
      "openssl",
      ["x509", "-in", certificatePath, "-noout", "-text"],
      { encoding: "utf8" },
    );
  } catch {
    throw new Error(
      "--certificate must be a valid X.509 PEM certificate readable by OpenSSL.",
    );
  }

  const hasDigitalSignature =
    /X509v3 Key Usage:[^\n]*\n\s*Digital Signature\b/.test(
      certificateDetails,
    );
  const hasCodeSigning =
    /X509v3 Extended Key Usage:[^\n]*\n\s*(?:[^\n]*,\s*)?Code Signing\b/.test(
      certificateDetails,
    );
  if (!hasDigitalSignature || !hasCodeSigning) {
    throw new Error(
      "--certificate must include X509v3 Key Usage: Digital Signature and Extended Key Usage: Code Signing.",
    );
  }
}

function detectPackageManager(appRoot) {
  if (fs.existsSync(path.join(appRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(appRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (
    fs.existsSync(path.join(appRoot, "bun.lock")) ||
    fs.existsSync(path.join(appRoot, "bun.lockb"))
  ) {
    return "bun";
  }
  return "npm";
}

function getPackageCommands(packageManager, platform) {
  const prebuildArgs = ["expo", "prebuild"];
  if (platform !== "all") {
    prebuildArgs.push("--platform", platform);
  }

  if (packageManager === "pnpm") {
    return {
      installExpoUpdates: ["pnpm", ["exec", "expo", "install", "expo-updates"]],
      installPublisherDependencies: [
        "pnpm",
        ["add", "--save-dev", ...PUBLISHER_DEPENDENCIES],
      ],
      prebuild: ["pnpm", ["exec", ...prebuildArgs]],
    };
  }

  if (packageManager === "yarn") {
    return {
      installExpoUpdates: ["yarn", ["expo", "install", "expo-updates"]],
      installPublisherDependencies: [
        "yarn",
        ["add", "--dev", ...PUBLISHER_DEPENDENCIES],
      ],
      prebuild: ["yarn", prebuildArgs],
    };
  }

  if (packageManager === "bun") {
    return {
      installExpoUpdates: ["bunx", ["expo", "install", "expo-updates"]],
      installPublisherDependencies: [
        "bun",
        ["add", "--dev", ...PUBLISHER_DEPENDENCIES],
      ],
      prebuild: ["bunx", prebuildArgs],
    };
  }

  return {
    installExpoUpdates: ["npx", ["expo", "install", "expo-updates"]],
    installPublisherDependencies: [
      "npm",
      ["install", "--save-dev", ...PUBLISHER_DEPENDENCIES],
    ],
    prebuild: ["npx", prebuildArgs],
  };
}

function stopAndroidGradleIfPresent(appRoot, platform, commandRunner) {
  if (platform === "ios") {
    return;
  }

  const androidRoot = path.join(appRoot, "android");
  const unixWrapper = path.join(androidRoot, "gradlew");
  const windowsWrapper = path.join(androidRoot, "gradlew.bat");
  const wrapper = fs.existsSync(unixWrapper)
    ? unixWrapper
    : fs.existsSync(windowsWrapper)
      ? windowsWrapper
      : null;

  if (wrapper) {
    commandRunner(wrapper, ["--stop"], androidRoot);
  }
}

function assertCopyAllowed(source, destination, force) {
  if (fs.existsSync(destination) && !force) {
    const current = fs.readFileSync(destination);
    const next = fs.readFileSync(source);
    if (!current.equals(next)) {
      throw new Error(
        `Refusing to overwrite ${destination}. Re-run with --force.`,
      );
    }
  }
}

function getFileSha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function assertGeneratedCopyAllowed(
  source,
  destination,
  force,
  recognizedSha256 = [],
) {
  if (!fs.existsSync(destination) || force) {
    return;
  }

  const current = fs.readFileSync(destination);
  const next = fs.readFileSync(source);
  if (current.equals(next)) {
    return;
  }

  if (recognizedSha256.includes(getFileSha256(destination))) {
    return;
  }

  throw new Error(
    `Refusing to overwrite ${destination}. Re-run with --force.`,
  );
}

function planLegacyFileMigration(
  filePath,
  generatedSha256,
  description,
  warnings,
) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  if (getFileSha256(filePath) === generatedSha256) {
    return { filePath, generatedSha256, description };
  }

  warnings.push(
    `Preserved customized legacy ${description} at ${filePath}. Remove it manually after verifying the canonical registration scripts.`,
  );
  return null;
}

function removeLegacyGeneratedFile(migration, warnings) {
  if (!migration || !fs.existsSync(migration.filePath)) {
    return;
  }

  if (getFileSha256(migration.filePath) !== migration.generatedSha256) {
    warnings.push(
      `Preserved ${migration.description} at ${migration.filePath} because it changed during configuration.`,
    );
    return;
  }

  fs.unlinkSync(migration.filePath);
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function listFilesRecursive(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}

function parseEnvFile(filePath) {
  const values = {};
  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function getLocalDockerPublisherEnv({
  channel,
  serverRoot,
  serverUrl,
}) {
  const hostname = new URL(serverUrl).hostname;
  const usesLocalDocker =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".devtunnels.ms");
  if (!usesLocalDocker) {
    return null;
  }

  const serverEnvPath = path.join(serverRoot, ".env");
  if (!fs.existsSync(serverEnvPath)) {
    return null;
  }

  const env = parseEnvFile(serverEnvPath);
  const databaseUser = env.POSTGRES_USER || "expo_updates";
  const databasePassword = env.POSTGRES_PASSWORD;
  const databaseName = env.POSTGRES_DB || "expo_updates";
  const databasePort = env.POSTGRES_PORT || "5432";
  const storageUser = env.MINIO_ROOT_USER || "expo_updates";
  const storagePassword = env.MINIO_ROOT_PASSWORD;
  const storagePort = env.MINIO_API_PORT || "9000";
  const bucket = env.OTA_STORAGE_BUCKET || "expo-updates";

  if (!databasePassword || !storagePassword) {
    return null;
  }

  const databaseUrl =
    `postgresql://${encodeURIComponent(databaseUser)}:` +
    `${encodeURIComponent(databasePassword)}@127.0.0.1:` +
    `${databasePort}/${encodeURIComponent(databaseName)}`;

  return [
    `EXPO_UPDATE_CHANNEL=${channel}`,
    `OTA_SERVER_URL=${serverUrl}`,
    "",
    `OTA_DATABASE_URL=${databaseUrl}`,
    "OTA_DATABASE_SSL=false",
    "",
    `R2_ENDPOINT=http://127.0.0.1:${storagePort}`,
    `R2_ACCESS_KEY_ID=${storageUser}`,
    `R2_SECRET_ACCESS_KEY=${storagePassword}`,
    `R2_BUCKET=${bucket}`,
    "R2_REGION=us-east-1",
    "S3_FORCE_PATH_STYLE=true",
    "",
  ].join("\n");
}

function appendGitignore(appRoot) {
  const filePath = path.join(appRoot, ".gitignore");
  const current = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "";
  const requiredEntries = [".env.ota", ".ota-dist/"];
  const lines = new Set(current.split(/\r?\n/));
  const missing = requiredEntries.filter((entry) => !lines.has(entry));

  if (missing.length === 0) {
    return;
  }

  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(filePath, `${prefix}${missing.join("\n")}\n`, "utf8");
}

function patchAppJson(appJson, options) {
  const expo = appJson.expo;
  expo.runtimeVersion = options.runtimeVersion;
  expo.updates = {
    ...(expo.updates || {}),
    enabled: true,
    url: options.manifestUrl,
    checkAutomatically: "NEVER",
    fallbackToCacheTimeout: 0,
    codeSigningCertificate:
      "./certificates/code-signing-certificate.pem",
    codeSigningMetadata: {
      alg: "rsa-v1_5-sha256",
      keyid: "main",
    },
    requestHeaders: {
      ...(expo.updates?.requestHeaders || {}),
      "expo-channel-name": options.channel,
    },
  };
  expo.extra = {
    ...(expo.extra || {}),
    updateChannel: options.channel,
  };
  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  if (!plugins.includes("./plugins/with-ota-embedded-registration")) {
    expo.plugins = [
      ...plugins,
      "./plugins/with-ota-embedded-registration",
    ];
  }

  return appJson;
}

function patchPackageJson(packageJson, platform) {
  packageJson.scripts = {
    ...(packageJson.scripts || {}),
    "ota:publish": "node scripts/ota-publish/index.mjs",
  };
  for (const scriptName of [
    "ota:build:android:apk",
    "ota:build:android:aab",
  ]) {
    if (
      typeof packageJson.scripts[scriptName] === "string" &&
      packageJson.scripts[scriptName].includes(
        LEGACY_ANDROID_REGISTER_SCRIPT,
      )
    ) {
      packageJson.scripts[scriptName] = packageJson.scripts[
        scriptName
      ].replace(LEGACY_ANDROID_REGISTER_SCRIPT, ANDROID_REGISTER_SCRIPT);
    }
  }
  if (platform !== "ios") {
    packageJson.scripts["ota:build:android:apk"] =
      `cd android && ./gradlew app:assembleRelease && cd .. && OTA_EMBEDDED_REGISTER_STRICT=true sh ${ANDROID_REGISTER_SCRIPT}`;
    packageJson.scripts["ota:build:android:aab"] =
      `cd android && ./gradlew app:bundleRelease && cd .. && OTA_EMBEDDED_REGISTER_STRICT=true sh ${ANDROID_REGISTER_SCRIPT}`;
  }
  return packageJson;
}

function patchPublisherEnvExample(filePath, channel) {
  const current = fs.readFileSync(filePath, "utf8");
  const next = current.replace(
    /^EXPO_UPDATE_CHANNEL=.*$/m,
    `EXPO_UPDATE_CHANNEL=${channel}`,
  );
  fs.writeFileSync(filePath, next, "utf8");
}

function validateProject(appRoot) {
  const packagePath = path.join(appRoot, "package.json");
  const appJsonPath = path.join(appRoot, "app.json");

  if (!fs.existsSync(packagePath)) {
    throw new Error(`Expo package.json not found in ${appRoot}`);
  }
  if (!fs.existsSync(appJsonPath)) {
    throw new Error(`Static Expo app.json not found in ${appRoot}`);
  }

  const dynamicConfig = [
    "app.config.js",
    "app.config.cjs",
    "app.config.mjs",
    "app.config.ts",
  ].find((fileName) => fs.existsSync(path.join(appRoot, fileName)));

  if (dynamicConfig) {
    throw new Error(
      `${dynamicConfig} overrides app.json. This CLI mode supports static app.json only.`,
    );
  }

  const packageJson = readJson(packagePath);
  const appJson = readJson(appJsonPath);

  if (!packageJson.dependencies?.expo && !packageJson.devDependencies?.expo) {
    throw new Error("The target package.json does not contain Expo.");
  }
  if (!appJson.expo || typeof appJson.expo !== "object") {
    throw new Error("app.json must contain an expo object.");
  }

  return { packagePath, appJsonPath, packageJson, appJson };
}

export function createCommandRunner() {
  return (command, args, cwd) => {
    execFileSync(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
  };
}

export function configureExpoApp(
  rawOptions,
  {
    commandRunner = createCommandRunner(),
    templateRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../templates/expo-app",
    ),
    serverRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    ),
  } = {},
) {
  const appRoot = path.resolve(
    normalizeRequired(rawOptions.app, "--app"),
  );
  const certificatePath = path.resolve(
    normalizeRequired(rawOptions.certificate, "--certificate"),
  );
  const channel = normalizeRequired(rawOptions.channel, "--channel")
    .toLowerCase();
  const runtimeVersion = normalizeRequired(
    rawOptions.runtimeVersion,
    "--runtime-version",
  );
  const platform = rawOptions.platform || "all";
  const force = rawOptions.force === true;

  if (!CHANNEL_PATTERN.test(channel)) {
    throw new Error(
      "--channel must start with a letter or number and contain only lowercase letters, numbers, dots, underscores or hyphens.",
    );
  }
  if (runtimeVersion.length > 100) {
    throw new Error("--runtime-version must contain at most 100 characters.");
  }
  if (!["all", "ios", "android"].includes(platform)) {
    throw new Error("--platform must be all, ios or android.");
  }

  validateCertificate(certificatePath);
  const manifestUrl = resolveManifestUrl(rawOptions.serverUrl);
  const project = validateProject(appRoot);
  const packageManager = detectPackageManager(appRoot);
  const commands = getPackageCommands(packageManager, platform);
  const certificateDestination = path.join(
    appRoot,
    "certificates",
    "code-signing-certificate.pem",
  );
  const publisherSource = path.join(
    templateRoot,
    "scripts",
    "ota-publish",
    "index.mjs",
  );
  const publisherDestination = path.join(
    appRoot,
    "scripts",
    "ota-publish",
    "index.mjs",
  );
  const exportCommandSource = path.join(
    templateRoot,
    "scripts",
    "ota-publish",
    "lib",
    "expo-export-command.mjs",
  );
  const exportCommandDestination = path.join(
    appRoot,
    "scripts",
    "ota-publish",
    "lib",
    "expo-export-command.mjs",
  );
  const envExampleSource = path.join(templateRoot, ".env.ota.example");
  const envExampleDestination = path.join(appRoot, ".env.ota.example");
  const registrarSource = path.join(
    templateRoot,
    "scripts",
    "ota-register-embedded",
    "index.mjs",
  );
  const registrarDestination = path.join(
    appRoot,
    "scripts",
    "ota-register-embedded",
    "index.mjs",
  );
  const androidRegistrarSource = path.join(
    templateRoot,
    "scripts",
    "ota-register-embedded",
    "register-android.sh",
  );
  const androidRegistrarDestination = path.join(
    appRoot,
    "scripts",
    "ota-register-embedded",
    "register-android.sh",
  );
  const legacyAndroidRegistrarDestination = path.join(
    appRoot,
    "scripts",
    "ota-register-embedded",
    "android-register-embedded-update.sh",
  );
  const iosPluginSource = path.join(
    templateRoot,
    "plugins",
    "with-ota-embedded-registration.js",
  );
  const iosPluginDestination = path.join(
    appRoot,
    "plugins",
    "with-ota-embedded-registration.js",
  );
  const iosRegisterSource = path.join(
    templateRoot,
    "scripts",
    "ota-register-embedded",
    "register-ios.sh",
  );
  const iosRegisterDestination = path.join(
    appRoot,
    "scripts",
    "ota-register-embedded",
    "register-ios.sh",
  );
  const legacyIosRegisterDestination = path.join(
    appRoot,
    "ci_scripts",
    "register-embedded-update.sh",
  );
  const xcodeCloudHookSource = path.join(
    templateRoot,
    "ci_scripts",
    "ci_post_xcodebuild.sh",
  );
  const xcodeCloudHookDestination = path.join(
    appRoot,
    "ci_scripts",
    "ci_post_xcodebuild.sh",
  );
  const publisherEnvDestination = path.join(appRoot, ".env.ota");
  const localPublisherEnv = getLocalDockerPublisherEnv({
    channel,
    serverRoot,
    serverUrl: manifestUrl,
  });
  const publisherTemplateRoot = path.join(
    templateRoot,
    "scripts",
    "ota-publish",
  );
  const publisherFiles = listFilesRecursive(publisherTemplateRoot).map(
    (source) => ({
      source,
      destination: path.join(
        appRoot,
        "scripts",
        "ota-publish",
        path.relative(publisherTemplateRoot, source),
      ),
    }),
  );
  const migrationWarnings = [];
  const legacyFileMigrations = [
    planLegacyFileMigration(
      legacyAndroidRegistrarDestination,
      LEGACY_GENERATED_FILE_SHA256.androidRegistrar,
      "Android registrar",
      migrationWarnings,
    ),
  ];
  if (platform !== "android") {
    legacyFileMigrations.push(
      planLegacyFileMigration(
        legacyIosRegisterDestination,
        LEGACY_GENERATED_FILE_SHA256.iosRegistrar,
        "iOS registrar",
        migrationWarnings,
      ),
    );
  }

  assertCopyAllowed(certificatePath, certificateDestination, force);
  assertCopyAllowed(publisherSource, publisherDestination, force);
  assertCopyAllowed(
    exportCommandSource,
    exportCommandDestination,
    force,
  );
  assertCopyAllowed(envExampleSource, envExampleDestination, force);
  for (const file of publisherFiles) {
    assertCopyAllowed(file.source, file.destination, force);
  }
  assertGeneratedCopyAllowed(
    registrarSource,
    registrarDestination,
    force,
    LEGACY_GENERATED_FILE_SHA256.embeddedRegistrars,
  );
  assertCopyAllowed(
    androidRegistrarSource,
    androidRegistrarDestination,
    force,
  );
  assertGeneratedCopyAllowed(
    iosPluginSource,
    iosPluginDestination,
    force,
    [LEGACY_GENERATED_FILE_SHA256.iosPlugin],
  );
  if (platform !== "android") {
    assertGeneratedCopyAllowed(
      iosRegisterSource,
      iosRegisterDestination,
      force,
      LEGACY_GENERATED_FILE_SHA256.canonicalIosRegistrars,
    );
    assertGeneratedCopyAllowed(
      xcodeCloudHookSource,
      xcodeCloudHookDestination,
      force,
      [LEGACY_GENERATED_FILE_SHA256.xcodeCloudHook],
    );
  }
  if (
    localPublisherEnv &&
    fs.existsSync(publisherEnvDestination) &&
    !force &&
    fs.readFileSync(publisherEnvDestination, "utf8") !== localPublisherEnv
  ) {
    throw new Error(
      `Refusing to overwrite ${publisherEnvDestination}. Re-run with --force.`,
    );
  }

  writeJson(
    project.appJsonPath,
    patchAppJson(project.appJson, {
      channel,
      runtimeVersion,
      manifestUrl,
      platform,
    }),
  );

  copyFile(certificatePath, certificateDestination);
  copyFile(publisherSource, publisherDestination);
  copyFile(exportCommandSource, exportCommandDestination);
  copyFile(envExampleSource, envExampleDestination);
  for (const file of publisherFiles) {
    copyFile(file.source, file.destination);
  }
  copyFile(registrarSource, registrarDestination);
  copyFile(androidRegistrarSource, androidRegistrarDestination);
  fs.chmodSync(androidRegistrarDestination, 0o755);
  copyFile(iosPluginSource, iosPluginDestination);
  patchPublisherEnvExample(envExampleDestination, channel);
  if (localPublisherEnv) {
    fs.writeFileSync(
      publisherEnvDestination,
      localPublisherEnv,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  appendGitignore(appRoot);

  commandRunner(...commands.installExpoUpdates, appRoot);

  const installedPackageJson = readJson(project.packagePath);
  writeJson(
    project.packagePath,
    patchPackageJson(installedPackageJson, platform),
  );

  commandRunner(...commands.installPublisherDependencies, appRoot);
  stopAndroidGradleIfPresent(appRoot, platform, commandRunner);
  commandRunner(...commands.prebuild, appRoot);
  if (platform !== "android") {
    copyFile(iosRegisterSource, iosRegisterDestination);
    copyFile(xcodeCloudHookSource, xcodeCloudHookDestination);
    fs.chmodSync(iosRegisterDestination, 0o755);
    fs.chmodSync(xcodeCloudHookDestination, 0o755);
  }
  for (const migration of legacyFileMigrations) {
    removeLegacyGeneratedFile(migration, migrationWarnings);
  }

  return {
    appRoot,
    certificatePath: certificateDestination,
    manifestUrl,
    channel,
    runtimeVersion,
    platform,
    packageManager,
    publisherEnvConfigured: Boolean(localPublisherEnv),
    migrationWarnings,
  };
}

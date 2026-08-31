import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const CONFIG_PATH = path.resolve(
  process.env.OTA_EMERGENCY_REDIRECT_CONFIG_PATH ||
    path.join(process.cwd(), "config/ota-emergency-channel-redirects.json"),
);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const key = argument.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    options[key] = value;
    index += 1;
  }

  return { command, options };
}

function readRules() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeRules(rules) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(rules, null, 2)}\n`, "utf8");
}

function printRules(rules) {
  if (rules.length === 0) {
    console.log("No emergency redirects configured.");
    return;
  }

  for (const rule of rules) {
    console.log(
      [
        `${rule.enabled ? "[enabled]" : "[disabled]"} ${rule.id}`,
        `  ${rule.platform} runtime=${rule.runtimeVersion}`,
        `  ${rule.fromChannel} -> ${rule.toChannel}`,
        `  target mode=${rule.targetMode}`,
        `  embedded=${rule.embeddedUpdateId}`,
        `  expected OTA=${rule.expectedUpdateId}`,
      ].join("\n"),
    );
  }
}

function required(options, key) {
  const value = options[key]?.trim();
  if (!value) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}

function assertUuid(name, value) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
}

function addRule(options) {
  const id = required(options, "id");
  const embeddedUpdateId = required(options, "embedded-update-id").toLowerCase();
  const runtimeVersion = required(options, "runtime-version");
  const platform = required(options, "platform").toLowerCase();
  const fromChannel = required(options, "from-channel").toLowerCase();
  const toChannel = required(options, "to-channel").toLowerCase();
  const expectedUpdateId = required(
    options,
    "expected-update-id",
  ).toLowerCase();
  const targetMode = (options["target-mode"] || "pinned").toLowerCase();

  assertUuid("embedded-update-id", embeddedUpdateId);
  assertUuid("expected-update-id", expectedUpdateId);

  if (platform !== "android" && platform !== "ios") {
    throw new Error("platform must be android or ios");
  }

  if (fromChannel === toChannel) {
    throw new Error("from-channel and to-channel must differ");
  }

  if (targetMode !== "pinned" && targetMode !== "follow") {
    throw new Error("target-mode must be pinned or follow");
  }

  const rules = readRules();
  if (rules.some((rule) => rule.id === id)) {
    throw new Error(`Rule already exists: ${id}`);
  }

  rules.push({
    id,
    enabled: true,
    embeddedUpdateId,
    runtimeVersion,
    platform,
    fromChannel,
    toChannel,
    targetMode,
    expectedUpdateId,
  });
  writeRules(rules);
  console.log(`Added emergency redirect: ${id}`);
}

function removeRule(options) {
  const id = required(options, "id");
  const rules = readRules();
  const nextRules = rules.filter((rule) => rule.id !== id);

  if (nextRules.length === rules.length) {
    throw new Error(`Rule not found: ${id}`);
  }

  writeRules(nextRules);
  console.log(`Removed emergency redirect: ${id}`);
}

function setRuleEnabled(options, enabled) {
  const id = required(options, "id");
  const rules = readRules();
  const rule = rules.find((candidate) => candidate.id === id);

  if (!rule) {
    throw new Error(`Rule not found: ${id}`);
  }

  rule.enabled = enabled;
  writeRules(rules);
  console.log(`${enabled ? "Enabled" : "Disabled"} emergency redirect: ${id}`);
}

function setRuleTargetMode(options, targetMode) {
  const id = required(options, "id");
  const rules = readRules();
  const rule = rules.find((candidate) => candidate.id === id);

  if (!rule) {
    throw new Error(`Rule not found: ${id}`);
  }

  if (targetMode === "pinned" && options["expected-update-id"]) {
    const expectedUpdateId = options["expected-update-id"].toLowerCase();
    assertUuid("expected-update-id", expectedUpdateId);
    rule.expectedUpdateId = expectedUpdateId;
  }

  rule.targetMode = targetMode;
  writeRules(rules);
  console.log(`Set emergency redirect "${id}" to ${targetMode} mode`);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function ask(terminal, question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await terminal.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function confirm(terminal, question, defaultValue = false) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (
    await terminal.question(`${question} (${hint}): `)
  ).trim().toLowerCase();

  if (!answer) {
    return defaultValue;
  }

  return answer === "y" || answer === "yes";
}

function printActions() {
  console.log(
    [
      "Choose an action:",
      "  1. List redirects",
      "  2. Add redirect",
      "  3. Enable redirect",
      "  4. Disable redirect",
      "  5. Remove redirect",
      "  6. Pin redirect to one OTA",
      "  7. Follow target channel",
      "  8. Exit",
    ].join("\n"),
  );
}

function normalizeAction(value) {
  const actions = {
    "1": "list",
    "2": "add",
    "3": "enable",
    "4": "disable",
    "5": "remove",
    "6": "pin",
    "7": "follow",
    "8": "exit",
    list: "list",
    add: "add",
    enable: "enable",
    disable: "disable",
    remove: "remove",
    pin: "pin",
    follow: "follow",
    exit: "exit",
  };

  return actions[value.toLowerCase()] || null;
}

async function promptForRule(terminal) {
  const platform = await ask(terminal, "Platform", "android");
  const runtimeVersion = await ask(
    terminal,
    "Runtime version from the device request",
  );
  const embeddedUpdateId = await ask(
    terminal,
    "Affected expo-embedded-update-id",
  );
  const fromChannel = await ask(
    terminal,
    "Incorrect channel requested by the binary",
    "development",
  );
  const toChannel = await ask(
    terminal,
    "Channel containing the recovery OTA",
    "production",
  );
  const expectedUpdateId = await ask(
    terminal,
    "Production OTA update ID that must be served",
  );
  const targetMode = await ask(
    terminal,
    "Target mode: pinned for rescue, follow for normal future OTA",
    "pinned",
  );
  const suggestedId =
    `${platform}-${runtimeVersion}-${fromChannel}-to-${toChannel}`.replace(
      /[^a-zA-Z0-9-]+/g,
      "-",
    );
  const id = await ask(terminal, "Rule name", suggestedId);

  return {
    id,
    "embedded-update-id": embeddedUpdateId,
    "runtime-version": runtimeVersion,
    platform,
    "from-channel": fromChannel,
    "to-channel": toChannel,
    "target-mode": targetMode,
    "expected-update-id": expectedUpdateId,
  };
}

async function runPostChangeFlow(terminal) {
  const shouldValidate = await confirm(
    terminal,
    "Run lint and production build locally",
    true,
  );

  if (shouldValidate) {
    runCommand("npm", [
      "run",
      "lint",
      "--",
      "--quiet",
      "src/server/controllers/manifest.ts",
      "src/server/lib/emergency-channel-redirects.ts",
      "scripts/manage-emergency-redirect.mjs",
    ]);
    runCommand("npm", ["run", "build"]);
  }

  const shouldDeploy = await confirm(
    terminal,
    "Deploy this redirect configuration to production",
    false,
  );

  if (!shouldDeploy) {
    console.log("Production was not changed.");
    return;
  }

  const confirmation = await ask(
    terminal,
    'Type "DEPLOY PRODUCTION" to continue',
  );

  if (confirmation !== "DEPLOY PRODUCTION") {
    console.log("Deployment cancelled.");
    return;
  }

  runCommand("vercel", ["--prod", "--yes"]);
}

async function runInteractive() {
  const terminal = createInterface({ input: stdin, output: stdout });

  try {
    console.log("OTA Emergency Redirect Wizard\n");
    printActions();
    const action = normalizeAction(
      await ask(terminal, "Action", "1"),
    );

    if (!action) {
      throw new Error("Unknown action");
    }

    if (action === "exit") {
      return;
    }

    if (action === "list") {
      printRules(readRules());
      return;
    }

    if (action === "add") {
      const options = await promptForRule(terminal);
      console.log("\nRule to add:");
      printRules([
        {
          id: options.id,
          enabled: true,
          embeddedUpdateId: options["embedded-update-id"],
          runtimeVersion: options["runtime-version"],
          platform: options.platform,
          fromChannel: options["from-channel"],
          toChannel: options["to-channel"],
          targetMode: options["target-mode"],
          expectedUpdateId: options["expected-update-id"],
        },
      ]);

      if (!(await confirm(terminal, "Write this rule", false))) {
        console.log("No changes made.");
        return;
      }

      addRule(options);
      await runPostChangeFlow(terminal);
      return;
    }

    const rules = readRules();
    printRules(rules);
    const id = await ask(terminal, "Rule name");

    if (action === "remove") {
      if (!(await confirm(terminal, `Remove "${id}"`, false))) {
        console.log("No changes made.");
        return;
      }
      removeRule({ id });
    } else if (action === "pin") {
      const expectedUpdateId = await ask(
        terminal,
        "OTA update ID to pin",
        rules.find((rule) => rule.id === id)?.expectedUpdateId || "",
      );
      setRuleTargetMode(
        { id, "expected-update-id": expectedUpdateId },
        "pinned",
      );
    } else if (action === "follow") {
      setRuleTargetMode({ id }, "follow");
    } else {
      setRuleEnabled({ id }, action === "enable");
    }

    await runPostChangeFlow(terminal);
  } finally {
    terminal.close();
  }
}

function printHelp() {
  console.log(
    [
      "Interactive mode:",
      "  npm run emergency:redirect",
      "",
      "Automation:",
      "  npm run emergency:redirect -- list",
      "  npm run emergency:redirect -- add --id NAME --embedded-update-id UUID --runtime-version VERSION --platform android --from-channel development --to-channel production --target-mode pinned --expected-update-id UUID",
      "  npm run emergency:redirect -- enable --id NAME",
      "  npm run emergency:redirect -- disable --id NAME",
      "  npm run emergency:redirect -- pin --id NAME --expected-update-id UUID",
      "  npm run emergency:redirect -- follow --id NAME",
      "  npm run emergency:redirect -- remove --id NAME",
    ].join("\n"),
  );
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command) {
    await runInteractive();
    return;
  }

  if (command === "--help" || command === "help") {
    printHelp();
    return;
  }

  if (command === "list") {
    printRules(readRules());
    return;
  }

  if (command === "add") {
    addRule(options);
    return;
  }

  if (command === "remove") {
    removeRule(options);
    return;
  }

  if (command === "enable" || command === "disable") {
    setRuleEnabled(options, command === "enable");
    return;
  }

  if (command === "pin" || command === "follow") {
    setRuleTargetMode(options, command === "pin" ? "pinned" : "follow");
    return;
  }

  throw new Error(
    "Use: list, add, remove, enable, disable, pin, or follow",
  );
}

try {
  await main();
} catch (error) {
  console.error(`Emergency redirect command failed: ${error.message}`);
  process.exit(1);
}

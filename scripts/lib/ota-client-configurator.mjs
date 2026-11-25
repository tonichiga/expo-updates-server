import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { planOtaRootHook } from "./ota-root-hook-patcher.mjs";
import {
  bootstrapCode,
  clientPackage,
  clientVersion,
  originalEntryCode,
} from "./ota-client-package.mjs";

const ENTRY = "ota-entry.js";
const META = "ota-client-entry.json";
// SHA-256 of the generated JavaScript and TypeScript clients shipped before the SDK.
const legacyClientFiles = {
  "README.md": [
    "63ba1e4caad176611ba3b005ce0f22a26bdf475a0ba9ecdffbf13c417987477a",
    "94de27962827a474e3348a8619d2f0d5a5a28db986350d87337843c55427754e",
  ],
  "controller.js": [
    "071d8964015f6569df552ad137be92dc2319b6c9c99cd965fed04b72cd330b0e",
  ],
  "controller.ts": [
    "857b872021aafe85dcefa16c5926084adeba356049534f5b5beeeddd8d69e997",
  ],
  "device-identity.js": [
    "3df8f2161a969fb913a4fc25e4e2a4e45b77b276c8aa494f482c4a63fc28a7d0",
  ],
  "device-identity.ts": [
    "175e6420b2af63d554b6873f85cdb5367a07deaa5ab2aa9843b35be38846a874",
  ],
  "docs/update-lifecycle.md": [
    "2cb7ced11ee8c1a2952644e0ae9d1e883476d3967e990a25bec69f2b3b814446",
    "45a8e9f52076d39ef9afce51afe311ed7d4a6d38d44680ecfbe223118dd61b7e",
    "5b2c18bdbd481d65af2e2777e8299e7385a4d2aa8aec156c9da807ee4cf4e095",
    "f16381c3884675c0278968a5980c869af909b89ba61dfcaf8cdc3febe97604b4",
  ],
  "index.d.ts": [
    "4dda51592f0baf0f665df266fbc6de7e4fd003302c9a8d4df8e6b29521c50c9b",
  ],
  "index.js": [
    "04398d73c08b9c25c251cca3bbd9484306b76b82e37c55dc01904a678b756281",
  ],
  "index.ts": [
    "43229cadbeffcc544704c70e506a89c6bde7b44666f4ff44b64a768eade200b3",
  ],
  "model/hooks/useOtaUpdates.js": [
    "10c611ec2a22852efaa8642a267cd0e15def919f272921b1f519d37a6eeda7a0",
  ],
  "model/hooks/useOtaUpdates.ts": [
    "01aec47eb8197039beb8895ce3b25e726518bd31c18838656967deb55b025eae",
    "59b9777a0d097df62a0d65bc86c8a272672c62322cdda89f49aafeeabfb6e801",
  ],
  "model/update-controller.js": [
    "7efcedf3fc730294ff58be0b2151f6a29ae449228ed85c341c7536d11f696fe1",
  ],
  "model/update-controller.ts": [
    "130bcfa37864383143b0f1fb2b0789e94e5f3e2b7f4fe3d22e168a55643b7e03",
    "60ebb33895cbe7d7b12c0c8d9f443669e4955de1f9d0c528f3d7578e2c9f1349",
    "9a1020c1de7211273929b5da7b4a85f0abe076b24f470c4be9151245f5ba6716",
  ],
  "runtime.js": [
    "8d6a5d6c4bc39b1035f5e1f300a5dfe7c7f20390478f2e022d23e9825b980690",
  ],
  "runtime.ts": [
    "8eb1548b060125ddd93dd05a31ee9197777da30bb7d052ebc3e647c9360e1f4c",
  ],
  "types.ts": [
    "29c4894ed1f7cbd61f59f2f62319748f3555f9e2d883d858e3b64100d8940c64",
    "a892b2989e61dbbcf83d271f88fce57226d2aa13401393e14b9c67c75638c566",
    "dedae48ece515569c4a4509fbcfde5f88ee20adc949484f03cff869f22572679",
  ],
  "ui/ota-update-gate.js": [
    "a3c430656849ec960ab1dbaf555c6bc6414c0cf31a74982be8b3024cd5dfb5ed",
  ],
  "ui/ota-update-gate.tsx": [
    "26f34d88605950df11597a01204710c606203baee87a9df9de29be33860d5678",
  ],
  "ui/ota-updates.tsx": [
    "839fa62ee9583ee41983e003492cdd76c03ecbff7e9cf7d038743389e3a9f21d",
    "83c8c4f4e7a62a5d793e4ed519c7c6b4692c902208ecfcb1340ca655631df88d",
    "e2a710f41e9ab2f33fbd8b7948f25c43a601324703b7f714bf34f4fdc9099f2c",
  ],
};
const extensions = ["tsx", "ts", "jsx", "js", "mjs", "cjs"];
function hasEntry(root, entry, platform) {
  const suffixes = platform === "web" ? ["web", ""] : [platform, "native", ""];
  return suffixes.some((suffix) =>
    extensions.some((ext) =>
      fs.existsSync(
        path.join(root, `${entry}${suffix ? `.${suffix}` : ""}.${ext}`),
      ),
    ),
  );
}

// Preflight every generated file before the main configurator changes the project.
export function planOtaClient({
  appRoot,
  packageJson,
  manifestUrl,
  channel,
  force,
}) {
  let entry = packageJson.main;
  if (entry === ENTRY || entry === `./${ENTRY}`) {
    const metadata = JSON.parse(
      fs.readFileSync(path.join(appRoot, META), "utf8"),
    );
    entry = metadata.originalEntry;
    if (typeof entry !== "string" || entry.includes("ota-entry"))
      throw new Error("Invalid original OTA entry metadata");
  } else if (!entry) {
    entry = "__platform_default__";
  } else if (typeof entry !== "string" || entry.includes("ota-entry")) {
    throw new Error("Invalid application main entry");
  } else if (
    !entry.startsWith(".") &&
    (fs.existsSync(path.join(appRoot, entry)) ||
      ["android", "ios", "web"].some((platform) =>
        hasEntry(appRoot, entry, platform),
      ))
  ) {
    entry = `./${entry}`;
  }
  const heartbeatUrl = new URL(manifestUrl);
  heartbeatUrl.pathname = heartbeatUrl.pathname.replace(
    /\/manifest\/?$/,
    "/device-heartbeat",
  );
  heartbeatUrl.search = "";
  heartbeatUrl.hash = "";
  const existingConfigPath = path.join(appRoot, "ota-client/config.json");
  const existingConfig = fs.existsSync(existingConfigPath)
    ? JSON.parse(fs.readFileSync(existingConfigPath, "utf8"))
    : {};
  // Preserve the namespace when a tunnel URL changes; runtime/channel are deliberately excluded.
  const identityNamespace =
    existingConfig.identityNamespace || new URL(manifestUrl).origin;
  const defaultEntries = [];
  if (entry === "__platform_default__") {
    for (const platform of ["android", "ios", "web"]) {
      const source = hasEntry(appRoot, "index", platform)
        ? 'require("./index");'
        : "require('expo').registerRootComponent(require('./App').default);";
      defaultEntries.push([
        `ota-original-entry.${platform}.js`,
        `// Generated default ${platform} entry.\n${source}\n`,
      ]);
    }
  }
  const header = `// Generated by configure-app. Original entry is preserved in ${META}.\n`;
  const oldEntries = ["./ota-client", "./ota-client/runtime"].map(
    (module) => `${header}require('${module}').start();\n${originalEntryCode(entry)}\n`,
  );
  const rootHookPlan = planOtaRootHook({ appRoot, originalEntry: entry });
  const files = [
    ...defaultEntries,
    [ENTRY, `${header}${bootstrapCode(entry)}\n`],
    [META, `${JSON.stringify({ originalEntry: entry }, null, 2)}\n`],
    [
      "ota-client/config.json",
      `${JSON.stringify({ ...existingConfig, channel, heartbeatUrl: heartbeatUrl.toString(), identityNamespace }, null, 2)}\n`,
    ],
  ];
  const warnings = [...rootHookPlan.warnings];
  const backups = [];
  const forwarders = [];
  const obsoleteDocs = [];

  function preserveCustomizedFile(relative) {
    const file = path.join(appRoot, relative);
    if (!force)
      throw new Error(
        `Refusing to replace customized ${file}. Migrate your changes or rerun with --force to save a backup and switch to the SDK.`,
      );
    const backup = `${file}.pre-sdk.bak`;
    if (
      fs.existsSync(backup) &&
      !fs.readFileSync(file).equals(fs.readFileSync(backup))
    )
      throw new Error(
        `Refusing to overwrite ${backup}. Move the existing backup before rerunning.`,
      );
    backups.push([file, backup]);
    warnings.push(
      `Review customized ${relative} saved in ${relative}.pre-sdk.bak and reapply any needed changes.`,
    );
  }

  // Preserve the old module paths for application code outside the root we patch.
  // Both the new entry and all compatibility imports resolve to one SDK instance.
  for (const [name, hashes] of Object.entries(legacyClientFiles)) {
    const relative = `ota-client/${name}`;
    const file = path.join(appRoot, relative);
    if (!fs.existsSync(file)) continue;
    const current = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const generated = hashes.includes(
      createHash("sha256").update(current).digest("hex"),
    );
    if (name.endsWith(".md")) {
      if (generated) obsoleteDocs.push(file);
      continue;
    }
    const subpath = name.replace(/(?:\.d)?\.[jt]sx?$/, "");
    const target = subpath === "index" ? clientPackage : `${clientPackage}/${subpath}`;
    const forwarder = `export * from "${target}";\n`;
    if (current === forwarder) continue;
    if (!generated) preserveCustomizedFile(relative);
    forwarders.push([relative, forwarder]);
  }

  for (const [name, content] of files) {
    const destination = path.join(appRoot, name);
    if (!fs.existsSync(destination)) continue;
    const current = fs.readFileSync(destination, "utf8").replace(/\r\n/g, "\n");
    if (current === content || (name === ENTRY && oldEntries.includes(current)))
      continue;
    if (name.endsWith(".js")) preserveCustomizedFile(name);
    else if (!force)
      throw new Error(`Refusing to overwrite ${destination}. Re-run with --force.`);
  }
  return {
    warnings,
    apply() {
      for (const [file, backup] of backups)
        if (!fs.existsSync(backup))
          fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      for (const file of obsoleteDocs) fs.rmSync(file, { force: true });
      for (const [name, content] of [
        ...files,
        ...forwarders,
        ...rootHookPlan.files,
      ]) {
        const destination = path.join(appRoot, name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
      }
    },
    patchPackage(packageJson) {
      return {
        ...packageJson,
        main: ENTRY,
        dependencies: { ...packageJson.dependencies, [clientPackage]: clientVersion },
      };
    },
  };
}

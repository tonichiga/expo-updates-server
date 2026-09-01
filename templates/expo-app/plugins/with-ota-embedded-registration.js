// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withXcodeProject } = require("expo/config-plugins");

const PHASE_NAME = "Register Expo embedded update";
const SHELL_SCRIPT =
  'OTA_EMBEDDED_REGISTER_STRICT=true sh "$PROJECT_DIR/../scripts/ota-register-embedded/register-ios.sh"';
const SERIALIZED_SHELL_SCRIPT = `"${SHELL_SCRIPT.replaceAll(
  "\\",
  "\\\\",
).replaceAll('"', '\\"')}"`;

module.exports = function withOtaEmbeddedRegistration(config) {
  return withXcodeProject(config, (projectConfig) => {
    const project = projectConfig.modResults;
    const phases =
      project.hash.project.objects.PBXShellScriptBuildPhase || {};
    const existingPhase = Object.values(phases).find(
      (phase) =>
        phase &&
        typeof phase === "object" &&
        phase.name === `"${PHASE_NAME}"`,
    );

    if (existingPhase) {
      existingPhase.shellPath = "/bin/sh";
      existingPhase.shellScript = SERIALIZED_SHELL_SCRIPT;
    } else {
      project.addBuildPhase(
        [],
        "PBXShellScriptBuildPhase",
        PHASE_NAME,
        project.getFirstTarget().uuid,
        {
          shellPath: "/bin/sh",
          shellScript: SHELL_SCRIPT,
        },
      );
    }

    return projectConfig;
  });
};

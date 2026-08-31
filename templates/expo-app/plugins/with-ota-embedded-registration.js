const { withXcodeProject } = require("expo/config-plugins");

const PHASE_NAME = "Register Expo embedded update";

module.exports = function withOtaEmbeddedRegistration(config) {
  return withXcodeProject(config, (projectConfig) => {
    const project = projectConfig.modResults;
    const phases =
      project.hash.project.objects.PBXShellScriptBuildPhase || {};
    const phaseExists = Object.values(phases).some(
      (phase) =>
        phase &&
        typeof phase === "object" &&
        phase.name === `"${PHASE_NAME}"`,
    );

    if (!phaseExists) {
      project.addBuildPhase(
        [],
        "PBXShellScriptBuildPhase",
        PHASE_NAME,
        project.getFirstTarget().uuid,
        {
          shellPath: "/bin/sh",
          shellScript:
            'OTA_EMBEDDED_REGISTER_STRICT=true sh "$PROJECT_DIR/../ci_scripts/register-embedded-update.sh"',
        },
      );
    }

    return projectConfig;
  });
};

import path from "node:path";

export function getExpoExportCommand({
  appRoot = process.cwd(),
  outputDir,
  platform,
}) {
  return {
    command: path.join(
      appRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "expo.cmd" : "expo",
    ),
    args: [
      "export",
      "--clear",
      "--platform",
      platform,
      "--output-dir",
      outputDir,
    ],
  };
}

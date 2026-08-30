// Learn more https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// #1 - Watch all files in the monorepo so Metro can resolve modules that
// live outside this app's own directory (e.g. packages/palette).
config.watchFolders = [workspaceRoot];

// #2 - Let Metro resolve node_modules hoisted to the workspace root, in
// addition to this app's own node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;

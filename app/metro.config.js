// Metro dans le monorepo pnpm : l'app importe `@sillage/shared` (sources TypeScript
// dans packages/shared) et, avec node-linker=hoisted, les dépendances vivent dans
// le node_modules de la racine.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Surveiller toute la racine pour voir les changements de packages/shared.
config.watchFolders = [workspaceRoot];
// Chercher les modules d'abord dans app/node_modules, puis à la racine.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;

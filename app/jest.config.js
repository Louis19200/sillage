/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  roots: ["<rootDir>/src"],
  // Garde-fou : les tests de changement d'heure n'ont de sens qu'en Europe/Paris.
  // Le script `pnpm test` fixe TZ=Europe/Paris ; ce fichier fait échouer la suite sinon.
  setupFiles: ["<rootDir>/jest.tz-check.js"],
};

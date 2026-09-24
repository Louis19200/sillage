// Été 2026 à Paris : UTC+2 (getTimezoneOffset renvoie -120). Hiver : UTC+1 (-60).
const summer = new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset();
const winter = new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset();
if (summer !== -120 || winter !== -60) {
  throw new Error(
    `Les tests doivent tourner avec TZ=Europe/Paris (décalages observés : ${summer}, ${winter}). ` +
      "Lance `pnpm test` plutôt que `jest` directement."
  );
}

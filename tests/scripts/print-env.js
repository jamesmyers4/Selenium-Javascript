// scripts/print-env.js
// dotenv is preloaded via -r, so we just read process.env here.
console.log({
  HEADLESS: process.env.HEADLESS,
  DEBUG_PICKERS: process.env.DEBUG_PICKERS,
  PATH: process.env.DOTENV_CONFIG_PATH,
  OVERRIDE: process.env.DOTENV_CONFIG_OVERRIDE
});

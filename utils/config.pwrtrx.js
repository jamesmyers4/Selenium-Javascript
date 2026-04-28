// utils/config.pwrtrx.js
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config();
if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local', override: false });
}

const bool = v => String(v || '').toLowerCase() === 'true';
const num  = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const cfg = Object.freeze({
  baseUrl: process.env.BASE_URL,
  esamsMainUrl: process.env.ESAMS_MAIN_URL,
  username: process.env.LOGIN_USERNAME,
  password: process.env.LOGIN_PASSWORD,
  headless: bool(process.env.HEADLESS),
  debugPickers: bool(process.env.DEBUG_PICKERS),
  pickersRetry: num(process.env.PICKERS_RETRY, 2),
  pickersWaitMs: num(process.env.PICKERS_WAIT_MS, 8000),
  pickersDiagDir: process.env.PICKERS_DIAG_DIR || './artifacts/pickers'
});

['BASE_URL','LOGIN_USERNAME','LOGIN_PASSWORD'].forEach((k) => {
  if (!process.env[k]) {
    console.warn(`[cfg] Missing ${k}. Check .env / environment.`);
  }
});

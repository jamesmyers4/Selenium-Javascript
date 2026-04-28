// tests/smoke/apps-open.smoke.test.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect } from 'chai';
import createDriver from '../../utils/driver.js';
import { login } from '../../utils/auth.js';
import { openApp, goHome, clickLogout } from '../../utils/nav.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ENV_FILE = process.env.ENV_FILE || '.env.trashpanda';
const RUNS = Math.max(1, parseInt(process.env.RUNS || '1', 10));

const APP_WHITELIST = [
  'ADMIN ONLY',
  'AUL',
  'BUILDING EVACUATION DRILL',
  'COMPLIANCE ASSESSMENT',
  'COURSE ADD/EDIT',
  'ERGO ASSESSMENT',
  'ETRACKER OLD',
  'E-TRACKER',
  'FIRE FACILITIES',
  'FIRE TRAINING SCHEDULE',
  'INCIDENT REPORTING',
  'INSPECTIONS (IDATS)',
  'JHA ADMIN',
  'JOB SAFETY BRIEF',
  'LICENSE MANAGEMENT',
  'LM',
  'MEDICAL SURVEILLANCE (OMSS)',
  'NFIRS',
  'NFPA 1500 CHECKLIST',
  'ORGANIZATION MANAGEMENT',
  'PERMITS',
  'PERSONNEL ADMINISTRATION (PA)',
  'PLAN REVIEW',
  'POWERTRX RELIABILITY',
  'RESPIRATOR PROGRAM',
  'SAFETY CONCERN MGT.',
  'SF91 MV ACCIDENT REPORT',
  'TRAINING ADMINISTRATION (TA)',
  'WEB TRAINING ADMINISTRATION',
  'WORK TASK',
];

describe('Smoke: Opens Every Application under Modules', function () {
  this.timeout(60000);

  let driver;
  before(async () => {
    driver = createDriver();
    await login(driver);
  });

  after(async () => {
    try { await clickLogout(driver); } catch {}
    await driver.quit();
  });

  // Run outer, label inner — RUNS is total full passes
  for (let run = 1; run <= RUNS; run++) {
    for (const label of APP_WHITELIST) {
      it(`run ${run} - opens "${label}"`, async function () {
        const start = Date.now();
        let ok = false;
        try {
          ok = await openApp(driver, label);
          expect(ok, `openApp returned false for "${label}"`).to.equal(true);

          async function getNavigationTiming(drv) {
            return drv.executeScript(() => {
              const p = performance.getEntriesByType('navigation')[0] || performance.timing;
              return {
                start: p.navigationStart ?? p.startTime,
                domContentLoaded: p.domContentLoadedEventEnd ?? (p.domContentLoadedEventEnd - (p.navigationStart ?? 0)),
                loadEventEnd: p.loadEventEnd ?? (p.loadEventEnd - (p.navigationStart ?? 0)),
                total: (p.loadEventEnd ?? p.loadEventEnd) - (p.navigationStart ?? p.startTime)
              };
            });
          }

          const navTiming = await getNavigationTiming(driver);
          console.log(`${label} timing (run ${run}):`, navTiming);

        } finally {
          try { await goHome(driver); } catch (err) { console.warn(`goHome failed after "${label}" run ${run}:`, err.message); }
          const durationMs = Date.now() - start;
          console.log(`⏱ ${label} (run ${run}) => ${durationMs}ms`);
        }
      });
    }
  }
});

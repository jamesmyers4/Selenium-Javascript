//WIP!
// tests/smoke/rms-open.smoke.test.js
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

const RMS_WHITELIST = [
  'AUL MASTER REPORT',
  'CHECKLIST DETAIL REPORT',
  'CHECKLIST TYPE REPORT',
  'COURSE LISTING',
  'FIRE STATION LISTING',
  'HAZARD AWARENESS',
  'MY RECENT CHECKLISTS',
  'WORK TASK DETAIL',
  'SAFEPOMS',
  'BUILDING EVACUATION DRILL',
  'EM DASHBOARD',
  'EXECUTIVE SAFETY SUMMARY',
  'FIRE DASHBOARD',
  'SAFETY DASHBOARD',
  'SUPERVISOR DASHBOARD',
  'DEFICIENCY MASTER',
  'DEFICIENCY STATUS',
  'DEFICIENCY TREND',
  'HAZARD AWARENESS',
  'INACTIVE PERSONNEL ASSIGNED AS FIRE WARDEN / PRA',
  'RE-INSPECTION',
  'RISK REGISTRY',
  'HAZARD/CAUSTION ANALYSIS',
  'E-TRACKER ADDITIONAL INFO',
  'E-TRACKER EQUIPMENT STATUS',
  'E-TRACKER EVENT',
  'E-TRACKER ITEM HEAT MAP',
  'E-TRACKER MASTER',
  'FIRE VEHICLE OUT OF SERVICE',
  'FIRE VEHICLE STATUS',
  'FACILITY MASTER',
  'FIRE TRAINING SCHEDULE',
  'BLS REPORT TO OSHA',
  'CORRECTIVE ACTION METRICS',
  'FURTHER ACTION REQUESTED',
  'INCIDENT ANALYSIS',
  'INCIDENT RATE SUMMARY',
  'INCIDENT STATUS',
  'INCIDENT TREND',
  'MASTER INJURY/ILLNESS',
  'MASTER NEAR MISS',
  'MASTER PROPERTY DAMAGE',
  'WORK TASK INVOVLED',
  'BUILDING SUMMARY',
  'INSPECTION MASTER - BUILDING',
  'INSPECTION MASTER - ORGANIZATION',
  'INSPECTOIN METRICS',
  'WORKPLACE VALIDATION',
  'JHA LISTING',
  'JHA MASTER',
  'JOB SAFETY BRIEF',
  'LICENSE MASTER',
  'LICENSES COMING DUE',
  'MEDICAL SURVEILLANCE COMPLIANCE',
  'OMSS MASTER',
  'STRESSOR NEEDS ASSESSMENT',
  'STRESSORS COMING DUE',
  'UPCOMING APPOINTMENTS',
  'APPARATUS MASTER',
  'ART REPORTS',
  'NFIRS INCIDENT COUNT',
  'NFIRS MASTER',
  'NFIRS SCBA',
  'NFIRS STATUS',
  'PERSONNEL BY RUN',
  'AID GIVEN OR RECEIVED',
  'DETAIL & SUM COUNTS BY REG AND LOCATION',
  'DETAIL COUNTS BY REGION',
  'DETAIL COUNTS BY REGION AND LOCATION',
  'EMS COUNT OF PROCEDURE USED',
  'NFIRS AIRCRAFT STANDBY',
  'NFIRS BUNKER',
  'NFIRS DORM',
  'NFIRS TRAVEL TIME',
  'SUM COUNTS BY REGION AND LOCATION',
  'SUMMARY COUNTS BY REGION',
  '% TOTAL FOR GROUPS BY LOCATION',
  '% TOTAL FOR GROUPS BY REGION',
  'DETAIL COUNTS BY DAYS OF THE WEEK',
  'DETAIL COUNTS BY TIME SLOTS',
  
  //WIP<--
];

describe('Smoke: Opens Every Report', function () {
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

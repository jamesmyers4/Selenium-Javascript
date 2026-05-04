import { expect } from 'chai';
import createDriver from '../../utils/driver.js';
import { login } from '../../utils/auth.js';
import { openApp, goHome, clickLogout } from '../../utils/nav.js';
import { By, Key, until } from 'selenium-webdriver';
import { pickFireDepartment, pickPrimaryIncidentType } from '../../utils/pickers.js';
import { typeInto, selectOption, clickByText, findField, setCheckboxSmart } from '../../utils/forms.js';
import { clickCreateIncident, closeOverlays, waitForNoOverlays } from '../../utils/ui.js';
import { drainAllAlerts, withAlertGuard, waitForNoAlerts } from '../../utils/alerts.js';
import { satisfyCoreTopTabs } from '../../utils/topTabsRequired.js';
import { resolveAllTopTabs } from '../../utils/required.js';
import { cfg } from '../../utils/config.neris.js';
import { installStabilityProbes } from '../../utils/stability.js';

console.log('[cfg] headless=%s debugPickers=%s waitMs=%d', cfg.headless, cfg.debugPickers, cfg.pickersWaitMs);

const FIR_LABEL = process.env.FIR_APP_LABEL || 'FIR';
const FIELD_LABELS = {
  date: (process.env.FIR_DATE_LABELS?.split('|')) || ['Incident Date', 'Date of Incident', 'Date'],
  time: (process.env.FIR_TIME_LABELS?.split('|')) || ['Incident Alarm Time', 'Alarm Time', 'Incident Time', 'Time'],
};
const FIR = {
  createButton: 'Create',
  rootHook: '#neris-root, [data-test="neris-root"]',
};
const DATE_CSS = process.env.FIR_DATE_SELECTOR || null;
const TIME_CSS = process.env.FIR_TIME_SELECTOR || null;


async function optimisticToggleOfficer(driver, desired=true, timeout=8000){
  const res = await waitForOfficerEnabledObs(driver, 1_000);
  if (res.ok) {
    await setCheckboxSmart(driver, { labels:[
      'Member making report same as Officer in Charge',
      'Member Making Report','Officer in Charge','Officer-in-Charge'
    ]}, desired);
    return;
  }
  await driver.executeAsyncScript((labels, desired, timeoutMs, done) => {
    function q(){
      for (const L of labels) {
        const xp = `//*[normalize-space(text())='${L}']/ancestor::*[self::mat-checkbox or contains(@class,'mat-mdc-checkbox') or @role='checkbox'][1]`;
        const it = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (it) return it;
      }
      const all = Array.from(document.querySelectorAll('mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]'));
      return all.find(n => (n.innerText||'').toLowerCase().includes('officer'));
    }
    function enabled(host){
      const input = host.querySelector('input[type="checkbox"]');
      const aria = host.getAttribute('aria-disabled');
      return !host.hasAttribute('disabled') && aria !== 'true' && (!input || input.disabled === false);
    }
    const host = q(); if (!host) return done(false);
    const click = () => {
      const input = host.querySelector('input[type="checkbox"]');
      if (input) input.click(); else host.click();
    };
    if (enabled(host)) { click(); return done(true); }
    const obs = new MutationObserver(() => {
      if (enabled(host)) { obs.disconnect(); click(); done(true); }
    });
    obs.observe(host, { attributes:true, attributeFilter:['class','disabled','aria-disabled'] });
    setTimeout(() => { obs.disconnect(); done(false); }, timeoutMs);
  }, [
    'Member making report same as Officer in Charge',
    'Member Making Report','Officer in Charge','Officer-in-Charge'
  ], desired, timeout);
}

async function waitForOfficerEnabledObs(driver, timeout=8000){
  const labelTexts = [
    'Member making report same as Officer in Charge',
    'Member Making Report',
    'Officer in Charge',
    'Officer-in-Charge'
  ];
  return await driver.executeAsyncScript((labels, timeoutMs, done) => {
    function locate(){
      for (const L of labels) {
        const xp = `//*[normalize-space(text())='${L}']/ancestor::*[self::mat-checkbox or contains(@class,'mat-mdc-checkbox') or @role='checkbox'][1]`;
        const it = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (it) return it;
      }
      const all = Array.from(document.querySelectorAll('mat-checkbox, .mat-mdc-checkbox, [role="checkbox"]'));
      return all.find(n => (n.innerText||'').toLowerCase().includes('officer'));
    }
    function enabled(host){
      const input = host.querySelector('input[type="checkbox"]');
      const aria  = host.getAttribute('aria-disabled');
      return !host.hasAttribute('disabled') && aria !== 'true' && (!input || input.disabled === false);
    }

    const host = locate();
    if (!host) return done({ ok:false, reason:'host-not-found' });
    if (enabled(host)) return done({ ok:true, reason:'already-enabled' });

    const obs = new MutationObserver(() => {
      if (enabled(host)) {
        obs.disconnect(); done({ ok:true, reason:'observer-enabled' });
      }
    });
    obs.observe(host, { attributes:true, attributeFilter:['class','disabled','aria-disabled'] });
    const t = setTimeout(() => { obs.disconnect(); done({ ok:false, reason:'timeout' }); }, timeoutMs);
  }, labelTexts, timeout);
}

async function findElByCssOrLabels(driver, css, labels) {
  if (css) {
    const el = await driver.findElement(By.css(css));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
    return el;
  }
  for (const L of labels || []) {
    try {
      const el = await findField(driver, L);
      await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
      return el;
    } catch {}
  }
  throw new Error(`Could not locate element by ${css || '(no css)'} or labels: ${labels?.join(' | ')}`);
}

async function forceSetValue(driver, el, value) {
  await driver.executeScript(`
    const el = arguments[0], v = arguments[1];
    try { el.removeAttribute('readonly'); } catch {}
    el.value = v;
    ['input','change','blur','keyup'].forEach(t => el.dispatchEvent(new Event(t,{bubbles:true})));
  `, el, value);
}

async function setValueAndVerify(driver, { css, labels, value, retries = 2 }) {
  const el = await findElByCssOrLabels(driver, css, labels);

  for (let i = 0; i <= retries; i++) {
    try { await el.clear(); } catch {}
    try { await el.sendKeys(value); } catch {}
    try { await el.sendKeys(Key.TAB); } catch {
      await driver.executeScript('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
    }

    await driver.sleep(100);
    const got = (await el.getAttribute('value')) || (await el.getText()) || '';
    if (got.trim()) return el;

    await forceSetValue(driver, el, value);
    await driver.sleep(60);
    const got2 = (await el.getAttribute('value')) || (await el.getText()) || '';
    if (got2.trim()) return el;
  }
  throw new Error(`Value did not stick for selector ${css || labels?.join(' | ')}`);
}

async function setIncidentDateTimeWithVerify(driver, dateStr, timeStr) {
  await setValueAndVerify(driver, { css: DATE_CSS, labels: FIELD_LABELS.date, value: dateStr });
  try {
    await setValueAndVerify(driver, { css: TIME_CSS, labels: FIELD_LABELS.time, value: timeStr });
  } catch {
    const short = timeStr.slice(0, 5); // HH:MM
    await setValueAndVerify(driver, { css: TIME_CSS, labels: FIELD_LABELS.time, value: short });
  }
}

async function submitAndResolveValidation(
  driver,
  submitText = 'Create',
  { successUrlRegex = /\/neris\/(details|view|incident|edit|[0-9]+)/i, waitMs = 15000 } = {}
) {
  await closeOverlays(driver);
  await withAlertGuard(driver, async () => { await clickByText(driver, submitText); }, { retries: 0 });
  await waitForNoOverlays(driver);

  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const url = await driver.getCurrentUrl();
    if (successUrlRegex.test(url)) return { ok: true };

    const errs = await driver.findElements(By.css('.mat-mdc-form-field-error, .mat-error, [role="alert"].mat-mdc-form-field-error'));
    let messages = [];
    for (const e of errs) {
      try {
        if (!(await e.isDisplayed())) continue;
        const t = (await e.getText())?.trim();
        if (t) messages.push(t);
      } catch {}
    }

    messages = Array.from(new Set(messages)).filter(Boolean);

    if (messages.length) {
      const needDate = messages.some(m => /date|required/i.test(m));
      const needTime = messages.some(m => /time|required/i.test(m));
      if (needDate || needTime) {
        const { mm, dd, yyyy, hh, mi, ss } = nowParts();
        const dateStr = process.env.FIR_DATE || `${mm}/${dd}/${yyyy}`;
        const timeStr = process.env.FIR_TIME || `${hh}:${mi}:${ss}`;
        await setIncidentDateTimeWithVerify(driver, dateStr, timeStr);
        await closeOverlays(driver);
        await withAlertGuard(driver, async () => { await clickByText(driver, submitText); }, { retries: 0 });
        await waitForNoOverlays(driver);
      } else {
        throw new Error(`Validation errors: ${messages.join(' | ')}`);
      }
    }
    await driver.sleep(200);
  }
  return { ok: false };
}

function nowParts() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return { mm, dd, yyyy, hh, mi, ss };
}

function deriveRootFromEnv() {
  const base = process.env.ESAMS_MAIN_URL || process.env.BASE_URL || '';
  if (!base) return '';
  return base.replace(/\/(n\/esams\/main.*|auth\/account\/login.*|login.*)$/i, '');
}

async function ensureOnFirMain(driver) {
  const url = (await driver.getCurrentUrl()) || '';
  if (/\/neris(?:\/|$)/i.test(url)) return;

  const target = process.env.FIR_URL || (root ? `${root}/n/esams/neris` : '');

  if (target) {
    try {
      await driver.get(target);
      await driver.wait(until.urlMatches(/\/neris(?:\/|$)/i), 10000);
      return;
    } catch {}
  }

  const opened = await withAlertGuard(driver, () => openApp(driver, FIR_LABEL), { retries: 2 });
  if (!opened) throw new Error(`Could not find/click ${FIR_LABEL}`);

  await driver.wait(until.urlMatches(/\/neris\b/i), 10000).catch(async () => {
    const exact = await driver.findElements(By.xpath(
      "//a[translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')='FIR']"
    ));
    if (exact.length) {
      try { await exact[0].click(); } catch { await driver.executeScript("arguments[0].click();", exact[0]); }
      await driver.wait(until.urlMatches(/\/neris\b/i), 8000);
    }
  });
}

async function gotoTopTab(driver, label, { waitMs = 12000 } = {}) {
  await closeOverlays(driver);
  const selectors = [
    '.mat-mdc-tab .mdc-tab__content .mdc-tab__text-label',
    '.mat-mdc-tab-label-content',
    '.mat-tab-label-content'
  ].join(', ');

  await driver.wait(until.elementLocated(By.css(selectors)), waitMs);

  const labels = await driver.findElements(By.css(selectors));
  let hit = null;
  for (const el of labels) {
    let t = '';
    try { t = (await el.getText()).trim(); } catch {}
    if (t && t.toLowerCase().includes(label.toLowerCase())) { hit = el; break; }
  }
  if (!hit) throw new Error(`Top tab "${label}" not found`);

  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', hit);
  try { await hit.click(); } catch { await driver.executeScript('arguments[0].click()', hit); }

  await driver.wait(async () => {
    try {
      const tab = await hit.findElement(By.xpath(
        './ancestor::*[contains(@class,"mat-mdc-tab") or contains(@class,"mat-tab-label")]'
      ));
      const cls = (await tab.getAttribute('class')) || '';
      return /\bmdc-tab--active\b|\bmat-mdc-tab-active\b|\bmat-tab-label-active\b/.test(cls);
    } catch { return false; }
  }, waitMs).catch(() => {});
  await waitForNoOverlays(driver);
}

async function gotoLeftNav(driver, label, { waitMs = 12000 } = {}) {
  await closeOverlays(driver);
  const nav = await driver.findElement(By.xpath(
    `//*[self::a or self::button or @role='button'][normalize-space(.)='${label}' or .//span[normalize-space(.)='${label}']]`
  ));
  try { await nav.click(); } catch { await driver.executeScript('arguments[0].click()', nav); }
  await driver.wait(async () => {
    const any = await driver.findElements(By.xpath(
      "//*[self::input or self::textarea or contains(@class,'mat-form-field') or @role='group']"
    ));
    return any.length > 0;
  }, waitMs);
  await waitForNoOverlays(driver);
}

async function clickSave(driver, text = process.env.FIR_SAVE_BTN || 'Save') {
  await closeOverlays(driver);
  await withAlertGuard(driver, async () => { await clickByText(driver, text); }, { retries: 0 });
  await waitForNoAlerts(driver);
  await waitForNoOverlays(driver);
}

async function readIncidentDetails(driver) {
  async function getVal(lbl) {
    try {
      const el = await findField(driver, lbl);
      return (await el.getAttribute('value')) || (await el.getText()) || '';
    } catch { return ''; }
  }
  return {
    id:      await getVal('Incident ID'),
    dept:    await getVal('Fire Department ID'),
    num:     await getVal('Incident Number'),
    when:    await getVal('Incident Date'),
    station: await getVal('Fire Station'),
  };
}

async function fillCoreExtras(driver, core = {}) {
  await gotoTopTab(driver, 'Core');
  if (core.cad) { await typeInto(driver, 'CAD Number', core.cad); }
  await clickSave(driver);
}

async function fillLocationSection(driver, loc = {}) {
  await gotoTopTab(driver, 'Location');
  if (loc.address1)   await typeInto(driver, 'Address', loc.address1);
  if (loc.city)       await typeInto(driver, 'City', loc.city);
  if (loc.state)      await selectOption(driver, 'State', loc.state);
  if (loc.zip)        await typeInto(driver, 'Zip', loc.zip);
  if (loc.locationType) await selectOption(driver, 'Location Type', loc.locationType);
  try { if (loc.latitude)  await typeInto(driver, 'Latitude',  String(loc.latitude)); } catch {}
  try { if (loc.longitude) await typeInto(driver, 'Longitude', String(loc.longitude)); } catch {}
  await clickSave(driver);
}

async function fillDispatchSection(driver, disp = {}) {
  await gotoTopTab(driver, 'Dispatch');
  if (disp.callType)      await selectOption(driver, 'Call Type', disp.callType);
  if (disp.alarmLevel)    await selectOption(driver, 'Alarm Level', disp.alarmLevel);
  if (disp.comments?.length) {
    for (const c of disp.comments) {
      try { await typeInto(driver, 'Dispatcher Comment', c); } catch {}
    }
  }
  await clickSave(driver);
}

async function fillRespondingUnits(driver, units = []) {
  await gotoLeftNav(driver, 'Responding Units');
  for (const u of units) {
    try { await clickByText(driver, 'Add Unit'); } catch {}
    await typeInto(driver, 'Unit ID', u.id);
    await selectOption(driver, 'Unit Type', u.type || 'Engine');
    if (u.enroute)  await typeInto(driver, 'En Route Time',  u.enroute);
    if (u.onscene)  await typeInto(driver, 'On Scene Time',  u.onscene);
    if (u.cleared)  await typeInto(driver, 'Cleared Time',   u.cleared);
    try { await clickByText(driver, 'Add'); } catch {}
  }
  await clickSave(driver);
}

async function fillFireModule(driver, fire = {}) {
  await gotoLeftNav(driver, 'Fire');
  if (fire.propertyUse)        await selectOption(driver, 'Property Use', fire.propertyUse);
  if (fire.areaOfOrigin)       await selectOption(driver, 'Area of Origin', fire.areaOfOrigin);
  if (fire.heatSource)         await selectOption(driver, 'Heat Source', fire.heatSource);
  if (fire.itemFirstIgnited)   await selectOption(driver, 'Item First Ignited', fire.itemFirstIgnited);
  if (fire.cause)              await selectOption(driver, 'Cause of Ignition', fire.cause);
  if (fire.lossDollar != null) await typeInto(driver, 'Estimated Dollar Loss', String(fire.lossDollar));
  await clickSave(driver);
}

async function fillHazSit(driver, haz = {}) {
  await gotoLeftNav(driver, 'HazSit');
  if (haz.isHazmat != null) {
    await setCheckboxSmart(driver, { labels: ['Hazardous Materials Present'] }, !!haz.isHazmat);
  }
  if (haz.chemicals?.length) {
    for (const ch of haz.chemicals) {
      try { await clickByText(driver, 'Add Chemical'); } catch {}
      await typeInto(driver, 'Chemical Name', ch.name);
      if (ch.un)   await typeInto(driver, 'UN Number', ch.un);
      if (ch.qty)  await typeInto(driver, 'Quantity', String(ch.qty));
      try { await clickByText(driver, 'Save'); } catch {}
    }
  }
  await clickSave(driver);
}

async function fillMedicalModule(driver, med = {}) {
  await gotoLeftNav(driver, 'Medical');
  if (med.patientCount != null) await typeInto(driver, 'Patient Count', String(med.patientCount));
  if (med.age)                  await typeInto(driver, 'Age', String(med.age));
  if (med.sex)                  await selectOption(driver, 'Sex', med.sex);
  if (med.primaryImpression)    await selectOption(driver, 'Primary Impression', med.primaryImpression);
  await clickSave(driver);
}

async function waitForMatSelectToClose(driver, ms = 2500) {
  const sel = '.cdk-overlay-backdrop, .cdk-overlay-pane .mat-mdc-select-panel';
  try {
    await driver.wait(async () => {
      const els = await driver.findElements(By.css(sel));
      for (const e of els) { try { if (await e.isDisplayed()) return false; } catch {} }
      return true;
    }, ms);
  } catch {}
}

async function waitForOfficerCheckboxReady(driver, ms = 6000) {
  const labels = [
    'Member making report same as Officer in Charge',
    'Member Making Report',
    'Officer in Charge',
    'Officer-in-Charge'
  ];
  let el = null;
  for (const L of labels) {
    try { el = await findField(driver, L); break; } catch {}
  }
  if (!el) throw new Error('Officer-in-Charge checkbox not found');

  try { await driver.wait(until.elementIsEnabled(el), ms); } catch {}
  return el;
}

async function createRecordFlow(driver, opts = {}) {
  const deptName = process.env.FIR_FIRE_DEPT_NAME || 'MAIN / FD24027214';
  const station  = process.env.FIR_STATION        || 'Sta 1 : Main';
  const pickType = opts.incidentType || 'RANDOM';

  await ensureOnFirMain(driver);

  const opened = await withAlertGuard(driver, () => clickCreateIncident(driver), { retries: 2 });
  if (!opened) throw new Error('Could not click Create Incident');

  await driver.wait(async () => {
    const u = (await driver.getCurrentUrl()) || '';
    if (/\/neris\/create\b/i.test(u)) return true;
    const anyField = await driver.findElements(By.xpath(
      "//mat-form-field|//label|//input|//*[@aria-label or @placeholder]"
    ));
    return anyField.length > 0;
  }, 10000);

  await closeOverlays(driver);
  await pickFireDepartment(driver, 'Fire Department', deptName);
  await waitForNoOverlays(driver);
  try { await selectOption(driver, 'Station', station); } catch {}

  const { mm, dd, yyyy, hh, mi, ss } = nowParts();
  const dateStr = process.env.FIR_DATE || `${mm}/${dd}/${yyyy}`;
  const timeStr = process.env.FIR_TIME || `${hh}:${mi}:${ss}`;
  await setIncidentDateTimeWithVerify(driver, dateStr, timeStr);

  await closeOverlays(driver);
  await pickPrimaryIncidentType(driver, pickType);
  await waitForNoOverlays(driver, 750); 
  await optimisticToggleOfficer(driver, true, 6000);

  try {
    await setCheckboxSmart(driver, {
      name: 'reporterIsOfficer',
      labels: ['Member making report same as Officer in Charge','Member Making Report', 'Officer in Charge', 'Officer-in-Charge']
    }, true);
  } catch {}

  const result = await submitAndResolveValidation(driver, FIR.createButton);
  if (!result.ok) throw new Error('Create did not appear to complete');
  await driver.wait(until.urlMatches(/\/neris\/(details|view|incident|edit|[0-9]+)/i), 10000);

  const details = await readIncidentDetails(driver);
  return details;
}

describe('E2E: FIR (.env.cr.neris)', function () {
  this.timeout(120_000);
  this.retries(1);

  let driver;

  before(async () => {
    driver = createDriver();
    await login(driver);
    await drainAllAlerts(driver);
    await waitForNoAlerts(driver);
    await ensureOnFirMain(driver);
    await installStabilityProbes(driver);
  });

  after(async () => {
    if (!driver) return;
    try { await drainAllAlerts(driver); } catch {}
    try { await clickLogout(driver); } catch {}
    try { await driver.quit(); } catch {}
  });

  it('opens FIR from Applications', async () => {
    await ensureOnFirMain(driver);
  });

  it('renders the FIR shell/landing', async () => {
    await waitForNoAlerts(driver);
    const ok = await withAlertGuard(driver, async () => {
      return await driver.wait(async () => {
        const u = (await driver.getCurrentUrl()) || '';
        if (/\/neris(?:\/|$)/i.test(u)) return true;
        const head = await driver.findElements(By.xpath(
          "//h1[contains(translate(.,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'FIR')]"
        ));
        if (head.length) return true;
        const root = await driver.findElements(By.css(FIR.rootHook));
        return root.length > 0;
      }, 20000);
    }, { retries: 2 });
    expect(ok).to.equal(true, 'FIR landing not detected');
  });

  it('creates a new FIR record', async () => {
    await ensureOnFirMain(driver);
    const details = await createRecordFlow(driver);
    expect(details.id).to.match(/^\d+$/, 'Incident ID missing after create');
  });

  const runBatch = (
  (process.env.FIR_RUN_BATCH || '').toLowerCase() === 'true' &&
  Number(process.env.BATCH_COUNT || 0) >= 2
  );

    (runBatch ? it : it.skip)('creates BATCH_COUNT FIR records in one session (no relogin)', async function () {
    const N       = Number(process.env.BATCH_COUNT    || 5);
    const delayMs = Number(process.env.BATCH_DELAY_MS || 250);
    const runFixture = String(process.env.FIR_SMOKE_FIXTURE || '').toLowerCase() === 'true';

    this.timeout(120_000 + N * 60_000);

    for (let i = 0; i < N; i++) {
      const details = await createRecordFlow(driver);
      console.warn(`✅ Created incident ${i + 1}/${N}:`, details);

      if (runFixture) {
        await fillCoreExtras(driver, { cad: `CAD-${Date.now()}`, memberSame: true });
        await fillLocationSection(driver, {
          address1: '123 Substation Rd',
          city: 'Oak Ridge',
          state: 'TN',
          zip: '37830',
          locationType: 'Utility/Infrastructure'
        });
        await fillDispatchSection(driver, {
          callType: 'Fire',
          alarmLevel: '1',
          comments: ['Lines arcing near transformer', 'PD on scene']
        });
        await fillRespondingUnits(driver, [
          { id: 'E1', type: 'Engine', enroute: `${details.when?.slice(-8) || '08:00:00'}` },
          { id: 'L1', type: 'Ladder', enroute: `${details.when?.slice(-8) || '08:00:00'}` }
        ]);
        await fillFireModule(driver, {
          propertyUse: 'Utility or Construction Area',
          areaOfOrigin: 'Exterior balcony/porch/patio/yard',
          heatSource: 'Electrical arcing',
          itemFirstIgnited: 'Electrical wire/cable/conduit',
          cause: 'Equipment failure',
          lossDollar: 0
        });
        await clickSave(driver);
      }

      let advanced = false;
      try { await closeOverlays(driver); await clickByText(driver, 'Create Another'); advanced = true; } catch {}
      if (!advanced) {
        try { await closeOverlays(driver); await withAlertGuard(driver, () => goHome(driver)); } catch {}
        await ensureOnFirMain(driver);
      }

      if (i < N - 1 && delayMs) await driver.sleep(delayMs);
    }
  });

  const runManualFixture = String(process.env.FIR_SMOKE_FIXTURE || '').toLowerCase() === 'true';
  (runManualFixture ? it : it.skip)('fills required sections for Utility Infrastructure Fire and saves', async () => {
    await waitForNoOverlays(driver);
    const when = nowParts();
    const hhmmss = `${when.hh}:${when.mi}:${when.ss}`;

    const fixture = {
      core: { cad: `CAD-${Date.now()}`, memberSame: true },
      location: {
        address1: '123 Substation Rd',
        city:     'Oak Ridge',
        state:    'TN',
        zip:      '37830',
        locationType: 'Utility/Infrastructure'
      },
      dispatch: {
        callType:   'Fire',
        alarmLevel: '1',
        comments:   ['Lines arcing near transformer', 'PD on scene']
      },
      units: [
        { id: 'E1', type: 'Engine',  enroute: hhmmss, onscene: hhmmss, cleared: '' },
        { id: 'L1', type: 'Ladder',  enroute: hhmmss, onscene: hhmmss, cleared: '' }
      ],
      fire: {
        propertyUse: 'Utility or Construction Area',
        areaOfOrigin: 'Exterior balcony/porch/patio/yard',
        heatSource: 'Electrical arcing',
        itemFirstIgnited: 'Electrical wire/cable/conduit',
        cause: 'Equipment failure',
        lossDollar: 0
      },
      haz: { isHazmat: false, chemicals: [] },
      medical: null
    };

    await fillCoreExtras(driver, fixture.core);
    await fillLocationSection(driver, fixture.location);
    await fillDispatchSection(driver, fixture.dispatch);
    await fillRespondingUnits(driver, fixture.units);
    await fillFireModule(driver, fixture.fire);
    if (fixture.haz)     await fillHazSit(driver, fixture.haz);
    if (fixture.medical) await fillMedicalModule(driver, fixture.medical);

    await satisfyCoreTopTabs(driver);
    await resolveAllTopTabs(driver, ['Core','Dispatch','Location','Mutual Aid','Actions/Tactics','Additional Info']);

    await clickSave(driver);
    const details = await readIncidentDetails(driver);
    expect(details.id).to.match(/^\d+$/, 'Incident ID missing');
    expect(details.num).to.match(/^\d+$/, 'Incident Number missing');
  });

  it('navigates back Home cleanly', async () => {
    await closeOverlays(driver);
    await withAlertGuard(driver, () => goHome(driver));
    const home = await driver.wait(
      until.elementsLocated(By.xpath(
        "//*[contains(.,'Applications') or contains(.,'APPLICATIONS') or contains(.,'Modules') or contains(.,'MODULES')]"
      )),
      15000
    );
    expect(home.length).to.be.greaterThan(0);
  });
});

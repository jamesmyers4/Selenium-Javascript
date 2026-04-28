// utils/topTabsRequired.js
import { By, Key, until } from 'selenium-webdriver';

const norm = s => (s||'').replace(/\s+/g,' ').trim();
const first = arr => (arr && arr.length ? arr[0] : null);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// --- navigation (local, non-conflicting) ---
async function clickLeftSection(driver, label) {
  const by = By.xpath(`//*[self::a or self::button or @role='button'][normalize-space(.)='${label}' or .//span[normalize-space(.)='${label}']]`);
  const el = first(await driver.findElements(by));
  if (!el) throw new Error(`Left section "${label}" not found`);
  try { await el.click(); } catch { await driver.executeScript('arguments[0].click();', el); }
  await driver.wait(async () => (await driver.findElements(By.css('[role="tablist"] [role="tab"]'))).length > 0, 6000).catch(()=>{});
}

async function clickTopTab(driver, label) {
  const tries = [
    By.xpath(`//div[contains(@class,'mat-mdc-tab-label-content') and normalize-space(.)='${label}']`),
    By.xpath(`//button[@role='tab'][.//span[contains(@class,'mdc-tab__text-label') and normalize-space(.)='${label}']]`),
    By.xpath(`//*[@role='tablist']//*[@role='tab' and (normalize-space(.)='${label}' or .//span[normalize-space(.)='${label}'])]`)
  ];
  for (const by of tries) {
    const el = first(await driver.findElements(by));
    if (el) {
      try { await el.click(); } catch { await driver.executeScript('arguments[0].click();', el); }
      await driver.wait(until.elementLocated(By.css('.mat-mdc-tab-body-active,[role="tabpanel"]:not([aria-hidden="true"])')), 6000).catch(()=>{});
      return;
    }
  }
  throw new Error(`Top tab "${label}" not found`);
}

function activeTabPanel(driver) {
  return driver.findElements(By.css('.mat-mdc-tab-body-active,[role="tabpanel"]:not([aria-hidden="true"])')).then(a => first(a));
}

// --- save button (page-level) ---
async function clickPageSave(driver) {
  const btn = first(await driver.findElements(By.xpath(
    "//*[self::button or self::a][@aria-label='Save' or normalize-space(.)='Save' or .//span[normalize-space(.)='Save']]"
  )));
  if (btn) { try { await btn.click(); } catch { await driver.executeScript('arguments[0].click();', btn); } }
  await sleep(200);
}

// --- generic control filler ---
async function smartFill(driver, el, labelHint='') {
  const tag  = (await el.getTagName()).toLowerCase();
  const type = (await el.getAttribute('type') || '').toLowerCase();
  const role = (await el.getAttribute('role') || '').toLowerCase();
  const lab  = norm(labelHint || await driver.executeScript(`
    const c=arguments[0], ff=c.closest && c.closest('.mat-mdc-form-field,.mat-form-field');
    const L=ff && (ff.querySelector('label, mat-label')); return L? (L.innerText||L.textContent||''):'';
  `, el).catch(()=>''));  

  // Date/Time
  if (/date/i.test(lab) || type==='date') {
    const d=new Date(), mm=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'), yy=d.getFullYear();
    const v=`${mm}/${dd}/${yy}`;
    try{await el.clear();}catch{}; try{await el.sendKeys(v, Key.TAB);}catch{await driver.executeScript('arguments[0].value=arguments[1]', el, v);}
    return;
  }
  if (/time/i.test(lab) || type==='time') {
    const d=new Date(), hh=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0'), ss=String(d.getSeconds()).padStart(2,'0');
    const v=`${hh}:${mi}:${ss}`;
    try{await el.clear();}catch{}; try{await el.sendKeys(v, Key.TAB);}catch{await driver.executeScript('arguments[0].value=arguments[1]', el, v);}
    return;
  }

  // Selects / combobox
  if (tag==='mat-select' || role==='combobox' || tag==='select') {
    if (tag==='select') {
      const opts = await el.findElements(By.css('option:not([disabled])'));
      if (opts.length) { await opts[Math.min(1, opts.length-1)].click(); return; }
    }
    try{await el.click();}catch{await driver.executeScript('arguments[0].click();', el);}
    await driver.wait(until.elementLocated(By.css('.mat-mdc-select-panel')), 3000).catch(()=>{});
    const opts = await driver.findElements(By.css(
      '.mat-mdc-option:not([aria-disabled="true"]) .mdc-list-item__primary-text, .mat-mdc-option:not([aria-disabled="true"])'
    ));
    if (opts.length) {
      // choose first non-placeholder
      let pick = opts[0];
      for (const o of opts) {
        const t = norm(await o.getText().catch(async()=>await o.getAttribute('innerText')));
        if (t && !/^select\b/i.test(t)) { pick = o; break; }
      }
      try{await pick.click();}catch{await driver.executeScript('arguments[0].click();', pick);}
    }
    await sleep(100);
    return;
  }

  // Radios / checkbox
  if (role==='radiogroup') {
    const radios = await el.findElements(By.css('input[type="radio"]:not([disabled]), .mat-mdc-radio-button'));
    if (radios.length) { try{await radios[0].click();}catch{await driver.executeScript('arguments[0].click();', radios[0]);} }
    return;
  }
  if (type==='checkbox') { try{await el.click();}catch{await driver.executeScript('arguments[0].click();', el);} return; }

  // Numbers / typical numeric labels
  if (/amount|count|number|qty|level|loss|mile|zip|est/i.test(lab) || type==='number') {
    try{await el.clear();}catch{}; try{await el.sendKeys('1');}catch{await driver.executeScript('arguments[0].value="1";', el);} return;
  }

  // Fallback text
  try{await el.clear();}catch{}; try{await el.sendKeys('Auto');}catch{await driver.executeScript('arguments[0].value="Auto";', el);}
}

// --- find required fields by asterisk/attributes within active tab ---
async function findStarRequiredControls(driver) {
  const panel = await activeTabPanel(driver) || driver;

  // find field wrappers that look required
  const wrappers = await panel.findElements(By.css(
    '.mat-mdc-form-field:has(.mat-mdc-form-field-required-marker),' + // modern :has in Chromium
    '.mat-form-field:has(.mat-form-field-required-marker),' +         // older Material
    '.mat-mdc-form-field, .mat-form-field'                            // fallback; we’ll filter inside
  ));

  const controls = [];

  for (const w of wrappers) {
    const isRequired = await driver.executeScript(`
      const w = arguments[0];
      const hasStar = !!w.querySelector('.mat-mdc-form-field-required-marker,.mat-form-field-required-marker');
      if (hasStar) return true;
      const lab = w.querySelector('label, mat-label');
      if (lab && /\\*/.test((lab.innerText||lab.textContent||''))) return true;
      return false;
    `, w).catch(()=>false);

    if (!isRequired) continue;

    // find the real control inside
    const ctl = first(await w.findElements(By.css('input,textarea,select,mat-select,[role="combobox"],[role="radiogroup"],input[type="checkbox"]')));
    if (ctl) controls.push(ctl);
  }

  // also capture any controls marked required directly (aria-required/required)
  const direct = await panel.findElements(By.css('[required], [aria-required="true"]'));
  for (const c of direct) controls.push(c);

  // dedupe by element id
  const seen = new Set();
  const uniq = [];
  for (const c of controls) {
    const id = await c.getId();
    if (!seen.has(id)) { seen.add(id); uniq.push(c); }
  }
  return uniq;
}

// --- repair pass based on error messages in active tab ---
async function fixErrorsInActiveTab(driver) {
  const panel = await activeTabPanel(driver) || driver;
  const msgs = await panel.findElements(By.css('.mat-mdc-form-field-error, .mat-error, [role="alert"].mat-mdc-form-field-error'));
  let fixed = 0;
  for (const m of msgs) {
    const ctl = await driver.executeScript(`
      const e = arguments[0];
      const field = e.closest && (e.closest('.mat-mdc-form-field,.mat-form-field,[role="group"],.field') || e);
      return field.querySelector && (field.querySelector('input,textarea,select,mat-select,[role="combobox"],[role="radiogroup"],input[type="checkbox"]')) || e;
    `, m);
    if (ctl) { await smartFill(driver, ctl, await m.getText().catch(()=>'')); fixed++; }
  }
  return fixed;
}

// --- one full pass on a tab: fill star required, save, fix errors, save ---
export async function satisfyRequiredOnTopTab(driver, tabLabel) {
  await clickTopTab(driver, tabLabel);

  // 1) fill all fields that show the red asterisk
  const starControls = await findStarRequiredControls(driver);
  for (const c of starControls) { await smartFill(driver, c); }

  // 2) save, then repair any inline validation that remains
  await clickPageSave(driver);
  const repaired = await fixErrorsInActiveTab(driver);
  if (repaired) {
    await clickPageSave(driver);
  }
}

// --- run for all top tabs within the current left section (Core) ---
export async function satisfyCoreTopTabs(driver, tabLabels = ['Core','Dispatch','Location','Mutual Aid','Actions/Tactics','Additional Info']) {
  await clickLeftSection(driver, 'Core');
  for (const lbl of tabLabels) {
    try {
      await satisfyRequiredOnTopTab(driver, lbl);
    } catch (e) {
      // Tab may not exist for some configurations—skip quietly
      // console.log(`[tabs] skip ${lbl}:`, e.message);
    }
  }
}

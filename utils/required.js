// utils/required.js
import { By, Key, until } from 'selenium-webdriver';
import { clickByText, findField, selectOption, typeInto, setCheckboxSmart } from './forms.js';
import { closeOverlays } from './ui.js';

// --- small utils ---
const norm = s => (s || '').replace(/\s+/g, ' ').trim();
const first = arr => (arr && arr.length ? arr[0] : null);

async function waitShort(ms=150){ return new Promise(r=>setTimeout(r,ms)); }

// Try to click Save on the page (top right Save button in your layout)
export async function clickPageSave(driver) {
  await closeOverlays(driver);
  // your clickSave uses alerts; here we look for the visible "Save" button on the page
  const candidates = await driver.findElements(By.xpath(
    "//*[self::button or self::a][@aria-label='Save' or normalize-space(.)='Save' or .//span[normalize-space(.)='Save']]"
  ));
  if (candidates.length) {
    try { await candidates[0].click(); } catch { await driver.executeScript('arguments[0].click();', candidates[0]); }
  } else {
    // fallback to your generic clickByText
    try { await clickByText(driver, 'Save'); } catch {}
  }
  await waitShort(200);
}

// Collect visible validation problems within the active tab body
async function collectTabProblems(driver) {
  // Active tab panel in MDC/Material
  const scope = first(await driver.findElements(By.css('.mat-mdc-tab-body.mat-mdc-tab-body-active,[role="tabpanel"]:not([aria-hidden="true"])'))) || driver;

  // (1) explicit error messages
  const msgEls = await scope.findElements(By.css('.mat-mdc-form-field-error, .mat-error, [role="alert"].mat-mdc-form-field-error'));
  // (2) invalid controls (no message text sometimes)
  const invalidEls = await scope.findElements(By.css('[aria-invalid="true"], input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid'));

  // De-dup by nearest form-field container to avoid duplicates
  function uniqByKey(list, keyer){ const m = new Map(); list.forEach(x=>m.set(keyer(x), x)); return [...m.values()]; }

  const problems = [];
  for (const e of msgEls) {
    problems.push({ kind: 'msg', el: e, text: norm(await e.getText().catch(()=>'')) });
  }
  for (const e of invalidEls) {
    problems.push({ kind: 'invalid', el: e, text: '' });
  }

  // Map each problem to a control to fill
  const mapped = [];
  for (const p of problems) {
    const ctl = await driver.executeScript(`
      const el = arguments[0];
      // walk up to the nearest field container
      const field = el.closest && (el.closest('.mat-mdc-form-field,.mat-form-field,.form-field,.field,.mat-mdc-form-field-infix')) || el;
      // within that, find an interactive control
      const ctl = field.querySelector && (field.querySelector('input,textarea,select,mat-select,[role="combobox"],[role="radiogroup"]')) || null;
      return ctl || el;
    `, p.el);
    mapped.push({ ...p, control: ctl || p.el });
  }

  // De-dup by control element id/path
  return uniqByKey(mapped, x => x.control.getId ? x.control.getId() : Math.random().toString(36));
}

// Open a mat-select or ARIA combobox and choose a non-placeholder option
async function selectAnyOption(driver, controlEl) {
  try { await controlEl.click(); } catch { await driver.executeScript('arguments[0].click();', controlEl); }

  // panel for MDC select
  await driver.wait(until.elementLocated(By.css('.mat-mdc-select-panel')), 3000).catch(()=>{});
  const opts = await driver.findElements(By.css(
    '.mat-mdc-option:not([aria-disabled="true"]) .mdc-list-item__primary-text,' +
    '.mat-mdc-option:not([aria-disabled="true"])'
  ));
  if (!opts.length) return false;

  // skip placeholders like "Select..." when present
  let pick = opts[0];
  for (const o of opts) {
    const t = norm(await o.getText().catch(async () => await o.getAttribute('innerText')));
    if (t && !/^select\b/i.test(t)) { pick = o; break; }
  }
  try { await pick.click(); } catch { await driver.executeScript('arguments[0].click();', pick); }
  await waitShort(150);
  return true;
}

// Generic filler for a single control
async function smartFillControl(driver, controlEl, labelHint='') {
  // Identify control type
  const tag = (await controlEl.getTagName()).toLowerCase();
  const typeAttr = (await controlEl.getAttribute('type') || '').toLowerCase();
  const role = (await controlEl.getAttribute('role') || '').toLowerCase();

  // Try to infer label text (for special cases like State/Zip/Date/Time)
  const hint = labelHint || await driver.executeScript(`
    const c = arguments[0];
    const ff = c.closest && c.closest('.mat-mdc-form-field,.mat-form-field');
    const lab = ff && ff.querySelector('label, mat-label');
    return lab ? (lab.innerText || lab.textContent || '').trim() : '';
  `, controlEl).catch(()=>'');

  const label = norm(hint || '');

  // Dates/Times
  if (/date/i.test(label) || typeAttr === 'date') {
    const d = new Date();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yyyy = d.getFullYear();
    const dateStr = `${mm}/${dd}/${yyyy}`;
    try { await controlEl.clear(); } catch {}
    try { await controlEl.sendKeys(dateStr, Key.TAB); } catch { await driver.executeScript('arguments[0].value = arguments[1];', controlEl, dateStr); }
    return;
  }
  if (/time/i.test(label) || typeAttr === 'time') {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    const timeStr = `${hh}:${mi}:${ss}`;
    try { await controlEl.clear(); } catch {}
    try { await controlEl.sendKeys(timeStr, Key.TAB); } catch { await driver.executeScript('arguments[0].value = arguments[1];', controlEl, timeStr); }
    return;
  }

  // Select / combobox
  if (tag === 'mat-select' || role === 'combobox' || tag === 'select') {
    // If it's a native <select>, try a simple selectOption by label if we can guess, else open & pick anything
    if (tag === 'select') {
      const options = await controlEl.findElements(By.css('option:not([disabled])'));
      if (options.length > 1) {
        // pick first non-placeholder
        const opt = options.find(async o => (await o.getAttribute('value') || '').trim()) || options[1];
        await opt.click();
        return;
      }
    }
    await selectAnyOption(driver, controlEl);
    return;
  }

  // Radio group: choose first enabled
  if (role === 'radiogroup') {
    const radios = await controlEl.findElements(By.css('input[type="radio"]:not([disabled]), .mat-mdc-radio-button'));
    if (radios.length) {
      try { await radios[0].click(); } catch { await driver.executeScript('arguments[0].click();', radios[0]); }
    }
    return;
  }

  // Checkbox: set to true
  if (typeAttr === 'checkbox') {
    try { await controlEl.click(); } catch { await driver.executeScript('arguments[0].click();', controlEl); }
    return;
  }

  // Number-ish fields: put a small positive value
  if (/amount|count|number|qty|level|loss|mile|zip|est/i.test(label) || typeAttr === 'number') {
    try { await controlEl.clear(); } catch {}
    try { await controlEl.sendKeys('1'); } catch { await driver.executeScript('arguments[0].value="1";', controlEl); }
    return;
  }

  // Plain text
  try { await controlEl.clear(); } catch {}
  try { await controlEl.sendKeys('Auto'); } catch { await driver.executeScript('arguments[0].value="Auto";', controlEl); }
}

// Fill visible required errors on current tab, return number fixed
export async function fixTabErrorsOnce(driver) {
  const problems = await collectTabProblems(driver);
  let fixed = 0;

  for (const p of problems) {
    // Find a concrete input/select within the same field wrapper (more precise than the error node itself)
    const ctl = await driver.executeScript(`
      const e = arguments[0];
      const field = e.closest && (e.closest('.mat-mdc-form-field,.mat-form-field,[role="group"],.field') || e);
      return field.querySelector && (field.querySelector('input,textarea,select,mat-select,[role="combobox"],[role="radiogroup"],input[type="checkbox"]')) || e;
    `, p.control);

    if (!ctl) continue;
    await smartFillControl(driver, ctl, p.text);
    fixed++;
  }
  return fixed;
}

// Try to make the current tab "clean": save → fix → save → ...
export async function resolveRequiredOnActiveTab(driver, { maxPasses = 4 } = {}) {
  for (let pass = 0; pass < maxPasses; pass++) {
    await clickPageSave(driver);
    await waitShort(200);

    const fixed = await fixTabErrorsOnce(driver);
    if (!fixed) {
      // One last save to be sure the tab is clean
      await clickPageSave(driver);
      return true;
    }
  }
  return false; // still errors after passes
}

// Iterate through tabs with robust tab clicker
export async function gotoTopTab(driver, label, { waitMs = 10000 } = {}) {
  const tryLocs = [
    By.xpath(`//div[contains(@class,'mat-mdc-tab-label-content') and normalize-space(.)='${label}']`),
    By.xpath(`//button[@role='tab'][.//span[contains(@class,'mdc-tab__text-label') and normalize-space(.)='${label}']]`),
    By.xpath(`//*[@role='tablist']//*[@role='tab' and (normalize-space(.)='${label}' or .//span[normalize-space(.)='${label}'])]`)
  ];
  let tab = null;
  for (const by of tryLocs) {
    const found = await driver.findElements(by);
    if (found.length) { tab = found[0]; break; }
  }
  if (!tab) throw new Error(`Tab "${label}" not found`);
  try { await tab.click(); } catch { await driver.executeScript('arguments[0].click();', tab); }
  await driver.wait(until.elementLocated(By.css('.mat-mdc-tab-body-active,[role="tabpanel"]')), waitMs);
}

// High-level: resolve required fields across the top tabs
export async function resolveAllTopTabs(driver, labels = ['Core','Dispatch','Location','Mutual Aid','Actions/Tactics','Additional Info']) {
  for (const label of labels) {
    try {
      await gotoTopTab(driver, label);
      await resolveRequiredOnActiveTab(driver);
    } catch (e) {
      // Not all tabs appear for all incident types; skip cleanly
      // console.log(`[tabs] skipping ${label}:`, e.message);
    }
  }
}

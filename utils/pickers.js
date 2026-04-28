// utils/pickers.js (ESM)
import { By, until, Key } from 'selenium-webdriver';
import { clickByText, findField } from './forms.js';
import { closeOverlays, waitForNoOverlays } from './ui.js';
import path from 'node:path';
import { cfg } from './config.pwrtrx.js';
import { saveScreenshot, writeText } from './diagnostics.js';

// ---------- small helpers ----------
async function clickEl(driver, el, timeout = 10000) {
  await driver.wait(until.elementIsVisible(el), timeout, 'Element not visible');
  await driver.wait(until.elementIsEnabled(el), timeout, 'Element not enabled');

  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);

  try { 
    await el.click();
  } catch (err) { 
    await driver.executeScript("arguments[0].click();", el); 
  }
}

async function visibleOverlays(driver) {
  const panes = await driver.findElements(
    By.css('.cdk-overlay-pane, .mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"], .mat-select-panel, .mat-mdc-select-panel')
  );
  const vs = [];
  for (const p of panes) { try { if (await p.isDisplayed()) vs.push(p); } catch {} }
  return vs;
}

async function topOverlay(driver) {
  const vs = await visibleOverlays(driver);
  return vs.length ? vs[vs.length - 1] : null;
}

async function waitForPrimaryCauseOverlay(driver, timeoutMs = 8000) {
  const overlay = await driver.wait(async () => {
    const overlays = await driver.findElements(By.css('.cdk-overlay-pane, .mat-select-panel, .mat-dialog-container'));
    for (let o of overlays) {
      const header = await o.findElements(By.xpath('.//h2[text()="Select a Primary Cause"]'));
      if (header.length) return o;
    }
    return null;
  }, timeoutMs);
  await driver.wait(until.elementIsVisible(overlay), 4000);
  return overlay;
}

// ---------- checkbox logic inside table rows ----------
async function isRowChecked(row) {
  try {
    // role="checkbox"
    const roleBoxes = await row.findElements(By.css('[role="checkbox"]'));
    for (const b of roleBoxes) {
      const v = await b.getAttribute('aria-checked');
      if (String(v).toLowerCase() === 'true') return true;
    }
    // <input type="checkbox">
    const inputs = await row.findElements(By.css('input[type="checkbox"]'));
    for (const i of inputs) {
      if (await i.isSelected().catch(()=>false)) return true;
      if ((await i.getAttribute('checked')) === 'true') return true;
      const p = await i.findElements(By.xpath('ancestor::*[@aria-checked="true"]'));
      if (p.length) return true;
    }
    // Mat checkbox host/classes
    const mats = await row.findElements(By.css('mat-checkbox, .mat-mdc-checkbox'));
    for (const m of mats) {
      const aria = await m.getAttribute('aria-checked');
      if (String(aria).toLowerCase() === 'true') return true;
      const cls = (await m.getAttribute('class')) || '';
      if (/\bmat-mdc-checkbox-checked\b/i.test(cls)) return true;
    }
    // Row selected styles
    const rcls = (await row.getAttribute('class')) || '';
    if (/\bselected\b/i.test(rcls)) return true;
    if ((await row.getAttribute('aria-selected')) === 'true') return true;
  } catch {}
  return false;
}

async function clickLikelyCheckbox(driver, row) {
  const candidates = [
    By.css('input.mdc-checkbox__native-control'),
    By.css('input[type="checkbox"]'),
    By.css('[role="checkbox"]'),
    By.css('mat-checkbox'),
    By.css('.mat-mdc-checkbox'),
    By.css('.mat-pseudo-checkbox'),
    By.xpath('./self::tr/td[1] | .//td[1] | .//*[contains(@class,"checkbox")]')
  ];
  for (const by of candidates) {
    const els = await row.findElements(by);
    for (const el of els) {
      try { await clickEl(driver, el); return true; } catch {}
    }
  }

  // Sometimes the checkbox icon is non-interactive; the parent option toggles:
  const optionAncestors = await row.findElements(By.xpath(
    "ancestor-or-self::*[@role='option' or contains(@class,'mat-option') or contains(@class,'mat-list-option') or contains(@class,'mat-row')]"
  ));
  for (const el of optionAncestors) {
    try { await clickEl(driver, el); return true; } catch {}
  }
  return false;
}

async function offsetClickLeftCheckbox(driver, row) {
  try {
    const rect = await driver.executeScript(`
      const r = arguments[0].getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, midY: r.y + r.height/2 };
    `, row);
    const actions = driver.actions({ async: true });
    await actions.move({ x: Math.max(5, Math.floor(rect.x + 24)), y: Math.floor(rect.midY) })
                .press().release().perform();
    return true;
  } catch { return false; }
}

async function toggleRowCheckbox(driver, row, wantChecked = true) {
  if (await isRowChecked(row) === wantChecked) return;
  // 1) Direct checkbox/icon or option container
  if (await clickLikelyCheckbox(driver, row)) {
    await driver.sleep(150);
    if (await isRowChecked(row) === wantChecked) return;
  }
  // 2) Row click toggles in many mat-tables
  try {
    await clickEl(driver, row);
    await driver.sleep(150);
    if (await isRowChecked(row) === wantChecked) return;
  } catch {}

  // 3) Send SPACE to any role=checkbox inside the row
  try {
    const boxes = await row.findElements(By.css('[role="checkbox"], input[type="checkbox"]'));
    if (boxes.length) {
      try { await boxes[0].sendKeys(Key.SPACE); } catch {}
      await driver.sleep(150);
      if (await isRowChecked(row) === wantChecked) return;
    }
  } catch {}

  if (await offsetClickLeftCheckbox(driver, row)) {
    await driver.sleep(200);
    if (await isRowChecked(row) === wantChecked) return;
  }
  throw new Error('Could not toggle checkbox on row');
}

// ---------- row finding ----------
async function overlayFindRowByText(driver, text) {
  const overlay = await topOverlay(driver);
  if (!overlay) return null;
  const T = (text || '').trim().toUpperCase().replace(/"/g, '\\"');
  const rows = await overlay.findElements(By.xpath(
    `.//*[self::tr or self::li or self::div[contains(@class,'row')]]` +
    `[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'), "${T}")]`
  ));
  for (const r of rows) {
    try { if (await r.isDisplayed()) return r; } catch {}
  }
  return null;
}

async function overlayPickRandomRow(driver) {
  const overlay = await topOverlay(driver);
  if (!overlay) return null;
  const rows = await overlay.findElements(By.css('tr, li, .mat-list-item, .mdc-list-item, .row, .list-item'));
  const vis = [];
  for (const r of rows) { try { if (await r.isDisplayed()) vis.push(r); } catch {} }
  if (!vis.length) return null;
  return vis[Math.max(0, Math.min(vis.length - 1, Math.floor(vis.length / 2)))];
}

export async function pickFromDialogByText(driver, { openByLabel, text = null, confirmButtonText = 'Select', retry = 2 } = {}) {
  async function topPane() {
    const panes = await driver.findElements(By.css('.cdk-overlay-pane'));
    return panes.length ? panes[panes.length - 1] : null;
  }

  async function collectOptionsInPane(pane) {
    const optionSelectors = [
      '.mat-mdc-select-panel [role="option"], .mat-select-panel [role="option"]',
      '.mat-mdc-option, mat-option',
      '.mat-list-item, .mdc-list-item, .mat-list .mat-list-item',
      'table.mat-mdc-table cdk-virtual-scroll-viewport tbody tr, table.cdk-table tbody tr'
    ];
    for (const sel of optionSelectors) {
      const els = await pane.findElements(By.css(sel));
      const visible = [];
      for (const e of els) {
        try {
          if (!(await e.isDisplayed())) continue;
          let txt = (await e.getText()) || '';
          txt = txt.trim().replace(/\s+/g, ' ');
          if (!txt) continue;
          visible.push({ el: e, txt });
        } catch {}
      }
      if (visible.length) return visible;
    }
    // fallback: any clickable descendant with text
    const all = await pane.findElements(By.css('*'));
    const collected = [];
    for (const e of all) {
      try {
        if (!(await e.isDisplayed())) continue;
        const txt = (await e.getText() || '').trim();
        if (txt && txt.length < 200) collected.push({ el: e, txt });
      } catch {}
    }
    return collected;
  }

  // helper: click and return text
  async function chooseAndReturn(opt) {
    try {
      await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', opt.el);
      try { await opt.el.click(); } catch { await driver.executeScript('arguments[0].click()', opt.el); }
    } catch (err) { throw new Error('Could not click option: ' + err); }
    
        if (confirmButtonText) {
      try {
        // scope confirm button search to the current top overlay/pane to avoid picking unrelated "Select" buttons
        const panes = await driver.findElements(By.css('.cdk-overlay-pane'));
        const pane = panes.length ? panes[panes.length - 1] : null;
        if (pane) {
          const confirm = await pane.findElements(By.xpath(`.//*[self::button or self::a][.//span[normalize-space()="${confirmButtonText}"] or normalize-space(.)='${confirmButtonText}']`));
          if (confirm.length) { try { await confirm[0].click(); } catch { await driver.executeScript('arguments[0].click()', confirm[0]); } }
        } else {
          // fallback to global if no overlay is found
          const confirm = await driver.findElements(By.xpath(`//*[self::button or self::a][.//span[normalize-space()="${confirmButtonText}"] or normalize-space(.)='${confirmButtonText}']`));
          if (confirm.length) { try { await confirm[0].click(); } catch { await driver.executeScript('arguments[0].click()', confirm[0]); } }
        }
      } catch {}
    }

    // wait for overlay to close (best-effort)
    try {
      await driver.wait(async () => {
        const panes = await driver.findElements(By.css('.cdk-overlay-pane'));
        return panes.length === 0 || !(panes[panes.length - 1]);
      }, 5000).catch(()=>{});
      
    } catch {}
    return opt.txt;
  }

  // attempt flow with retries
  for (let attempt = 0; attempt <= retry; attempt++) {
    // open the control by clicking the field/label trigger
    const opener = await findField(driver, openByLabel).catch(async () => {
      // try alternative: a button following label
      const alt = await driver.findElements(By.xpath(`//label[normalize-space()="${openByLabel}"]/following::button[1]`));
      if (alt.length) return alt[0];
      throw new Error(`Could not locate control to open picker for "${openByLabel}"`);
    });
    try { await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', opener); } catch {}
    try { await opener.click(); } catch { await driver.executeScript('arguments[0].click()', opener); }

    // wait for pane, collect options
    const pane = await driver.wait(async () => await topPane(), 4000).catch(() => null);
    if (!pane) {
      // nothing appeared — try again
      if (attempt === retry) throw new Error('No overlay pane appeared after opening control: ' + openByLabel);
      await driver.sleep(200);
      continue;
    }

    const opts = await collectOptionsInPane(pane);
    if (!opts.length) {
      // try small scroll to nudge virtual lists
      try { await driver.executeScript('const p=document.querySelector(".cdk-overlay-pane"); if(p){ const sc=p.querySelector(".cdk-virtual-scroll-viewport, .mat-dialog-content, .mat-mdc-dialog-content"); if(sc) sc.scrollTop = 200; }'); } catch {}
      await driver.sleep(150);
      const opts2 = await collectOptionsInPane(pane);
      if (opts2.length) {
        // use opts2
        const chosen = text ? opts2.find(o => new RegExp(text, 'i').test(o.txt)) : opts2[Math.floor(opts2.length/2)];
        if (!chosen) {
          if (attempt === retry) throw new Error('No matching option found in overlay for ' + openByLabel);
          await driver.sleep(120);
          continue;
        }
        return await chooseAndReturn(chosen);
      }
      if (attempt === retry) throw new Error('Overlay opened but no options detected for ' + openByLabel);
      await driver.sleep(150);
      continue;
    }

    // find explicit match or pick one
    let chosen = null;
    if (text) {
      chosen = opts.find(o => new RegExp(text, 'i').test(o.txt));
    } else {
      chosen = opts[Math.floor(opts.length / 2)];
    }
    if (!chosen) {
      if (attempt === retry) throw new Error('No matching option found in overlay for ' + openByLabel);
      await driver.sleep(120);
      continue;
    }

    // click and return the text
    return await chooseAndReturn(chosen);
  } // retries

  throw new Error('Failed to pick option from dialog');
}


// ---------- FIR-specific wrappers ----------
export async function pickFireDepartment(driver, labelText = 'Fire Department', nameToSelect) {
  await pickFromDialogByText(driver, { openByLabel: labelText, text: nameToSelect, confirmButtonText: 'Select' });
}


//--------Checkbox Checker -----------------
// -------- deterministic random per session (no env) --------
async function chooseIndex(n, driver) {
  return await driver.executeScript(`
    const n = arguments[0];
    if (!sessionStorage.getItem('nerisRandSeed')) {
      const seed = Math.floor((performance.timeOrigin % 2147483647) ^ Math.floor(Math.random()*1e9));
      sessionStorage.setItem('nerisRandSeed', String(seed));
      sessionStorage.setItem('nerisRandCounter', '0');
    }
    let seed = parseInt(sessionStorage.getItem('nerisRandSeed'), 10) >>> 0;
    let ctr  = parseInt(sessionStorage.getItem('nerisRandCounter'), 10) >>> 0;

    function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}}
    let r; let rng = mulberry32(seed);
    for (let i=0;i<=ctr;i++) r = rng();
    sessionStorage.setItem('nerisRandCounter', String(ctr+1));
    return Math.floor(r * n);
  `, n);
}

const norm = s => (s||'').replace(/\s+/g,' ').trim();

async function leaveAllFrames(driver) { try { await driver.switchTo().defaultContent(); } catch {} }

async function openIncidentTypeControl(driver, labelText) {
  const field = await findField(driver, labelText).catch(async () => {
    const alt = await driver.findElements(By.xpath(
      `//label[normalize-space(.)='${labelText}']/following::*[self::mat-select or @role='combobox' or self::button][1]`
    ));
    if (alt.length) return alt[0];
    const near = await driver.findElements(By.xpath(
      `//*[self::button or self::a][contains(.,'Select') or contains(.,'Choose')][1]`
    ));
    if (near.length) return near[0];
    throw new Error(`Could not locate control for ${labelText}`);
  });

  try { await field.click(); } catch { await driver.executeScript('arguments[0].click();', field); }

  // Wait for either a select panel or a dialog (your case)
  await driver.wait(async () => {
    const sel = await driver.findElements(By.css('.mat-mdc-select-panel'));
    const dlg = await driver.findElements(By.css('.cdk-overlay-pane .mat-mdc-dialog-content, .cdk-overlay-pane .mat-dialog-content'));
    return sel.length > 0 || dlg.length > 0;
  }, 8000);
  // Wait for Paginator
  await driver.wait(async () => {
  const pane = await getTopOverlayPane(driver);
  if (!pane) return false;
  const p = await pane.findElements(By.css('.mat-mdc-paginator, .mat-paginator'));
  return p.length > 0;
}, 4000).catch(() => {});

}

async function logPaginatorState(driver) {
  try {
    const pane = await getTopOverlayPane(driver);
    if (!pane) return;
    const paginator = (await pane.findElements(By.css('.mat-mdc-paginator, .mat-paginator')))[0];
    if (!paginator) return;

    const sizeEl  = (await paginator.findElements(By.css('.mat-mdc-paginator-page-size-value, .mat-paginator-page-size-value')))[0];
    const rangeEl = (await paginator.findElements(By.css('.mat-mdc-paginator-range-label, .mat-paginator-range-label')))[0];

    const pageSize = sizeEl ? (await sizeEl.getText()).trim() : '(n/a)';
    const range    = rangeEl ? (await rangeEl.getText()).trim() : '(n/a)';

    console.log(`[Paginator] size=${pageSize} range="${range}"`);
  } catch { /* debug-only */ }
}


// -------- NEW: gather options from mat-table with checkbox column --------
async function gatherFromMatTable(driver, { filterRx = null } = {}) {
  // Scope to topmost overlay
  const panes = await driver.findElements(By.css('.cdk-overlay-pane'));
  const pane = panes.length ? panes[panes.length - 1] : null;
  if (!pane) return [];

  // Rows under the table’s tbody (exclude header row)
  const rowEls = await pane.findElements(By.css(
    'table.mat-mdc-table.cdk-table tbody tr.mat-mdc-row, ' +   // MDC style
    'table.cdk-table tbody tr[role="row"]:not(.mat-mdc-header-row)' // fallback
  ));
  if (!rowEls.length) return [];

  const options = [];
  for (const row of rowEls) {
    try {
      // Prefer any non-checkbox cell text as the label
      const text = await driver.executeScript(`
        const row = arguments[0];
        const cells = Array.from(row.querySelectorAll('td'));
        const txt = cells
          .filter(td => !td.classList.contains('mat-column-checkbox') && !td.classList.contains('cdk-column-select') && !td.classList.contains('mat-column-select'))
          .map(td => (td.innerText || td.textContent || '').trim())
          .join(' | ')
          .replace(/\\s+/g,' ')
          .trim();
        return txt;
      `, row);
      const txt = norm(text);
      if (filterRx && txt && !filterRx.test(txt)) continue;

      // Find a reliable click target in the checkbox column
      let checkTarget = null;

      // 1) actual input if present
      const inputCandidates = await row.findElements(By.css(
        'td.mat-column-checkbox input[type="checkbox"], ' +
        'td.cdk-column-select input[type="checkbox"], ' +
        'input[type="checkbox"].mdc-checkbox__native-control'
      ));
      if (inputCandidates.length) checkTarget = inputCandidates[0];

      // 2) wrapper of the checkbox cell (common in MDC)
      if (!checkTarget) {
        const wrapCandidates = await row.findElements(By.css(
          'td.mat-column-checkbox .mat-mdc-checkbox, td.cdk-column-select .mat-mdc-checkbox, td.mat-column-checkbox, td.cdk-column-select'
        ));
        if (wrapCandidates.length) checkTarget = wrapCandidates[0];
      }

      // 3) fallback: click the entire row to toggle selection
      const clicker = checkTarget || row;
      options.push({ kind: 'table', row, el: clicker, txt: txt || '(unnamed)' });
    } catch {}
  }
  return options;
}

// still keep previous collectors in case UI changes later
async function gatherFromSelectPanel(driver, { filterRx = null } = {}) {
  const selectPanels = await driver.findElements(By.css('.mat-mdc-select-panel'));
  if (!selectPanels.length) return [];
  const optionEls = await driver.findElements(By.css(
    '.mat-mdc-option[role="option"]:not([aria-disabled="true"]) .mdc-list-item__primary-text,' +
    'mat-option[role="option"]:not([aria-disabled="true"]) .mdc-list-item__primary-text,' +
    '[role="option"]:not([aria-disabled="true"]) .mdc-list-item__primary-text'
  ));
  const options = [];
  for (const el of optionEls) {
    let txt = norm(await el.getText());
    if (!txt) try { txt = norm(await el.getAttribute('innerText')); } catch {}
    if (!txt) continue;
    if (!filterRx || filterRx.test(txt)) options.push({ kind: 'select', el, txt });
  }
  return options;
}


let _seed = Number(process.env.FIR_RANDOM_SEED || '') || null;
export function setSeed(n){ _seed = Number(n) || null; }
function rand(max){
  if (_seed == null) return Math.floor(Math.random()*max);
  // xorshift32
  let x = (_seed |= 0) || 1; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; _seed = x;
  return Math.abs(x) % max;
}

export async function pickPrimaryIncidentType(driver, nameOrRandom = 'RANDOM', labelText = 'Primary Incident Type') {
  const spec = String(nameOrRandom || '').trim();
  const wantRandom = !spec || spec.toUpperCase().startsWith('RANDOM');
  const filterExpr = (spec.split(':')[1] || '').trim();
  const filterRx = filterExpr ? new RegExp(filterExpr, 'i') : null;

  await leaveAllFrames(driver);
  await openIncidentTypeControl(driver, labelText);
  await driver.sleep(150); // allow table to hydrate
  
  await ensurePageSize500(driver);
  if (cfg.debugPickers) await logPaginatorState(driver)
  await driver.sleep(120);

  // Prefer the mat-table collector (matches your DOM), fallback to select panel
  let options = await gatherFromMatTable(driver, { filterRx });
  if (!options.length) options = await gatherFromSelectPanel(driver, { filterRx });
  console.log('[IncidentType] options found:', options.length);

  // Nudge virtual scroll if empty
  if (!options.length) {
    try {
      await driver.executeScript(`
        const pane = document.querySelector('.cdk-overlay-pane') || document;
        const scroller = pane.querySelector('.mat-mdc-dialog-content, .mdc-dialog__content, .mat-dialog-content, .cdk-virtual-scroll-viewport');
        if (scroller) scroller.scrollTop = 0;
      `);
      await driver.sleep(120);
      options = await gatherFromMatTable(driver, { filterRx });
      if (!options.length) options = await gatherFromSelectPanel(driver, { filterRx });
    } catch {}
  }

  // As a last resort: “poke” with keyboard to force render
  if (!options.length) {
    try { await driver.switchTo().activeElement().then(el => el.sendKeys(Key.ARROW_DOWN)); } catch {}
    await driver.sleep(100);
    options = await gatherFromMatTable(driver, { filterRx });
    if (!options.length) options = await gatherFromSelectPanel(driver, { filterRx });
  }

  if (!options.length) {
    const diag = await driver.executeScript(`
      const pane = document.querySelector('.cdk-overlay-pane');
      const html = pane ? pane.innerHTML.slice(0,1500) : '(no overlay pane)';
      return html;
    `);
    throw new Error(`No checkbox/select options found for ${labelText}. Overlay HTML: ${diag}`);
  }

  // Deterministic random choice
  const idx = await chooseIndex(options.length, driver);
  const choice = options[idx];

  // Click it (checkbox cell/wrapper or select option)
  try { await choice.el.click(); } catch { await driver.executeScript('arguments[0].click();', choice.el); }

  // Confirm if needed
  try { await clickByText(driver, 'Select'); } catch {}
  try { await clickByText(driver, 'Save'); } catch {}
  try { await clickByText(driver, 'OK'); } catch {}

  // Verify dialog closed (or at least that selection registered)
  await driver.sleep(120);
  return choice.txt;
}


// Find the topmost overlay pane (scopes all dialog queries)
async function getTopOverlayPane(driver) {
  const panes = await driver.findElements(By.css('.cdk-overlay-pane'));
  return panes.length ? panes[panes.length - 1] : null;
}

async function ensurePageSize500(driver, preferred = 500) {
  // 1) Scope to the topmost dialog/overlay
  const pane = await getTopOverlayPane(driver);
  if (!pane) return;

  // 2) Find a paginator inside the dialog (MDC + legacy)
  const paginatorCandidates = await pane.findElements(By.css('.mat-mdc-paginator, .mat-paginator'));
  if (!paginatorCandidates.length) return; // no paginator → nothing to do
  const paginator = paginatorCandidates[0];

  // 3) Find and click the page-size trigger reliably
  // Prefer the select "trigger" elements; fall back to the whole page-size container
  const trigger =
    (await paginator.findElements(By.css('.mat-mdc-paginator-page-size .mat-mdc-select-trigger, .mat-paginator-page-size .mat-select-trigger')))[0] ||
    (await paginator.findElements(By.css('.mat-mdc-paginator-page-size, .mat-paginator-page-size')))[0];
  if (!trigger) return;

  try { await clickEl(driver, trigger); } catch { /* handled in clickEl */ }

  // 4) Wait for the select panel (MDC or legacy), scoped globally but then operate within the found panel
  const panel = await driver.wait(
    until.elementLocated(By.css('.cdk-overlay-pane .mat-mdc-select-panel, .cdk-overlay-pane .mat-select-panel')),
    4000
  ).catch(() => null);
  if (!panel) return;

  // 5) Collect options in the open panel
  const optionEls = await panel.findElements(By.css('.mat-mdc-option, .mat-option'));
  if (!optionEls.length) return;

  // Map visible labels → numbers / "All"
  const opts = [];
  for (const el of optionEls) {
    let label = '';
    try { label = (await el.getText()).trim(); } catch {}
    const m = label.match(/\d+/);
    const num = m ? parseInt(m[0], 10) : null;
    const isAll = /all/i.test(label);
    opts.push({ el, label, num, isAll });
  }

  // 6) Choose best option: exact preferred (500) → "All" → largest numeric → last option
  let choice =
    opts.find(o => o.num === preferred) ||
    opts.find(o => o.isAll) ||
    opts.filter(o => Number.isFinite(o.num)).sort((a, b) => (b.num ?? 0) - (a.num ?? 0))[0] ||
    opts[opts.length - 1];

  // 7) Click the chosen option (with JS fallback) and verify it applied
  try { await clickEl(driver, choice.el); } catch { await driver.executeScript('arguments[0].click()', choice.el); }

  // 8) Wait for the value to reflect on the paginator
  // Prefer the dedicated value element; fall back to the range label
  const valueEl =
    (await paginator.findElements(By.css('.mat-mdc-paginator-page-size-value, .mat-paginator-page-size-value')))[0] ||
    (await paginator.findElements(By.css('.mat-mdc-paginator-range-label, .mat-paginator-range-label')))[0];

  if (valueEl) {
    const expected = choice.num ?? choice.label; // number (500) or "All"
    await driver.wait(async () => {
      const t = (await valueEl.getText()).trim();
      if (typeof expected === 'number') {
        const n = parseInt(t, 10);
        return Number.isFinite(n) ? n === expected : new RegExp(String(expected)).test(t);
      }
      return t.includes(String(expected));
    }, 4000).catch(() => {}); // don’t hard-fail the flow
  }

  if (cfg.debugPickers) {
    console.log(`[pickers] Paginator page size set to: ${choice.label || choice.num}`);
  }

  // Small settle to let the table render extra rows
  await driver.sleep(150);
}


export async function pickByText(driver, openLocator, listLocator, itemText = null) {
  
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const t0 = Date.now();
  const diagBase = `picker-${t0}`;
  let attempt = 0;

  for (; attempt <= (typeof cfg?.pickersRetry === 'number' ? cfg.pickersRetry : 2); attempt++) {
    try {
            const opener = await driver.wait(until.elementLocated(openLocator), cfg.pickersWaitMs);
      await driver.wait(until.elementIsVisible(opener), cfg.pickersWaitMs);
      await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', opener);
      try { await opener.click(); } catch { await driver.executeScript('arguments[0].click()', opener); }

      const pane = await driver.wait(async () => {
        const p = (await driver.findElements(listLocator));
        return p.length ? p[p.length - 1] : null;
      }, cfg.pickersWaitMs).catch(() => null);

      if (!pane) throw new Error('Overlay/list did not appear');

            const items = await pane.findElements(By.css('*'));
      const visible = [];
      for (const it of items) {
        try {
          if (!(await it.isDisplayed())) continue;
          let txt = (await it.getText()).trim().replace(/\s+/g,' ');
          if (!txt) continue;
          visible.push({ el: it, txt, n: norm(txt) });
        } catch {}
      }

      if (!visible.length) throw new Error('No visible items found in overlay');

            if (itemText) {
        const want = norm(String(itemText));
                let found = visible.find(v => v.n === want) || visible.find(v => v.n.includes(want)) || visible.find(v => want.includes(v.n));
        if (!found) {
          
          found = visible.find(v => v.txt.toLowerCase().includes(want));
        }
        if (!found) throw new Error(`Option not found in overlay: ${itemText}`);
        
        await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', found.el);
        try { await found.el.click(); } catch { await driver.executeScript('arguments[0].click()', found.el); }
        
        try { await clickByText(driver, 'Select'); } catch {}
        
        await driver.wait(async () => {
          const panes = await driver.findElements(By.css('.cdk-overlay-pane'));
          return panes.length === 0 || !(panes[panes.length - 1]);
        }, 5000).catch(()=>{});
        return found.txt;
      
      } else {
        
        const idx = Math.floor(visible.length / 2);
        const choice = visible[idx];
        await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', choice.el);
        try { await choice.el.click(); } catch { await driver.executeScript('arguments[0].click()', choice.el); }
        try { await clickByText(driver, 'Select'); } catch {}
        await driver.wait(async () => {
          const panes = await driver.findElements(listLocator);
          return panes.length === 0;
        }, 4000).catch(() => {});
        return choice.txt;
      }
    } catch (err) {
      console.warn(`[pickByText] attempt ${attempt} failed: ${err}`);
      if (attempt === (typeof cfg?.pickersRetry === 'number' ? cfg.pickersRetry : 2)) throw err;
      await driver.sleep(200);
    }
  }
}


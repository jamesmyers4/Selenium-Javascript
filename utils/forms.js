// utils/forms.js (ESM)
import { By, until, Key } from 'selenium-webdriver';
import path from 'node:path';
import { cfg } from './config.pwrtrx.js';
import { saveScreenshot, writeText } from './diagnostics.js';

/** small helper */
async function clickEl(driver, el) {
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
  try { await el.click(); }
  catch { await driver.executeScript("arguments[0].click();", el); }
}

/**
 * Find a form control by its visible label or ARIA hints.
 * - Works with <label for="id">..</label> + <input id="id">
 * - Works with Angular Material <mat-form-field> + <mat-label> + input/select
 * - Works with aria-label / placeholder / name
 */
export async function findField(driver, labelText, { timeoutMs = 8000 } = {}) {
  const T = (labelText || '').trim();

  // 1) Direct aria/placeholder/name
  const direct = [
    By.css(`*[aria-label="${T}"]`),
    By.css(`*[aria-label*="${T}" i]`),
    By.css(`*[placeholder="${T}"]`),
    By.css(`*[placeholder*="${T}" i]`),
    By.css(`*[name="${T}"]`),
    By.css(`*[name*="${T}" i]`)
  ];
  for (const by of direct) {
    const els = await driver.findElements(by);
    for (const el of els) { try { if (await el.isDisplayed()) return el; } catch {} }
  }

  // 2) <label for="..."> → element by id (case-insensitive label match)
  try {
    const U = T.toUpperCase();
    const labelEl = await driver.wait(until.elementLocated(By.xpath(
      `//label[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),"${U}")]`
    )), Math.floor(timeoutMs / 2));
    await driver.wait(until.elementIsVisible(labelEl), 3000);
    const forId = await labelEl.getAttribute('for');
    if (forId) {
      const byId = await driver.findElements(By.id(forId));
      if (byId.length) return byId[0];
    }
    // If no 'for' attr, try the next input/select after the label in DOM flow
    const next = await labelEl.findElements(By.xpath(
      `following::*[self::input or self::textarea or self::select or @role='combobox'][1]`
    ));
    if (next.length) return next[0];
  } catch { /* fallthrough */ }

  // 3) Angular Material: mat-form-field > mat-label text (case-insensitive)
  const mat = await driver.findElements(By.xpath(
    `//mat-form-field[.//mat-label[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),"${T.toUpperCase()}")]]` +
    `//*[self::input or self::textarea or self::select or @role='combobox'][1]`
  ));
  for (const el of mat) { try { if (await el.isDisplayed()) return el; } catch {} }

  // 4) Last resort: within a container that has a label text somewhere above (case-insensitive)
  const container = await driver.findElements(By.xpath(
    `//div[.//label[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),"${T.toUpperCase()}")]]//*[self::input or self::textarea or self::select or @role='combobox'][1]`
  ));
  for (const el of container) { try { if (await el.isDisplayed()) return el; } catch {} }

  throw new Error(`Field not found for label: "${labelText}"`);
}

/** Type into input/textarea (dispatches input/change/blur to satisfy reactive forms) */
export async function typeInto(driver, labelText, value, { clear = true } = {}) {
  const el = await findField(driver, labelText);
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
  const tag = (await el.getTagName()).toLowerCase();

  if (clear) { try { await el.clear(); } catch {} }
  try {
    await el.sendKeys(value);
  } catch {}

  // If value didn't stick (common with some date/time pickers), set via JS + events
  try {
    const current = (await el.getAttribute('value')) || '';
    if (!current || current.trim() === '') {
      await driver.executeScript(`
        const el = arguments[0], v = arguments[1];
        try { el.removeAttribute('readonly'); } catch {}
        el.value = v;
        ['input','change','blur','keyup'].forEach(t => el.dispatchEvent(new Event(t,{bubbles:true})));
      `, el, value);
    }
  } catch {}

  // fire events (Angular / React forms)
  if (tag === 'input' || tag === 'textarea') {
    await driver.executeScript(`
      const el = arguments[0];
      ['input','change','blur','keyup'].forEach(t => el.dispatchEvent(new Event(t,{bubbles:true})));
    `, el);
  }
  return el;
}


export async function selectOption(driver, labelText, value) {
  const el = await findField(driver, labelText);
  const tag = (await el.getTagName()).toLowerCase();
  const role = (await el.getAttribute('role')) || '';

  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  async function safeClick(target) {
    try { await clickEl(driver, target); return true; }
    catch (e1) { 
      try { await driver.executeScript('arguments[0].click()', target); return true; }
      catch (e2) { return false; }
    }
  }

  if (tag === 'select') {
    const opts = await el.findElements(By.xpath(`.//option[normalize-space(.)="${value}"]`));
    const pick = opts.length ? opts[0] :
      (await el.findElements(By.xpath(`.//option[contains(normalize-space(.),"${value}")]`)))[0];
    if (!pick) throw new Error(`Option not found: ${value}`);
    await safeClick(pick);
    await driver.executeScript("arguments[0].dispatchEvent(new Event('change',{bubbles:true}))", el);
    return;
  }

  let trigger = el;
  if (tag === 'input' && role !== 'combobox') {
    const localXpath = `//label[normalize-space(.)=normalize-space("${labelText}")]/following::*[self::mat-select or @role='combobox' or contains(@class,'mat-select') or self::button][1]`;
    const local = await driver.findElements(By.xpath(localXpath));
    if (local.length) trigger = local[0];
  }

  await safeClick(trigger);

  // --- wait for the correct overlay: Primary Cause modal ---
  const overlay = await driver.wait(async () => {
    const panes = await driver.findElements(By.css('.cdk-overlay-pane, .mat-dialog-container'));
    for (let o of panes) {
      const header = await o.findElements(By.xpath('.//h2[text()="Select a Primary Cause"]'));
      if (header.length) return o;
    }
    return null;
  }, 8000);

  if (!overlay) throw new Error('Primary Cause overlay did not appear');

  await driver.wait(until.elementIsVisible(overlay), 4000).catch(() => {});

  async function nodeMatches(n) {
    try {
      const txt = (await n.getText() || '').trim();
      if (txt && norm(txt) === norm(value)) return true;
      const span = await n.findElements(By.css('span'));
      for (const s of span) {
        if (norm(await s.getText()) === norm(value)) return true;
      }
    } catch {}
    return false;
  }

  async function findOptionsInOverlay(o) {
    const candidates = await o.findElements(By.xpath(
      `.//*[self::mat-option or self::li or self::button or @role='option' or contains(@class,'mat-list-item') or contains(@class,'mat-list-option')]`
    ));
    const filtered = [];
    for (const n of candidates) {
      try {
        if (!(await n.isDisplayed())) continue;
        filtered.push(n);
      } catch {}
    }
    return filtered;
  }

  const maxAttempts = 6;
  let attempts = 0;

  while (attempts++ < maxAttempts) {
    const optNodes = await findOptionsInOverlay(overlay);

    let target = null;
    for (const n of optNodes) {
      if (await nodeMatches(n)) { target = n; break; }
    }

    if (!target) {
      // fallback: partial match
      for (const n of optNodes) {
        const t = (await n.getText() || '').trim();
        if (t && norm(t).includes(norm(value))) { target = n; break; }
      }
    }

    if (!target) {
      // scroll overlay
      try {
        await driver.executeScript(`
          const sc = arguments[0].querySelector('.cdk-virtual-scroll-viewport, .mat-mdc-dialog-content, .mat-dialog-content, .mdc-dialog__content');
          if (sc) sc.scrollTop += 120;
        `, overlay);
      } catch {}
      await driver.sleep(200);
      continue;
    }

    // click checkbox if present
    let clicked = false;
    try {
      const innerCbs = await target.findElements(By.css('input[type="checkbox"], .mdc-checkbox__native-control, [role="checkbox"]'));
      if (innerCbs.length) clicked = await safeClick(innerCbs[0]);
    } catch {}

    if (!clicked) {
      // click inner clickable children
      try {
        const children = await target.findElements(By.css('button, a, .mat-option-text, .mat-mdc-option, .mdc-list-item, .mat-list-item, span'));
        for (const c of children) {
          if (await c.isDisplayed()) { clicked = await safeClick(c); if (clicked) break; }
        }
      } catch {}
    }

    if (!clicked) clicked = await safeClick(target);

    await driver.sleep(200);

    // check if overlay closed (success)
    const still = await driver.findElements(By.css('.cdk-overlay-pane, .mat-dialog-container'));
    let closed = true;
    for (let s of still) {
      const header = await s.findElements(By.xpath('.//h2[text()="Select a Primary Cause"]'));
      if (header.length) { closed = false; break; }
    }
    if (closed) return;

    // last resort wait
    await driver.sleep(150);
  }

  throw new Error(`Failed to select "${value}" in Primary Cause overlay after ${maxAttempts} attempts`);
}



export async function clickByText(driver, text) {
  const X = `//*[self::button or self::a or @role='button']` +
            `[normalize-space(.)="${text}" or .//span[normalize-space(.)="${text}"]]`;
  const el = await driver.wait(until.elementLocated(By.xpath(X)), 8000);
  await driver.wait(until.elementIsVisible(el), 6000);
  await clickEl(driver, el);
}


/** Check/uncheck by label (supports input[type=checkbox], role=checkbox, mat-checkbox) */
export async function setCheckboxSmart(driver, { labels = [], name, css }, value) {
  let el = null;

  // 1) CSS direct hook if provided
  if (!el && css) {
    try { el = await driver.findElement(By.css(css)); } catch {}
  }

  // 2) By name (best for your case)
  if (!el && name) {
    try { el = await driver.findElement(By.css(`input[type="checkbox"][name="${name}"]`)); } catch {}
  }

  // 3) By label text (fallback; works if the text is present in the DOM)
  if (!el && labels.length) {
    for (const L of labels) {
      try {
        el = await driver.findElement(By.xpath(
          `//mat-checkbox[.//*[normalize-space(text())='${L}'] or contains(., '${L}')]//input[@type='checkbox'] |
           //label[contains(normalize-space(.),'${L}')]/descendant::input[@type='checkbox'] |
           //*[contains(normalize-space(.),'${L}')]/ancestor::*[self::mat-checkbox or self::div][1]//input[@type='checkbox']`
        ));
        break;
      } catch {}
    }
  }

  if (!el) throw new Error(`Checkbox not found (smart): ${[name, css, ...labels].filter(Boolean).join(' | ')}`);

  // Toggle only if needed
  const isChecked = await el.isSelected().catch(async () => {
    const c = await el.getAttribute('checked');
    return c === 'true' || c === 'checked';
  });
  if (!!isChecked !== !!value) {
    try { await el.click(); } catch { await driver.executeScript('arguments[0].click()', el); }
  }
}


//Update - New specific 

export async function setCheckbox(driver, locator, shouldBeChecked) {
  const start = Date.now();
  const diagBase = path.join(cfg.pickersDiagDir, `checkbox-${start}`);
  let attempt = 0;

  for (; attempt <= cfg.pickersRetry; attempt++) {
    try {
      const el = await driver.wait(until.elementLocated(locator), cfg.pickersWaitMs);
      await driver.wait(until.elementIsVisible(el), cfg.pickersWaitMs);
      await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', el);

      const id = await el.getAttribute('id');
      const isChecked = (await el.getAttribute('checked')) !== null;

      if (cfg.debugPickers) {
        console.log(`[pickers] setCheckbox attempt=${attempt} id=${id} current=${isChecked} target=${shouldBeChecked}`);
      }

      if (isChecked === shouldBeChecked) return;

      try {
        await el.click();
      } catch {
        if (id) {
          const label = await driver.findElements(By.css(`label[for="${id}"]`));
          if (label.length) await label[0].click();
        }
      }

      // Verify; if not, force via JS + events
      const afterClick = (await el.getAttribute('checked')) !== null;
      if (afterClick !== shouldBeChecked) {
        await driver.executeScript(
          `
          const input = arguments[0], desired = arguments[1];
          input.checked = desired;
          input.dispatchEvent(new Event('input', {bubbles:true}));
          input.dispatchEvent(new Event('change', {bubbles:true}));
          `,
          el, shouldBeChecked
        );
      }

      await driver.wait(async () => {
        const v = (await el.getAttribute('checked')) !== null;
        return v === shouldBeChecked;
      }, cfg.pickersWaitMs);

      if (cfg.debugPickers) {
        console.log(`[pickers] setCheckbox OK in ${Date.now() - start}ms`);
      }
      return;
    } catch (err) {
      if (cfg.debugPickers) {
        const ss = `${diagBase}-attempt${attempt}.png`;
        const html = `${diagBase}-attempt${attempt}.txt`;
        await saveScreenshot(driver, ss);
        const rootHtml = await driver.executeScript('return document.body.outerHTML.slice(0, 100000)');
        await writeText(html, String(rootHtml));
        console.warn(`[pickers] setCheckbox failed attempt ${attempt}: ${err}`);
      }
      if (attempt === cfg.pickersRetry) throw err;
      await driver.sleep(250);
    }
  }
}

//Officer In Charge Checkbox ASAP
export async function waitForFieldEnabled(driver, labels, timeout = 8000) {
  const list = Array.isArray(labels) ? labels : [labels];
  const start = Date.now();
  let el = null;

  while (Date.now() - start < timeout) {
    for (const L of list) {
      el = await findField(driver, L).catch(() => null);
      if (!el) continue;
      const dis = await el.getAttribute('disabled');
      const aria = await el.getAttribute('aria-disabled');
      if (!dis && aria !== 'true') return el;
    }
    await driver.sleep(100);
  }
  throw new Error(`Field not enabled: ${list.join(' | ')}`);
}
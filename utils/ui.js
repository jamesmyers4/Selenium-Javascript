// utils/ui.js
import { By, until, Key } from 'selenium-webdriver';
import { safeScreenshot } from './waits.js';

async function clickEl(driver, el) {
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el);
  try { await el.click(); }
  catch { await driver.executeScript("arguments[0].click();", el); }
}

export async function clickCreateIncident(driver) {
  // optional override from env
  const explicitAria = process.env.FIR_CREATE_ARIA; // e.g. "Create an Incident"

  const locators = [
    // Most precise (your outerHTML)
    explicitAria ? By.css(`button[aria-label="${explicitAria}"]`)
                 : By.css('button[aria-label="Create an Incident"]'),

    // Variants / contains
    By.css('button[aria-label="Create Incident"]'),
    By.xpath("//*[self::button or self::a][contains(@aria-label,'Create') or contains(@title,'Create')]"),

    // Icon-only: “plus” svg ancestor button
    By.xpath("//*[name()='svg' and (contains(@class,'fa-plus') or @data-icon='plus')]/ancestor::*[self::button or self::a][1]"),

    // As a last resort, a visible “Create” button (e.g., bottom action)
    By.xpath("//*[self::button or self::a][.//span[normalize-space()='Create'] or normalize-space()='Create']"),
  ];

  // Give the page a beat and scroll to top (in case we landed mid-scroll)
  await driver.sleep(300);
  try { await driver.executeScript('window.scrollTo(0,0);'); } catch {}

  for (const by of locators) {
    try {
      const el = await driver.wait(until.elementLocated(by), 1000);
      await driver.wait(until.elementIsVisible(el), 6000);
      await clickEl(driver, el);
      return true;
    } catch {
      // try next locator
    }
  }

  // Nothing found: take a screenshot to help debug
  await safeScreenshot(driver, `neris_create_not_found_${Date.now()}.png`);
  return false;
}

/** Optional search helpers kept for later */
export async function findSearchInput(driver) {
  const custom = process.env.FIR_SEARCH_SELECTOR;
  if (custom) {
    const els = await driver.findElements(By.css(custom));
    if (els.length) return els[0];
  }

  // Toggle a search UI if needed (magnifier)
  try {
    const toggle = await driver.findElement(By.xpath(
      "//*[self::button or self::a or @role='button']" +
      "[contains(@aria-label,'Search') or contains(@title,'Search') or " +
      " contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'search')]"
    ));
    if (toggle) { try { await toggle.click(); } catch {} }
  } catch {}

  const candidates = [
    By.css("input[type='search']"),
    By.css("input[aria-label*='Search' i]"),
    By.css("input[placeholder*='search' i]"),
    By.css("input[name*='search' i]"),
    By.css("[data-test='search'], [data-testid='search'], [data-test='search-input'], [data-testid='search-input']"),
  ];
  for (const loc of candidates) {
    const els = await driver.findElements(loc);
    for (const el of els) {
      try { if (await el.isDisplayed()) return el; } catch {}
    }
  }
  return null;
}

export async function submitSearch(driver, inputEl) {
  try {
    const btn = await driver.findElement(By.xpath(
      "//*[self::button or self::a or @role='button']" +
      "[normalize-space()='Search' or contains(@aria-label,'Search') or contains(@title,'Search')]"
    ));
    await clickEl(driver, btn);
  } catch {
    await inputEl.sendKeys(Key.ENTER);
  }
}


//Overlay Guards
export async function waitForNoOverlays(driver, timeout = 2000) {
  // Only treat overlays as "blocking" if they are *visible*
  const sel = [
    '.cdk-overlay-backdrop.cdk-overlay-backdrop-showing',
    '.cdk-overlay-pane .mat-mdc-select-panel',
    '.cdk-overlay-pane .mat-select-panel',
    '.cdk-overlay-pane [role="dialog"]',
  ].join(', ');

  await driver
    .wait(async () => {
      const els = await driver.findElements(By.css(sel));
      for (const el of els) {
        try {
          if (await el.isDisplayed()) return false; // still a *visible* overlay
        } catch {}
      }
      return true; // no visible overlays
    }, timeout)
    .catch(() => {});
}

export async function closeOverlays(driver) {
  for (let i = 0; i < 2; i++) {                        // 2 passes is usually enough
    const backs = await driver.findElements(By.css('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing'));
    const panels = await driver.findElements(By.css('.mat-mdc-select-panel'));
    if (!backs.length && !panels.length) break;

    try { await driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform(); } catch {}
    await driver.sleep(100);

    const b = await driver.findElements(By.css('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing'));
    if (b.length) {
      try { await b[0].click(); } catch { await driver.executeScript('arguments[0].click()', b[0]); }
    }
    await driver.sleep(120);
  }
  await waitForNoOverlays(driver, 1500);               // shorter, visibility-aware
}


export async function isFieldPopulated(driver, openerEl) {
  try {
    const tag = (await openerEl.getTagName()).toLowerCase().catch(()=>null);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const v = (await openerEl.getAttribute('value')) || (await openerEl.getText()) || '';
      if (String(v).trim()) return true;
    }
    const childText = (await openerEl.getText()).trim();

    if (childText && !/select|choose|—|none|choose an option/i.test(childText)) return true;
    const ariaVal = (await openerEl.getAttribute('aria-label') || await openerEl.getAttribute('aria-valuetext') || '').trim();
    
    if (ariaVal) return true;
    const active = await openerEl.findElements(By.css('[aria-selected="true"], [aria-checked="true"]'));
    
    if (active.length) return true;
  } catch {}
  return false;
}
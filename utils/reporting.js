import { By, until } from 'selenium-webdriver';
import { openApp } from './nav.js';

// NOTE: Adjust selectors to your real Reports/Dashboard UI.
// Add data-test attributes in the app if possible.

export async function openReport(driver, name) {
  // Navigate to Reports hub first (if separate), otherwise open via menu/page.
  // Example: open "Reports" app, then click a report by name.
  const ok = await openApp(driver, 'REPORTS');
  if (!ok) throw new Error('Could not open Reports');
  const link = await driver.wait(until.elementLocated(By.xpath(
    `//a[normalize-space()="${name}"] | //button[normalize-space()="${name}"]`
  )), 8000);
  await link.click();
}

export async function applyFilters(driver, filters = {}) {
  // Example only—replace with your actual controls.
  for (const [key, val] of Object.entries(filters)) {
    // Try select then input
    const sel = await driver.findElements(By.css(`[data-test="filter-${key}"] select`));
    if (sel.length) { await sel[0].sendKeys(String(val)); continue; }
    const inp = await driver.findElements(By.css(`[data-test="filter-${key}"] input`));
    if (inp.length) { await inp[0].clear(); await inp[0].sendKeys(String(val)); continue; }
  }
  const apply = await driver.findElements(By.css('[data-test="apply-filters"]'));
  if (apply.length) await apply[0].click();
  await driver.sleep(600);
}

export async function readCount(driver) {
  const kpi = await driver.wait(until.elementLocated(By.css('[data-test="kpi-count"]')), 8000);
  return parseInt((await kpi.getText()).replace(/[^\d]/g, ''), 10);
}

export async function assertReportCount(driver, { report, filters, expected }) {
  await openReport(driver, report);
  await applyFilters(driver, filters);
  const count = await readCount(driver);

  if (typeof expected === 'function') {
    if (!expected(count)) throw new Error(`Report "${report}" count ${count} did not satisfy predicate.`);
  } else if (count !== expected) {
    throw new Error(`Report "${report}" expected ${expected} but got ${count}.`);
  }
}


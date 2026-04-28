// utils/waits.js (ESM)
import { By, until } from 'selenium-webdriver';
import fs from 'fs';

export function normalize(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

export async function findByAny(driver, locators, timeoutEach = 4000) {
  for (const loc of locators) {
    try {
      const el = await driver.wait(until.elementLocated(loc), timeoutEach);
      await driver.wait(until.elementIsVisible(el), 3000);
      return el;
    } catch {
      // try next locator
    }
  }
  throw new Error('None of the locators matched: ' + locators.map(String).join(' | '));
}

export async function safeScreenshot(driver, name) {
  try {
    const png = await driver.takeScreenshot();
    fs.writeFileSync(name, png, 'base64');
    console.warn('🖼 Saved screenshot:', name);
  } catch {
    // best effort
  }
}

export async function waitForLoaded(driver, beforeSnapshot) {
  const contentLocator = By.xpath(
    "//h1 | //h2 | //main | //section | " +
    "//div[contains(@class,'content') or contains(@class,'container') or contains(@class,'panel') or contains(@class,'card')]"
  );
  try {
    const el = await driver.wait(until.elementLocated(contentLocator), 7000);
    await driver.wait(until.elementIsVisible(el), 3000);
    if (beforeSnapshot) {
      const now = normalize(await el.getText()).slice(0, 160);
      if (now && now !== beforeSnapshot) return true;
    }
    return true;
  } catch {
    return false;
  }
}

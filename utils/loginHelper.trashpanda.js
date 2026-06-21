// utils/loginHelper.trashpanda.js
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { By, until, Key } from 'selenium-webdriver';

// ── Env & URLs ────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ENV_FILE = process.env.ENV_FILE || '.env.trashpanda';
dotenv.config({ path: path.resolve(process.cwd(), ENV_FILE) });

// Make env-derived URLs available here (and export if needed)
export const BASE_URL = process.env.BASE_URL || '';
export const SAFETYOPS_MAIN_URL =
  process.env.SAFETYOPS_MAIN_URL ||
  (BASE_URL ? BASE_URL.replace(/\/(auth\/account\/login|login)(\/.*)?$/i, '') + '/n/safetyops/main' : '');

// ── Small utilities ──────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fresh(driver, locator, visTimeout = 10000) {
  const el = await driver.wait(until.elementLocated(locator), visTimeout);
  await driver.wait(until.elementIsVisible(el), 5000);
  return el;
}

async function withStaleRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if ((e.name || '').includes('StaleElementReference')) {
      await sleep(300);
      return await fn();
    }
    throw e;
  }
}

async function safeShot(driver, name) {
  try {
    const png = await driver.takeScreenshot();
    fs.writeFileSync(name, png, 'base64');
    console.warn('🖼 Saved screenshot:', name);
  } catch { /* noop */ }
}

// ── Core: fill + submit login form (supports UserID/Username variants) ───────
export async function fillAndSubmitUserIdForm(driver, username, password) {
  const userLocators = [
    By.id('Username'), By.id('UserName'), By.name('Username'), By.name('UserName'),
    By.css('input#Input_Username'),
    By.id('UserID'), By.name('UserID'), // legacy
    By.css('input[placeholder="Username"]'),
    By.css('input[placeholder*="user" i]'),
    By.css('input[type="text"]')
  ];
  const passLocators = [
    By.id('Password'), By.name('Password'),
    By.css('input#Input_Password'),
    By.css('input[placeholder="Password"]'),
    By.css('input[placeholder*="password" i]'),
    By.css('input[type="password"]')
  ];
  const submitLocators = [
    By.id('btnPDC'), // legacy
    By.xpath("//button[@type='submit' and (normalize-space()='Login' or normalize-space()='Log in')]"),
    By.css('button[type="submit"]'),
    By.xpath("//input[@type='submit' and (contains(@value,'Login') or contains(@value,'Log in'))]")
  ];

  await withStaleRetry(async () => {
    const userInput = await (async () => {
      for (const l of userLocators) {
        const els = await driver.findElements(l);
        if (els.length) { await driver.wait(until.elementIsVisible(els[0]), 5000); return els[0]; }
      }
      throw new Error('Username/UserID field not found');
    })();

    const passInput = await (async () => {
      for (const l of passLocators) {
        const els = await driver.findElements(l);
        if (els.length) { await driver.wait(until.elementIsVisible(els[0]), 5000); return els[0]; }
      }
      throw new Error('Password field not found');
    })();

    await userInput.clear(); await userInput.sendKeys(username);
    await passInput.clear();  await passInput.sendKeys(password);

    // fire input/blur to satisfy reactive forms
    await driver.executeScript(`
      const [u,p] = arguments;
      ['input','keyup','change','blur'].forEach(t => {
        u.dispatchEvent(new Event(t, { bubbles: true }));
        p.dispatchEvent(new Event(t, { bubbles: true }));
      });
    `, userInput, passInput);

    // prefer explicit submit button, fallback to ENTER
    let loginBtn = null;
    for (const l of submitLocators) {
      const els = await driver.findElements(l);
      if (els.length) { loginBtn = els[0]; break; }
    }

    const before = await driver.getCurrentUrl();

    if (loginBtn) {
      // ensure clickable (some UIs keep disabled class)
      await driver.wait(async () => {
        const disabled = await loginBtn.getAttribute('disabled');
        const aria = (await loginBtn.getAttribute('aria-disabled')) || 'false';
        const cls = (await loginBtn.getAttribute('class')) || '';
        return (!disabled || disabled === 'false') && aria !== 'true' && !/inert/i.test(cls);
      }, 8000).catch(async () => {
        await driver.executeScript(`const b=arguments[0]; b.removeAttribute('disabled');`, loginBtn);
      });

      try { await loginBtn.click(); }
      catch { await driver.executeScript("arguments[0].click();", loginBtn); }
    } else {
      await passInput.sendKeys(Key.ENTER);
    }

    // small confirmation that something happened
    await driver.wait(async () => (await driver.getCurrentUrl()) !== before, 2000).catch(() => {});
  });
}

// ── Full login (splash, terms, OIDC, profile) with env-aware URLs ───────────
export async function loginAndSelectProfile(
  driver,
  {
    username = process.env.LOGIN_USERNAME,
    password = process.env.LOGIN_PASSWORD,
    baseUrl  = BASE_URL,
    safetyopsMainUrl = SAFETYOPS_MAIN_URL
  } = {}
) {
  if (!baseUrl) throw new Error('BASE_URL missing (.env.trashpanda)');
  if (!username || !password) throw new Error('LOGIN_USERNAME / LOGIN_PASSWORD missing (.env.trashpanda)');

  // Start clean
  await driver.manage().deleteAllCookies();
  await driver.get(baseUrl);

  // Splash “Login to SafetyOps” (optional)
  try {
    const splash = await driver.wait(until.elementLocated(By.xpath(
      “//*[self::button or self::a or self::input[@type='submit']]” +
      “[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login to safetyops')]”
    )), 6000);
    await driver.wait(until.elementIsVisible(splash), 3000);
    await splash.click();
    console.log(“✅ Clicked 'Login to SafetyOps'”);
    await sleep(300);
  } catch { /* no splash */ }

  // Terms modal (optional)
  try {
    await sleep(600);
    const agreeBtn = await driver.wait(
      until.elementLocated(By.xpath("//button[contains(., 'Agree') or contains(., 'Accept')]")),
      3000
    );
    await driver.wait(until.elementIsVisible(agreeBtn), 3000);
    await agreeBtn.click();
    console.log("✅ Accepted terms modal");
  } catch { /* no terms */ }

  // First submit (handles both legacy and OIDC login pages)
  await fillAndSubmitUserIdForm(driver, username, password);

  // Secondary “/Login/UserIDLogin” step (legacy): submit again if it shows up
  await sleep(400);
  let url = await driver.getCurrentUrl();
  if (/\/Login\/UserIDLogin/i.test(url)) {
    console.log("ℹ️ Secondary UserIDLogin step detected — submitting again");
    await fresh(driver, By.id('UserID'), 8000); // ensure inputs present
    await fillAndSubmitUserIdForm(driver, username, password);
  }

  // If we bounced to a generic error, try once more from base
  url = await driver.getCurrentUrl();
  if (/\/Error\b/i.test(url)) {
    console.warn("❌ Hit /Error after login — retrying once");
    await safeShot(driver, 'error_after_login.png');
    await driver.manage().deleteAllCookies();
    await driver.get(baseUrl);
    try {
      const agree2 = await driver.wait(
        until.elementLocated(By.xpath("//button[contains(., 'Agree') or contains(., 'Accept')]")),
        2500
      );
      await agree2.click();
    } catch { /* ignore */ }
    await fillAndSubmitUserIdForm(driver, username, password);
  }

  // OIDC round-trip or direct land on main
  await driver.wait(async () => {
    const u = (await driver.getCurrentUrl()) || '';
    return /\/signin-oidc/i.test(u) || /\/n\/safetyops\/main/i.test(u);
  }, 20000).catch(() => {});

  // Nudge to main if we stalled mid-auth
  try {
    await driver.wait(until.urlMatches(/\/n\/safetyops\/main/i), 20000);
  } catch {
    if (safetyopsMainUrl) {
      try {
        await driver.get(safetyopsMainUrl);
        await driver.wait(until.urlMatches(/\/n\/safetyops\/main/i), 10000);
      } catch {
        const title = await driver.getTitle().catch(() => '');
        console.warn('❗ Could not confirm main after login. URL:', await driver.getCurrentUrl(), 'Title:', title);
        await safeShot(driver, 'stuck_on_auth.png');
      }
    }
  }

  // If clearly on main already, stop here
  const onMain = await (async () => {
    const hits = await driver.findElements(By.xpath(
      "//h1[contains(.,'SafetyOps Main')] | //h2[contains(.,'SafetyOps Main')] | " +
      "//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or " +
      "    normalize-space()='MODULES'      or normalize-space()='Modules']"
    ));
    return hits.length > 0;
  })();
  if (onMain) {
    console.log("ℹ️ Main page detected; skipping profile selection.");
    return;
  }

  // Profile selection if presented
  const selectLocator = By.xpath(
    "//*[self::button or self::a or self::input[@type='button' or @type='submit']]" +
    "[normalize-space()='Select' or @value='Select' or contains(.,'Select')]"
  );

  try {
    const selectBtn = await driver.wait(until.elementLocated(selectLocator), 6000);
    await driver.wait(until.elementIsVisible(selectBtn), 4000);
    await driver.wait(until.elementIsEnabled(selectBtn), 4000);
    await selectBtn.click();
    console.log("✅ Clicked profile Select");
  } catch (e) {
    // Maybe we landed on main without a profile card
    const mainNow = await driver.findElements(By.xpath(
      "//h1[contains(.,'SafetyOps Main')] | //h2[contains(.,'SafetyOps Main')] | " +
      "//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or contains(.,'Application')]"
    ));
    if (!mainNow.length) {
      const cur = await driver.getCurrentUrl();
      const title = await driver.getTitle().catch(() => '');
      console.warn("❌ Neither Select nor main detected. URL:", cur, "Title:", title);
      await safeShot(driver, 'profile_select_fail.png');
      throw e;
    } else {
      console.log("ℹ️ No Select found, but main detected — continuing.");
    }
  }

  // Final confirmation (non-blocking if already visible)
  await driver.wait(until.elementLocated(By.xpath(
    "//h1[contains(.,'SafetyOps Main')] | //h2[contains(.,'SafetyOps Main')] | " +
    "//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or contains(.,'Application')]"
  )), 10000);
  console.log("✅ Logged in and profile selected (or already on main).");
}

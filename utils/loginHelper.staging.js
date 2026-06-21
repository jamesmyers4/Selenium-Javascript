// utils/loginHelper.staging.js
const { By, until, Key } = require('selenium-webdriver');
const path = require('path');

// Load the staging env file (or remove this if you already load it in the test)
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.staging') });

// Grab BASE_URL once and guard it
const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  throw new Error('BASE_URL is missing. Put it in .env.staging and ensure dotenv loads it.');
}

async function fillAndSubmitUserIdForm(driver, username, password) {
  const fresh = async (locator, visTimeout = 10000) => {
    const el = await driver.wait(until.elementLocated(locator), visTimeout);
    await driver.wait(until.elementIsVisible(el), 5000);
    return el;
  };

  const withStaleRetry = async (fn) => {
    try { return await fn(); }
    catch (e) {
      if ((e.name || '').includes('StaleElementReference')) {
        await driver.sleep(300);
        return await fn();
      }
      throw e;
    }
  };

  await withStaleRetry(async () => {
    const userInput = await fresh(By.id('UserID'));
    const passInput = await fresh(By.id('Password'));

    await userInput.clear();
    await userInput.sendKeys(username);
    await passInput.clear();
    await passInput.sendKeys(password);

    // Fire common events & blur
    await driver.executeScript(`
      const [u,p] = arguments;
      const fire = el => ['input','keyup','change','blur']
        .forEach(t => el.dispatchEvent(new Event(t,{bubbles:true})));
      fire(u); fire(p);
    `, userInput, passInput);
    await passInput.sendKeys(Key.TAB);
    await driver.sleep(150);

    const loginBtn = await fresh(By.id('btnPDC'), 15000);

    // Wait until truly clickable
    await driver.wait(async () => {
      const disabled = await loginBtn.getAttribute('disabled');
      const cls = (await loginBtn.getAttribute('class')) || '';
      const aria = (await loginBtn.getAttribute('aria-disabled')) || 'false';
      return (!disabled || disabled === 'false') && aria !== 'true' && !cls.toLowerCase().includes('inert');
    }, 8000).catch(async () => {
      // Last resort: force-enable if class sticks
      await driver.executeScript(`
        const btn = arguments[0];
        btn.removeAttribute('disabled');
        btn.className = (btn.className || '').replace(/\\binert\\b/gi,'').trim();
      `, loginBtn);
    });

    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", loginBtn);
    await driver.sleep(100);

    const before = await driver.getCurrentUrl();

    // Try normal click, then JS click fallback
    try { await loginBtn.click(); }
    catch { await driver.executeScript("arguments[0].click();", loginBtn); }

    // Wait for either URL change or staleness
    const urlChanged = await driver.wait(async () => {
      return (await driver.getCurrentUrl()) !== before;
    }, 1500).catch(() => false);

    if (!urlChanged) {
      try {
        await passInput.sendKeys(Key.ENTER);
        await driver.wait(until.stalenessOf(loginBtn), 5000);
      } catch { /* best effort */ }
    }
  });
}

async function loginAndSelectProfile(driver, username, password) {
  // Start clean
  await driver.manage().deleteAllCookies();
  await driver.get(BASE_URL);  // <<— use flat env var

  // Terms modal (optional)
  try {
    await driver.sleep(1200);
    const agreeBtn = await driver.wait(
      until.elementLocated(By.xpath("//button[contains(., 'Agree') or contains(., 'Accept')]")), 5000
    );
    await driver.wait(until.elementIsVisible(agreeBtn), 5000);
    await driver.wait(until.elementIsEnabled(agreeBtn), 5000);
    await agreeBtn.click();
    console.log("✅ Accepted terms modal");
  } catch {
    console.warn("⚠️ Agree/Accept modal not found — continuing");
  }

  // First submit
  await fillAndSubmitUserIdForm(driver, username, password);

  // Secondary login page (if shown)
  await driver.sleep(500);
  let url = await driver.getCurrentUrl();
  if (/\/Login\/UserIDLogin/i.test(url)) {
    console.log("ℹ️ Secondary UserIDLogin step detected — submitting again");
    await driver.wait(until.elementLocated(By.id('UserID')), 8000);
    await fillAndSubmitUserIdForm(driver, username, password);
  }

  // Error page once (retry)
  url = await driver.getCurrentUrl();
  if (/\/Error/i.test(url)) {
    console.warn("❌ Hit /Error after login — retrying once");
    try {
      const png = await driver.takeScreenshot();
      require('fs').writeFileSync('error_after_login.png', png, 'base64');
    } catch {}
    await driver.manage().deleteAllCookies();
    await driver.get(BASE_URL);  // <<— use flat env var
    try {
      const agree2 = await driver.wait(
        until.elementLocated(By.xpath("//button[contains(., 'Agree') or contains(., 'Accept')]")), 3000
      );
      await agree2.click();
    } catch {}
    await fillAndSubmitUserIdForm(driver, username, password);
  }

  // Already on main? (skip profile)
  try {
    await driver.wait(
      until.elementLocated(By.xpath(
        "//h1[contains(.,'SafetyOps Main')] | //h2[contains(.,'SafetyOps Main')] | " +
        "//nav//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or contains(.,'Application')]"
      )),
      4000
    );
    console.log("ℹ️ Main page detected; skipping profile selection.");
    return;
  } catch { /* continue */ }

  // Profile selection
  const selectLocator = By.xpath(
    "//*[self::button or self::a or self::input[@type='button' or @type='submit']]" +
    "[normalize-space()='Select' or @value='Select' or contains(.,'Select')]"
  );

  try {
    const selectBtn = await driver.wait(until.elementLocated(selectLocator), 6000);
    await driver.wait(until.elementIsVisible(selectBtn), 5000);
    await driver.wait(until.elementIsEnabled(selectBtn), 5000);
    await selectBtn.click();
    console.log("✅ Clicked profile Select");
  } catch (e) {
    // If we can't find Select, check again if we're actually on main now
    try {
      await driver.wait(
        until.elementLocated(By.xpath(
          "//h1[contains(.,'SafetyOps Main')] | //h2[contains(.,'SafetyOps Main')] | " +
          "//nav//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or contains(.,'Application')]"
        )),
        4000
      );
      console.log("ℹ️ No Select found, but main detected — continuing.");
    } catch {
      const urlNow = await driver.getCurrentUrl();
      const title = await driver.getTitle().catch(() => '');
      console.warn("❌ Neither Select nor main detected. URL:", urlNow, "Title:", title);
      try {
        const png = await driver.takeScreenshot();
        require('fs').writeFileSync('profile_select_fail.png', png, 'base64');
        console.warn("🖼 Saved: profile_select_fail.png");
      } catch {}
      throw e;
    }
  }

  await driver.wait(
    until.elementLocated(By.xpath(
      "//h1[contains(.,'SafetyOps Main')] | //h2[contains(.,'SafetyOps Main')] | " +
      "//nav//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or contains(.,'Application')]"
    )),
    10000
  );
  console.log("✅ Logged in and profile selected (or already on main).");
}

module.exports = loginAndSelectProfile;

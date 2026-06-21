// tests/applications.test.js
//WORKING!!!
const path = require('path');
require('dotenv').config({ path: '.env.staging' });


// (optional sanity check)
console.log('[DEBUG BASE_URL]', process.env.BASE_URL);

const createDriver = require('../utils/driver');
const loginAndSelectProfile = require('../utils/loginHelper.staging');
const { By, until } = require('selenium-webdriver');

const USERNAME = process.env.LOGIN_USERNAME || '555544';
const PASSWORD = process.env.LOGIN_PASSWORD || 'f';
if (!USERNAME || !PASSWORD) throw new Error('Set LOGIN_USERNAME / LOGIN_PASSWORD in .env or hardcode.');

const WAIT_AFTER_CLICK_MS      = 2200;
const WAIT_AFTER_HOME_MS       = 900;
const WAIT_AFTER_OPEN_MENU_MS  = 600;   // <— small pause after opening Applications
const MAX_OPEN_MENU_RETRIES    = 3;     // <— try a few times to surface the menu

// 1) Top-Level apps to test (menu item text)
const APP_WHITELIST = [
  'AOE',
  'AUL',
  'BUILDING EVACUATION DRILL',
  'CMD/ORG MANAGEMENT',
  'COMPLIANCE ASSESSMENT',
  'CONTRACTOR INCIDENT REPORTING (CIRS)',
  'MISHAP REPORTING',
  'NFIRS',
  'NFPA 1500 CHECKLIST',
  'PERMITS',
  // 'PERSONNEL ADMIN',
  'PLAN REVIEW',
  'REQUEST AND ASSIGNMENT SYSTEM',
  'RESPIRATOR PROGRAM',
  'SELF-ASSESSMENT',
  'SF91 MV ACCIDENT REPORT',
  'TRAINING ADMINISTRATION (TA)',
];


// 2) Submenu options for apps that open a select window (modal/dropdown)
const APP_SUBITEMS = {
  'MISHAP REPORTING': [
   // 'Corrective Action',
   // 'Man Power Adjustment',
    'Mishap Main',
  // 'OSHA 300 log',
  //  'Submit Report'
  ],
};
function normalize(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

async function goHome(driver) {
  const mainLink = await driver.findElements(By.xpath(
    "//*[self::a or self::button][contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'SAFETYOPS MAIN PAGE')]"
  ));
  if (mainLink.length) {
    await mainLink[0].click();
    await driver.sleep(WAIT_AFTER_HOME_MS);
    return;
  }
  const logos = await driver.findElements(By.xpath("//img[contains(@alt,'SafetyOps Logo')]/ancestor::a[1]"));
  if (logos.length) {
    await logos[0].click();
    await driver.sleep(WAIT_AFTER_HOME_MS);
    return;
  }
  try { await driver.navigate().back(); } catch {}
  await driver.sleep(WAIT_AFTER_HOME_MS);
}

async function findApplicationsTrigger(driver) {
  const trigger = await driver.wait(
    until.elementLocated(By.xpath(
      "//*[self::a or self::button]" +
      "[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'APPLICATIONS')]"
    )),
    10000
  );
  await driver.wait(until.elementIsVisible(trigger), 5000);
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", trigger);
  return trigger;
}

// Open Applications menu (or page) with retries + pauses
async function openApplications(driver) {
  const trigger = await findApplicationsTrigger(driver);

  for (let attempt = 0; attempt < MAX_OPEN_MENU_RETRIES; attempt++) {
    // Click (some UIs need two clicks to toggle open)
    try { await trigger.click(); } catch {}
    await driver.sleep(WAIT_AFTER_OPEN_MENU_MS);

    // If no visible menu yet, try hover and click again
    const menus = await getVisibleMenuContainers(driver);
    if (menus.length) return { type: 'menu', menus };

    try { await driver.actions().move({ origin: trigger }).perform(); } catch {}
    await driver.sleep(WAIT_AFTER_OPEN_MENU_MS);

    const menus2 = await getVisibleMenuContainers(driver);
    if (menus2.length) return { type: 'menu', menus: menus2 };
  }

  // If we still don't see a dropdown, assume it's a page navigation
  // After the trigger click, check for an Applications page heading/section.
  try {
    await driver.wait(until.elementLocated(By.xpath(
      "//*[self::h1 or self::h2 or self::div][contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'APPLICATIONS')]"
    )), 4000);
    return { type: 'page' };
  } catch {
    // As a fallback, return no menu/page; caller will handle failure.
    return { type: 'none' };
  }
}

async function getVisibleMenuContainers(driver) {
  const candidates = await driver.findElements(By.xpath(
    "//*[self::ul or self::div]" +
    "[contains(@class,'dropdown') or contains(@class,'menu') or contains(@class,'list') or @role='menu' or contains(@class,'panel')]" +
    "[.//a]"
  ));
  const visible = [];
  for (const c of candidates) {
    try { if (await c.isDisplayed()) visible.push(c); } catch {}
  }
  return visible;
}

// Click an app inside any visible Applications dropdown/panel
async function clickFromVisibleMenus(driver, appText) {
  const t = normalize(appText).toLowerCase().replace(/'/g, "\\'");
  const menus = await getVisibleMenuContainers(driver);
  if (!menus.length) return false;

  const exactXpath =
    `.//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='${t}'] | ` +
    `.//a[*[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='${t}']]`;
  const containsXpath =
    `.//a[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${t}')]`;

  for (const menu of menus) {
    // scroll to top then search
    try { await driver.executeScript("arguments[0].scrollTop = 0;", menu); } catch {}
    await driver.sleep(80);

    let links = await menu.findElements(By.xpath(exactXpath));
    if (!links.length) {
      for (let i = 0; i < 20 && !links.length; i++) {
        await driver.executeScript(
          "arguments[0].scrollTop = arguments[0].scrollTop + Math.max(40, Math.floor(arguments[0].clientHeight * 0.85));",
          menu
        );
        await driver.sleep(120);
        links = await menu.findElements(By.xpath(exactXpath));
      }
    }
    if (!links.length) {
      links = await menu.findElements(By.xpath(containsXpath));
    }
    if (links.length) {
      const link = links[0];
      await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", link);
      await driver.sleep(100);
      await driver.executeScript("arguments[0].click();", link);
      return true;
    }
  }
  return false;
}

// If Applications opens a dedicated page/panel, click app links there
async function clickFromApplicationsPage(driver, appText) {
  const t = normalize(appText).toLowerCase().replace(/'/g, "\\'");
  // Search within main/section/div (not nav)
  const exact = By.xpath(
    "(.//main|.//section|.//div)[not(ancestor::nav) and not(ancestor::*[contains(@class,'navbar')])]" +
    `//a[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='${t}'] | ` +
    "(.//main|.//section|.//div)[not(ancestor::nav) and not(ancestor::*[contains(@class,'navbar')])]" +
    `//a[*[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='${t}']]`
  );
  const contains = By.xpath(
    "(.//main|.//section|.//div)[not(ancestor::nav) and not(ancestor::*[contains(@class,'navbar')])]" +
    `//a[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'${t}')]`
  );

  let links = await driver.findElements(exact);
  if (!links.length) links = await driver.findElements(contains);
  if (!links.length) return false;

  const link = links[0];
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", link);
  await driver.sleep(120);
  await driver.executeScript("arguments[0].click();", link);
  return true;
}

async function waitForLoaded(driver, beforeSnapshot) {
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

(async function applicationsWhitelistViaMenuOrPage() {
  const driver = createDriver();
  try {
    await loginAndSelectProfile(driver, USERNAME, PASSWORD);

    if (!APP_WHITELIST.length) {
      console.log('ℹ️ APP_WHITELIST is empty — add app names to test.');
      return;
    }

    for (let i = 0; i < APP_WHITELIST.length; i++) {
      const label = APP_WHITELIST[i];
      console.log(`➡️  Opening app: ${label}`);

      // Snapshot current content for SPA change detection
      let beforeText = '';
      try {
        const el = await driver.findElement(By.xpath(
          "//h1 | //h2 | //main | //section | //div[contains(@class,'panel') or contains(@class,'card') or contains(@class,'container') or contains(@class,'content')]"
        ));
        beforeText = normalize(await el.getText()).slice(0, 160);
      } catch {}

      // Open Applications (menu or page)
      const openResult = await openApplications(driver);

      let clicked = false;
      if (openResult.type === 'menu') {
        clicked = await clickFromVisibleMenus(driver, label);
        if (!clicked) {
          // one more try after re-opening (some menus auto-close)
          const again = await openApplications(driver);
          if (again.type === 'menu') {
            clicked = await clickFromVisibleMenus(driver, label);
          }
        }
      } else if (openResult.type === 'page') {
        clicked = await clickFromApplicationsPage(driver, label);
      }

      if (!clicked) {
        console.warn(`❌ Could not click "${label}" via Applications (menu/page not found or item missing)`);
        continue;
      }

      await driver.sleep(WAIT_AFTER_CLICK_MS);
      const ok = await waitForLoaded(driver, beforeText);
      if (!ok) {
        console.warn(`⚠️ Load not confirmed for "${label}" (continuing)`);
      } else {
        console.log(`✅ Opened: ${label}`);
      }

      // Return home for the next app
      await goHome(driver);
    }

    console.log('✅ Applications (whitelist) navigation test complete.');
  } catch (err) {
    console.error('🚨 Test error:', err.message || err);
  } finally {
    await driver.quit();
    console.log('🔚 Browser closed');
  }
})();

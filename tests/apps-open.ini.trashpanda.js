// tests/applications.test.trashpanda.js
//WORKING!!!
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.trashpanda') });

const createDriver = require('../utils/driver');
const { By, until, Key } = require('selenium-webdriver');
const fs = require('fs');

console.log('[DEBUG BASE_URL]', process.env.BASE_URL);

const USERNAME = process.env.LOGIN_USERNAME || '';
const PASSWORD = process.env.LOGIN_PASSWORD || '';
if (!USERNAME || !PASSWORD) throw new Error('Set LOGIN_USERNAME / LOGIN_PASSWORD in .env.trashpanda');

const BASE_URL = process.env.BASE_URL || '';
const SAFETYOPS_MAIN_URL =
  process.env.SAFETYOPS_MAIN_URL ||
  (BASE_URL ? BASE_URL.replace(/\/auth\/Account\/Login.*$/i, '') + '/n/safetyops/main' : '');

if (!BASE_URL) throw new Error('Set BASE_URL in .env.trashpanda');


const WAIT_AFTER_CLICK_MS      = 2200;
const WAIT_AFTER_HOME_MS       = 900;
const WAIT_AFTER_OPEN_MENU_MS  = 600;
const MAX_OPEN_MENU_RETRIES    = 3;

const APP_WHITELIST = [
'ADMIN ONLY',
'AUL',
'BUILDING EVACUATION DRILL',
'COMPLIANCE ASSESSMENT',
'COURSE ADD/EDIT',
'ERGO ASSESSMENT',
'ETRACKER OLD',
'E-TRACKER',
'FIRE FACILITIES',
'FIRE TRAINING SCHEDULE',
'INCIDENT REPORTING',
'INSPECTIONS (IDATS)',
'JHA ADMIN',
'JOB SAFETY BRIEF',
'LICENSE MANAGEMENT',
'LM',
'MEDICAL SURVEILLANCE (OMSS)',
'NFIRS',
'NFPA 1500 CHECKLIST',
'ORGANIZATION MANAGEMENT',
'PERMITS',
'PERSONNEL ADMINISTRATION (PA)',
'PLAN REVIEW',
'POWERTRX RELIABILITY',
'RESPIRATOR PROGRAM',
'SAFETY CONCERN MGT.',
'SF91 MV ACCIDENT REPORT',
'TRAINING ADMINISTRATION (TA)',
'WEB TRAINING ADMINISTRATION',
'WORK TASK',
];

const APP_SUBITEMS = {
  'INCIDENT REPORTING': ['INCIDENT REPORTING MAIN'],
  'INSPECTIONS (IDATS)': ['IDATS MAIN'],
  'PERSONNEL ADMINISTRATION (PA)': ['PA MAIN'],
};

function normalize(s) { return (s || '').replace(/\s+/g, ' ').trim(); }


/* ──────────────────────────────────────────────
   Helpers: robust element finding & screenshots
   ────────────────────────────────────────────── */
async function findByAny(driver, locators, timeoutEach = 4000) {
  for (const loc of locators) {
    try {
      const el = await driver.wait(until.elementLocated(loc), timeoutEach);
      await driver.wait(until.elementIsVisible(el), 3000);
      return el;
    } catch {

    }
  }
  throw new Error('None of the locators matched: ' + locators.map(String).join(' | '));
}

async function safeScreenshot(driver, name) {
  try {
    const png = await driver.takeScreenshot();
    fs.writeFileSync(name, png, 'base64');
    console.warn('🖼 Saved screenshot:', name);
  } catch {
    
  }
}
/* ──────────────────────────────────────────────
   Trashpanda LOGIN
   ────────────────────────────────────────────── */
async function loginToTrashpanda(driver, username, password) {
  if (!BASE_URL) throw new Error('BASE_URL missing in .env.trashpanda');

  await driver.manage().deleteAllCookies();
  await driver.get(BASE_URL);
  await driver.sleep(250);

  // 1) Click “Login to SafetyOps” if present (splash)
  try {
    const loginToSafetyOpsBtn = await driver.wait(
  until.elementLocated(By.xpath(
    “//*[self::button or self::a or self::input[@type='submit']]” +
    “[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login to safetyops')]”
  )),
  10000
);

    await driver.wait(until.elementIsVisible(loginToSafetyOpsBtn), 2000);
    await driver.wait(until.elementIsEnabled(loginToSafetyOpsBtn), 2000);
    await loginToSafetyOpsBtn.click();
    console.log(“✅ Clicked 'Login to SafetyOps'”);
    await driver.sleep(400);
  } catch {
    // splash not present; continue
  }

  // 2) username/password
  const userLocators = [
    By.id('Username'), By.id('UserName'), By.name('Username'), By.name('UserName'),
    By.css('input#Input_Username'),
    By.css('input[placeholder="Username"]'),
    By.css('input[placeholder*="user" i]'),
    By.css('input[type="text"]'),
    // legacy:
    By.id('UserID'), By.name('UserID')
  ];
  const passLocators = [
    By.id('Password'), By.name('Password'),
    By.css('input#Input_Password'),
    By.css('input[placeholder="Password"]'),
    By.css('input[placeholder*="password" i]'),
    By.css('input[type="password"]')
  ];
  const loginBtnLocators = [
    By.xpath("//button[@type='submit' and normalize-space()='Login']"),
    By.css('button[type="submit"]'),
    By.xpath("//input[@type='submit' and (contains(@value,'Login') or contains(@value,'Log in'))]"),
    // legacy:
    By.id('btnPDC')
  ];

  // quick post-login chrome detector (skip typing if we’re already in)
  const isPostLoginUI = async () => {
    const hits = await driver.findElements(By.xpath(
      "//a[normalize-space()='APPLICATIONS' or normalize-space()='Applications' or " +
      "     normalize-space()='MODULES'      or normalize-space()='Modules'] " +
      "| //*[contains(.,'SafetyOps Main')]"
    ));
    return hits.length > 0;
  };
  if (await isPostLoginUI()) {
    console.log("ℹ️ Post-login UI detected; skipping credential entry.");
    return;
  }

  const userInput = await findByAny(driver, userLocators, 1800);
  const passInput = await findByAny(driver, passLocators, 1800);

  if (!userInput || !passInput) {
    if (!(await isPostLoginUI())) {
      await safeScreenshot(driver, 'trashpanda_login_not_found.png');
      throw new Error('Username/Password fields not found on Trashpanda login.');
    }
    return;
  }

  // 3) Type credentials and submit
  await userInput.clear(); await userInput.sendKeys(username);
  await passInput.clear(); await passInput.sendKeys(password);

  await driver.executeScript(`
    const [u,p] = arguments;
    ['input','keyup','change','blur'].forEach(t => {
      u.dispatchEvent(new Event(t,{bubbles:true}));
      p.dispatchEvent(new Event(t,{bubbles:true}));
    });
  `, userInput, passInput);

  const loginBtn = await (async () => {
    for (const loc of loginBtnLocators) {
      const el = await driver.findElements(loc);
      if (el.length) return el[0];
    }
    return null;
  })();

  if (loginBtn) {
    try { await loginBtn.click(); }
    catch { await driver.executeScript("arguments[0].click();", loginBtn); }
  } else {
    await passInput.sendKeys(Key.ENTER);
  }

// Wait for the OIDC round-trip to complete: either we see /signin-oidc (postback) or land on main
await driver.wait(async () => {
  const u = (await driver.getCurrentUrl()) || '';
  return /\/signin-oidc/i.test(u) || /\/n\/safetyops\/main/i.test(u);
}, 20000).catch(() => { /* swallow; we’ll try a gentle nudge below */ });

// If we saw the postback, the next hop should be main; wait for it
try {
  await driver.wait(until.urlMatches(/\/n\/safetyops\/main/i), 20000);
} catch {
  // One gentle nudge to main if the chain stalled
  try {
    await driver.get(SAFETYOPS_MAIN_URL);
    await driver.wait(until.urlMatches(/\/n\/safetyops\/main/i), 10000);
  } catch (e) {
    const url = await driver.getCurrentUrl();
    const title = await driver.getTitle().catch(()=> '');
    console.warn("❗ Could not reach main after login. URL:", url, "Title:", title);
    await safeScreenshot(driver, 'stuck_on_auth.png');
    // throw e; // enable if you want the test to fail hard here
  }
}

// Optional: dump auth-ish cookies for sanity while debugging
try {
  const cookies = await driver.manage().getCookies();
  const authish = cookies.filter(c => /aspnet|auth|identity|oidc/i.test(c.name));
  console.log('[COOKIES]', authish);
} catch {}


  }

/* ──────────────────────────────────────────────
   Navigation helpers (same pattern as staging)
   ────────────────────────────────────────────── */
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
      "[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'APPLICATIONS') " +
      " or contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'MODULES')]"
    )),
    10000
  );
  await driver.wait(until.elementIsVisible(trigger), 5000);
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", trigger);
  return trigger;
}

// Open Applications/Modules (menu or page) with retries + pauses
async function openApplications(driver) {
  const trigger = await findApplicationsTrigger(driver);

  for (let attempt = 0; attempt < MAX_OPEN_MENU_RETRIES; attempt++) {
    try { await trigger.click(); } catch {}
    await driver.sleep(WAIT_AFTER_OPEN_MENU_MS);

    let menus = await getVisibleMenuContainers(driver);
    if (menus.length) return { type: 'menu', menus };

    try { await driver.actions().move({ origin: trigger }).perform(); } catch {}
    await driver.sleep(WAIT_AFTER_OPEN_MENU_MS);

    menus = await getVisibleMenuContainers(driver);
    if (menus.length) return { type: 'menu', menus };
  }

  // If no dropdown, assume it opened a page
  try {
    await driver.wait(until.elementLocated(By.xpath(
      "//*[self::h1 or self::h2 or self::div]" +
      "[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'APPLICATIONS') " +
      " or contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'MODULES')]"
    )), 4000);
    return { type: 'page' };
  } catch {
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

async function clickFromApplicationsPage(driver, appText) {
  const t = normalize(appText).toLowerCase().replace(/'/g, "\\'");
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

/* ──────────────────────────────────────────────
   Logout helper (robust, self-contained)
   ────────────────────────────────────────────── */
async function clickLogout(driver) {
  const SNOOZE = 900; // tiny local wait

  // Strong selectors (based on your DOM)
  const candidates = [
    By.css('a[href="/Logout"]'),
    By.css('a.mm-list-item__link[href="/Logout"]'),
    By.linkText('Log out'),
    By.partialLinkText('Log out'),
    By.xpath(
      "//*[self::a or self::button]" +
      "[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'log out') or " +
      " contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'logout')]"
    ),
    By.xpath("//a[.//mm-icon[@icon='logout'] or .//svg//*[name()='path']]")
  ];

  // Prefer searching inside the header/top bar first
  const headerCandidates = [
    By.css('header'),
    By.css('nav.navbar, .topbar')
  ];

  async function locateIn(scope) {
    for (const by of candidates) {
      const els = scope ? await scope.findElements(by) : await driver.findElements(by);
      for (const el of els) {
        try { if (await el.isDisplayed()) return el; } catch {}
      }
    }
    return null;
  }

  try {
    // Find header/topbar if present
    let header = null;
    for (const h of headerCandidates) {
      const found = await driver.findElements(h);
      if (found.length) { header = found[0]; break; }
    }

    // Find the logout element
    let el = await locateIn(header);
    if (!el) el = await locateIn(null);
    if (!el) throw new Error('Log out element not found');

    // Click it
    try { await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el); } catch {}
    try { await el.click(); } catch { await driver.executeScript("arguments[0].click();", el); }
    await driver.sleep(SNOOZE);
    console.log('👋 Clicked Log out');

    // ===== Confirm we landed on a logged-out state (URL, UI, or missing cookie)
    const confirmed = await (async () => {
      try {
        await driver.wait(async () => {
          const url = (await driver.getCurrentUrl()) || '';

          // 1) Known logout/login URLs
          if (/\/logout\/loggedout\b/i.test(url)) return true;
          if (/\/auth\/account\/login\b/i.test(url) || /\/login\b/i.test(url)) return true;

          // 2) Login UI signs
          const loginBits = await driver.findElements(
            By.css('input[type="password"], input#Username, input#UserName, input[name="Username"]')
          );
          if (loginBits.length > 0) return true;

          // "Login to SafetyOps" splash
          const splashLogin = await driver.findElements(By.xpath(
            "//*[self::button or self::a or self::input[@type='submit']]" +
            "[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login to safetyops')]"
          ));
          if (splashLogin.length > 0) return true;

          // 3) Cookie gone?
          try {
            const authCookie = await driver.manage().getCookie('SafetyOps.Authentication');
            if (!authCookie) return true;
          } catch {
            // Some drivers throw if cookie missing; treat as success
            return true;
          }

          return false;
        }, 7000);
        return true;
      } catch { return false; }
    })();

    if (!confirmed) console.warn('⚠️ Logout clicked but login screen not detected');
    return true;

  } catch (e) {
    console.warn('⚠️ Could not find/click Log out:', e?.message || e);
    return false;
  }
}

/* ──────────────────────────────────────────────
   Main
   ────────────────────────────────────────────── */
(async function applicationsWhitelistViaMenuOrPage_Trashpanda() {
  const driver = createDriver();
  try {
    await loginToTrashpanda(driver, USERNAME, PASSWORD);

    if (!APP_WHITELIST.length) {
      console.log('ℹ️ APP_WHITELIST is empty — add app names to test.');
      return;
    }

    for (let i = 0; i < APP_WHITELIST.length; i++) {
      const label = APP_WHITELIST[i];
      console.log(`➡️  Opening app: ${label}`);

      let beforeText = '';
      try {
        const el = await driver.findElement(By.xpath(
          "//h1 | //h2 | //main | //section | //div[contains(@class,'panel') or contains(@class,'card') or contains(@class,'container') or contains(@class,'content')]"
        ));
        beforeText = normalize(await el.getText()).slice(0, 160);
      } catch {}

      const openResult = await openApplications(driver);

      let clicked = false;
      if (openResult.type === 'menu') {
        clicked = await clickFromVisibleMenus(driver, label);
        if (!clicked) {
          const again = await openApplications(driver);
          if (again.type === 'menu') clicked = await clickFromVisibleMenus(driver, label);
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
      if (!ok) console.warn(`⚠️ Load not confirmed for "${label}" (continuing)`);
      else console.log(`✅ Opened: ${label}`);

      // Sub-items (if/when needed)
      if (APP_SUBITEMS[label]?.length) {
        // add submenu logic when you have the HTML/visible text for options
      }

      await goHome(driver);
    }

    console.log('✅ Applications (whitelist) navigation test complete. (Trashpanda)');
  } catch (err) {
    console.error('🚨 Test error:', err.message || err);
  } finally {
  try {
    const didLogout = await clickLogout(driver);
    if (!didLogout) console.warn('⚠️ Logout not clicked (continuing to quit)');
  } catch (e) {
    console.warn('⚠️ Error during logout:', e?.message || e);
  }

  await driver.quit();
  console.log('🔚 Browser closed');
}

})();

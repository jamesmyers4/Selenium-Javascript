import { By, until } from 'selenium-webdriver';
import { normalize, waitForLoaded } from './waits.js';

const WAIT_AFTER_CLICK_MS      = 2200;
const WAIT_AFTER_HOME_MS       = 900;
const WAIT_AFTER_OPEN_MENU_MS  = 600;
const MAX_OPEN_MENU_RETRIES    = 3;


export async function goHome(driver) {
  const mainLink = await driver.findElements(By.xpath(
    "//*[self::a or self::button][contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'ESAMS MAIN PAGE')]"
  ));
  if (mainLink.length) {
    await mainLink[0].click();
    await driver.sleep(WAIT_AFTER_HOME_MS);
    return;
  }
  const logos = await driver.findElements(By.xpath("//img[contains(@alt,'ESAMS Logo')]/ancestor::a[1]"));
  if (logos.length) {
    await logos[0].click();
    await driver.sleep(WAIT_AFTER_HOME_MS);
    return;
  }
  try { await driver.navigate().back(); } catch {}
  await driver.sleep(WAIT_AFTER_HOME_MS);
}

export async function clickLogout(driver) {
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
  const headerCandidates = [ By.css('header'), By.css('nav.navbar, .topbar') ];

  async function locateIn(scope) {
    for (const by of candidates) {
      const els = scope ? await scope.findElements(by) : await driver.findElements(by);
      for (const el of els) { try { if (await el.isDisplayed()) return el; } catch {} }
    }
    return null;
  }

  try {
    let header = null;
    for (const h of headerCandidates) {
      const found = await driver.findElements(h);
      if (found.length) { header = found[0]; break; }
    }
    let el = await locateIn(header);
    if (!el) el = await locateIn(null);
    if (!el) throw new Error('Log out element not found');

    try { await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", el); } catch {}
    try { await el.click(); } catch { await driver.executeScript("arguments[0].click();", el); }
    await driver.sleep(900);
    console.log('👋 Clicked Log out');

    const confirmed = await (async () => {
      try {
        await driver.wait(async () => {
          const url = (await driver.getCurrentUrl()) || '';
          if (/\/logout\/loggedout\b/i.test(url)) return true;
          if (/\/auth\/account\/login\b/i.test(url) || /\/login\b/i.test(url)) return true;
          const loginBits = await driver.findElements(
            By.css('input[type="password"], input#Username, input#UserName, input[name="Username"]')
          );
          if (loginBits.length > 0) return true;
          const splashLogin = await driver.findElements(By.xpath(
            "//*[self::button or self::a or self::input[@type='submit']]" +
            "[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login to esams')]"
          ));
          if (splashLogin.length > 0) return true;

          try {
            const authCookie = await driver.manage().getCookie('ESAMS.Authentication');
            if (!authCookie) return true;
          } catch { return true; }
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
    if (!links.length) links = await menu.findElements(By.xpath(containsXpath));
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

export async function openApp(driver, label) {
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
  if (!clicked) return false;

  await driver.sleep(WAIT_AFTER_CLICK_MS);
  return await waitForLoaded(driver, beforeText);
}


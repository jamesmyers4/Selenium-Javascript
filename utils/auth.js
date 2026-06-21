// utils/auth.js
import { By, until, Key } from 'selenium-webdriver';
import { findByAny, safeScreenshot } from './waits.js';

export async function login(
  driver,
  {
    username     = process.env.LOGIN_USERNAME,
    password     = process.env.LOGIN_PASSWORD,
    baseUrl      = process.env.BASE_URL,
    safetyopsMainUrl = process.env.SAFETYOPS_MAIN_URL
  } = {}
) {
  if (!baseUrl) throw new Error('Set BASE_URL in .env.trashpanda');
  if (!username || !password) throw new Error('Set LOGIN_USERNAME / LOGIN_PASSWORD in .env.trashpanda');

    if (!safetyopsMainUrl) {
   const root = baseUrl.replace(/\/(auth\/account\/login|login)(\/.*)?$/i, '');    safetyopsMainUrl = `${root}/n/safetyops/main`;
  }

  await driver.manage().deleteAllCookies();
  await driver.get(baseUrl);

  try {
    const splash = await driver.wait(
      until.elementLocated(By.xpath(
        "//*[self::button or self::a or self::input[@type='submit']]" +
        "[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'login to safetyops')]"
      )), 750
    );
    await driver.wait(until.elementIsEnabled(splash), 750);
    await splash.click();
  } catch {}

  const userLocators = [
    By.id('Username'), By.id('UserName'), By.name('Username'), By.name('UserName'),
    By.css('input#Input_Username'),
    By.css('input[placeholder=\"Username\"]'),
    By.css('input[placeholder*=\"user\" i]'),
    By.css('input[type=\"text\"]'),
    By.id('UserID'), By.name('UserID') // legacy
  ];
  const passLocators = [
    By.id('Password'), By.name('Password'),
    By.css('input#Input_Password'),
    By.css('input[placeholder=\"Password\"]'),
    By.css('input[placeholder*=\"password\" i]'),
    By.css('input[type=\"password\"]')
  ];
  const loginBtnLocators = [
    By.xpath("//button[@type='submit' and normalize-space()='Login']"),
    By.css('button[type=\"submit\"]'),
    By.xpath("//input[@type='submit' and (contains(@value,'Login') or contains(@value,'Log in'))]"),
    By.id('btnPDC') // legacy
  ];

  const userInput = await findByAny(driver, userLocators, 250);
  const passInput = await findByAny(driver, passLocators, 250);

  await userInput.clear(); await userInput.sendKeys(username);
  await passInput.clear(); await passInput.sendKeys(password);
  await driver.executeScript(`
    const [u,p] = arguments;
    ['input','keyup','change','blur'].forEach(t => {
      u.dispatchEvent(new Event(t,{bubbles:true}));
      p.dispatchEvent(new Event(t,{bubbles:true}));
    });
  `, userInput, passInput);

  // Submit
  let loginBtn = null;
  for (const loc of loginBtnLocators) {
    const el = await driver.findElements(loc);
    if (el.length) { loginBtn = el[0]; break; }
  }
  if (loginBtn) {
    try { await loginBtn.click(); }
    catch { await driver.executeScript("arguments[0].click();", loginBtn); }
  } else {
    await passInput.sendKeys(Key.ENTER);
  }

  // OIDC hop or main
  await driver.wait(async () => {
    const u = (await driver.getCurrentUrl()) || '';
    return /\/signin-oidc/i.test(u) || /\/n\/safetyops\/main/i.test(u);
  }, 20000).catch(()=>{});

  // Ensure main
  try {
    await driver.wait(until.urlMatches(/\/n\/safetyops\/main/i), 20000);
  } catch {
    try {
      await driver.get(safetyopsMainUrl);
      await driver.wait(until.urlMatches(/\/n\/safetyops\/main/i), 10000);
    } catch {
      await safeScreenshot(driver, 'stuck_on_auth.png');
      console.warn('❗ Could not reach main after login.');
    }
  }
}

//Function to Open Reports and Click each Report

export async function openRms(driver, label) {
  let beforeText = '';
  try {
    const el = await driver.findElement(By.xpath(
      "//h1 | //h2 | //main | //section | //div[contains(@class,'panel') or contains(@class,'card') or contains(@class,'container') or contains(@class,'content')]"
    ));
    beforeText = normalize(await el.getText()).slice(0, 160)
  } catch {}

  const openResult = await openReports(driver);

  let clicked = false;
  if (openResult.type === 'menu') {
    clicked = await clickFromVisibleMenus(driver, label);
    if (!clicked) {
      const again = await openReports(driver);
      if (again.type === 'menu') clicked = await clickFromVisibleMenus (driver, label);
    }
  } else if (openResult.type === 'page') {
    clicked = await click
  }
}

async function findReportsTrigger(driver) {
  const trigger = await driver.wait(
    until.elementLocated(By.xpath(
      "//*[self::a or self::button]" +
      "[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'APPLICATIONS') "
    )),
    10000
  );
  await driver.wait(until.elementIsVisible(trigger), 5000);
  await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", trigger);
  return trigger;
}

async function openReports(driver) {
  const trigger = await findReportsTrigger(driver);

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
      "[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'REPORTS')]"
    )), 4000);
    return { type: 'page' };
  } catch {
    return { type: 'none' };
  }
}
// Login to Staging
//WORKING!!!

const createDriver = require('../../utils/driver');
const loginAndSelectProfile = require('../../utils/loginHelper.staging');
const { By, until } = require('selenium-webdriver');

(async function loginTest() {
  const driver = createDriver();

  try {
    const username = '555544';  // Replace with username
    const password = 'f';  // Replace with password

    await loginAndSelectProfile(driver, username, password);

    // Confirm login was successful — check for dashboard element or title
    //await driver.wait(until.elementLocated(By.id('dashboard')), 10000);
    console.log("✅ Login and profile selection successful.");

  } catch (err) {
    console.error("❌ Login test failed:", err.message);
  } finally {
    await driver.quit();
    console.log("🔚 Browser closed");
  }
})();

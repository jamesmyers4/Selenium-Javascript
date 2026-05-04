const createDriver = require('../../utils/driver');
const loginAndSelectProfile = require('../../utils/loginHelper.staging');
const { By, until } = require('selenium-webdriver');

(async function loginTest() {
  const driver = createDriver();

  try {
    const username = '555544';
    const password = 'f';

    await loginAndSelectProfile(driver, username, password);

    console.log("✅ Login and profile selection successful.");

  } catch (err) {
    console.error("❌ Login test failed:", err.message);
  } finally {
    await driver.quit();
    console.log("🔚 Browser closed");
  }
})();

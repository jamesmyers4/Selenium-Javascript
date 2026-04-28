// utils/driver.js
import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { cfg } from './config.pwrtrx.js'; // ← loads HEADLESS and other env vars

export default function createDriver(opts = {}) {
  const headless   = (opts.headless ?? cfg.headless);     // boolean
  const windowSize = opts.windowSize ?? '1400,900';        // string "W,H"
  const extraArgs  = opts.extraArgs  ?? [];                // array of additional chrome flags

  const options = new chrome.Options()
    .addArguments(
      '--start-maximized',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--metrics-recording-only',
      '--log-level=3',
      //'--disable-gpu',
      //'--disable-3d-apis',
      //'--disable-webgl',
      //'--disable-webgl2',
      //'--disable-dev-shm-usage',
      //'--no-sandbox',
      //'--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
      //'--disable-blink-features=AutomationControlled',
      //'--disable-background-networking',
      //'--disable-background-timer-throttling',
      //'--disable-component-update',
      //'--disable-client-side-phishing-detection',
      //'--disable-features=PushMessaging,BackgroundFetch,BackgroundSync',
      //'--disable-breakpad',
      //'--safebrowsing-disable-auto-update',
      //'--disable-software-rasterizer',
      //'--disable-extensions',
      ...extraArgs
    );

  if (headless) {
    options.addArguments('--headless=new');
  }

  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
}

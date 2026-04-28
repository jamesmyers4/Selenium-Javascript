// utils/alerts.js (ESM)
import fs from 'fs';

export async function dismissAnyJsAlert(driver, { accept = true, label = '' } = {}) {
  try {
    const alert = await driver.switchTo().alert();
    const text = await alert.getText().catch(() => '');
    if (accept) await alert.accept(); else await alert.dismiss();
    try {
      const png = await driver.takeScreenshot();
      fs.writeFileSync(`alert_${Date.now()}.png`, png, 'base64');
    } catch {}
    console.warn(`⚠️ Dismissed JS alert${label ? ' ' + label : ''}: "${text}"`);
    return text || '';
  } catch { return ''; }
}

export async function drainAllAlerts(driver, { accept = true, max = 5 } = {}) {
  for (let i = 0; i < max; i++) {
    const seen = await dismissAnyJsAlert(driver, { accept, label: `(#${i + 1})` });
    if (!seen) break;
    await driver.sleep(200);
  }
}

export async function waitForNoAlerts(driver, { quietMs = 600, deadlineMs = 4000 } = {}) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const had = await dismissAnyJsAlert(driver);
    if (!had) {
      await driver.sleep(quietMs);
      const stillNone = !(await dismissAnyJsAlert(driver));
      if (stillNone) return true;
    }
    await driver.sleep(150);
  }
  return false;
}

export async function withAlertGuard(driver, fn, { retries = 2, accept = true } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isAlert = String(e).includes('UnexpectedAlertOpenError') || e?.name === 'UnexpectedAlertOpenError';
      if (!isAlert) throw e;
      await drainAllAlerts(driver, { accept });
      await waitForNoAlerts(driver);
      // retry
    }
  }
  // final try
  await dismissAnyJsAlert(driver, { accept, label: '(final)' });
  return await fn();
}

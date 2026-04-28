export async function expectStatusEventually(driver, page, expected, { timeoutMs = 8000, pollMs = 250 } = {}) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    try {
      const s = (await page.status()) || '';
      last = s;
      if (s.trim().toLowerCase() === expected.trim().toLowerCase()) return;
    } catch {}
    await driver.sleep(pollMs);
  }
  throw new Error(`Expected status "${expected}" but saw "${last}" after ${timeoutMs}ms`);
}

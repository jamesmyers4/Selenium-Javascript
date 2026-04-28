// utils/diagnostics.js
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

export async function writeText(p, txt) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, txt, 'utf8');
}

export async function saveScreenshot(driver, filePath) {
  const png = await driver.takeScreenshot();
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, png, 'base64');
}

import { expect } from 'chai';
import createDriver from '../../utils/driver.js';
import fs from 'fs';
import { login } from '../../utils/auth.js';
import { openApp, goHome, clickLogout } from '../../utils/nav.js';
import { By, Key, until } from 'selenium-webdriver';
import { typeInto, selectOption, clickByText, findField } from '../../utils/forms.js';
import { closeOverlays, waitForNoOverlays, isFieldPopulated } from '../../utils/ui.js';
import { drainAllAlerts, withAlertGuard, waitForNoAlerts } from '../../utils/alerts.js';
import { cfg } from '../../utils/config.pwrtrx.js';
import { installStabilityProbes } from '../../utils/stability.js';
import { pickFromDialogByText, pickByText } from '../../utils/pickers.js';

const APP_LABEL = process.env.PWRTRX_APP_LABEL || 'POWERTRX RELIABILITY';
const APP_URL = process.env.PWRTRX_URL || "";

const RECORD_OUTAGE_LABELS = (process.env.PWRTRX_RECORD_OUTAGE_LABELS?.split("|")) || ["Add"];

const LABELS = {
  startDate: process.env.PWRTRX_START_DATE_LABELS?.split("|") || ["Date Outage Began"],
  startTime: process.env.PWRTRX_START_TIME_LABELS?.split("|") || ["Time Outage Began"],
  address: process.env.PWRTRX_ADDRESS_LABELS?.split("|") || ["Address"],
  cause: process.env.PWRTRX_CAUSE_LABELS?.split("|") || ["Cause"],
  substation: process.env.PWRTRX_SUBSTATION_LABELS?.split("|") || ["Substation"],
  circuit: process.env.PWRTRX_CIRCUIT_LABELS?.split("|") || ["Circuit"],
  customers: process.env.PWRTRX_CUSTOMERS_LABELS?.split("|") || ["Number of Customers Without Power"],
  event: process.env.PWRTRX_EVENT_LABELS?.split("|") || ["Event"],
};

const DATE_CSS = process.env.PWRTRX_DATE_SELECTOR || null;
const TIME_CSS = process.env.PWRTRX_TIME_SELECTOR || null;

async function ensureOnPwrtrx(driver) {
  const isInApp = async () => /pwrtrx|powertrx|reliability/i.test((await driver.getCurrentUrl()) || "");
  if (await isInApp()) return;

  if (APP_URL) {
    try {
      await driver.get(APP_URL);
      await driver.wait(isInApp, 5_000);
      return;
    } catch {}
  }
  const opened = await withAlertGuard(driver, () => openApp(driver, APP_LABEL), { retries: 2 });
  if (!opened) throw new Error(`Could not find/click ${APP_LABEL}`);
  await driver.wait(isInApp, 12_000).catch(() => {});
}

async function clickAddOutage(driver) {
  try {
    const button = await driver.wait(
      until.elementLocated(By.css('button[aria-label="Add"].mat-mdc-mini-fab.mat-accent')),
      10000
    );
    await button.click();
    console.log('Button clicked successfully');
  } catch (err) {
    console.error('Error clicking button:', err);
  }
}

async function selectPrimaryCause(driver, targetLabel = null) {
  const triggerCss = 'hgw-select-list[name="txtPrimaryCause"] button[aria-label="Open Select List"]';
  const paneSelector = '.cdk-overlay-pane, .mat-select-panel, .mat-autocomplete-panel, .select-panel';
  const checkboxCss = 'input[type="checkbox"], input.mdc-checkbox__native-control';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    const dropdownButton = await driver.wait(until.elementLocated(By.css(triggerCss)), 8_000);
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", dropdownButton);
    await driver.wait(until.elementIsVisible(dropdownButton), 3_000);
    await driver.wait(until.elementIsEnabled(dropdownButton), 3_000);
    try { await dropdownButton.click(); } catch (e) { await driver.executeScript('arguments[0].click();', dropdownButton); }

    await sleep(120);

    await driver.wait(async () => {
      const panes = await driver.findElements(By.css(paneSelector));
      return panes.length > 0;
    }, 8_000);

    const panes = await driver.findElements(By.css(paneSelector));
    const paneInfos = await Promise.all(panes.map(async p => {
      const id = await driver.executeScript('return arguments[0].id || "";', p);
      const idNumMatch = id.match(/cdk-overlay-(\d+)/);
      const idNum = idNumMatch ? Number(idNumMatch[1]) : null;
      const rect = await driver.executeScript(
        `const r = arguments[0].getBoundingClientRect ? arguments[0].getBoundingClientRect() : {width:arguments[0].offsetWidth,height:arguments[0].offsetHeight,top:arguments[0].offsetTop,left:arguments[0].offsetLeft};
         return {w:Math.round(r.width), h:Math.round(r.height), top:Math.round(r.top), left:Math.round(r.left)};`,
        p
      );
      const inputsCount = await driver.executeScript(`return arguments[0].querySelectorAll('${checkboxCss}').length;`, p).catch(()=>0);
      return { webEl: p, id, idNum, rect, inputsCount };
    }));

    console.log('[selectPrimaryCause] found panes:', paneInfos.map(pi => ({id:pi.id, idNum:pi.idNum, rect:pi.rect, inputsCount:pi.inputsCount})));

    const visible = paneInfos.filter(pi => pi.rect.w > 8 && pi.rect.h > 8);
    const sorted = visible.sort((a,b) => {
      if ((b.inputsCount - a.inputsCount) !== 0) return (b.inputsCount - a.inputsCount);
      return (b.idNum || 0) - (a.idNum || 0);
    });
    const chosenPaneInfo = sorted[0] || paneInfos.sort((a,b) => (b.idNum||0)-(a.idNum||0))[0];

    if (!chosenPaneInfo) {
      throw new Error('No overlay pane found to target for Primary Cause.');
    }

    console.log('[selectPrimaryCause] chosen pane:', { id: chosenPaneInfo.id, idNum: chosenPaneInfo.idNum, inputsCount: chosenPaneInfo.inputsCount });

    let chosenPane = chosenPaneInfo.webEl;
    let inputs = await chosenPane.findElements(By.css(checkboxCss));
    const MAX_SCROLL_ATTEMPTS = 10;
    let attempt = 0;
    while ((inputs.length === 0 || inputs.length < 2) && attempt < MAX_SCROLL_ATTEMPTS) {
      attempt++;
      await driver.executeScript(`
        const p = arguments[0];
        p.scrollTop = (p.scrollTop || 0) + (p.clientHeight || Math.round((p.getBoundingClientRect().height||200)));
        return p.scrollTop;
      `, chosenPane).catch(()=>null);
      await sleep(120 + attempt * 30);
      inputs = await chosenPane.findElements(By.css(checkboxCss));
      if (inputs.length) break;
    }

    if (!inputs.length) {
      for (const pi of paneInfos.sort((a,b) => (b.inputsCount||0)-(a.inputsCount||0))) {
        const found = await pi.webEl.findElements(By.css(checkboxCss));
        if (found.length) { chosenPane = pi.webEl; inputs = found; console.log('[selectPrimaryCause] fallback pane chosen:', pi.id); break; }
      }
    }

    if (!inputs.length) {
      const snap = await driver.executeScript(() => {
        return Array.from(document.querySelectorAll('.cdk-overlay-pane')).map(p => ({id:p.id||'', w:Math.round(p.getBoundingClientRect().width||0), h:Math.round(p.getBoundingClientRect().height||0), text: (p.innerText||'').slice(0,200)}));
      });
      console.error('[selectPrimaryCause] no checkbox inputs found. Snapshot:', JSON.stringify(snap, null, 2));
      throw new Error('No checkbox inputs found in any overlay pane.');
    }

    let chosenInput = null;
    if (targetLabel) {
      const targetLower = targetLabel.trim().toLowerCase();
      for (const inp of inputs) {
        try {
          const labelText = await driver.executeScript(`
            const i = arguments[0];
            let n = i.parentElement;
            for (let d=0; d<6 && n; d++) {
              const t = (n.innerText || '').trim();
              if (t) return t;
              n = n.parentElement;
            }
            return '';
          `, inp);
          if (labelText && labelText.toLowerCase().includes(targetLower)) { chosenInput = inp; break; }
        } catch (e) {}
      }
    }

    if (!chosenInput) {
      const visibleInputs = [];
      for (const i of inputs) {
        try { if (await i.isDisplayed()) visibleInputs.push(i); } catch(e) {}
      }
      const pool = visibleInputs.length ? visibleInputs : inputs;
      chosenInput = pool[Math.floor(Math.random() * pool.length)];
    }

    const diagBefore = await driver.executeScript(`
      const i = arguments[0];
      const id = i.id || i.getAttribute('id') || '';
      const label = (i.parentElement && i.parentElement.innerText) ? i.parentElement.innerText.trim() : (i.closest && i.closest('mat-checkbox') ? (i.closest('mat-checkbox').innerText||'').trim() : '');
      return { id, label };
    `, chosenInput);

    try {
      await chosenInput.click();
    } catch (e) {
      await driver.executeScript(`
        const inp = arguments[0];
        if (inp && typeof inp.click === 'function') { inp.click(); return true; }
        const lbl = inp && inp.parentElement ? inp.parentElement.querySelector('label') || inp.parentElement : null;
        if (lbl && typeof lbl.click === 'function') { lbl.click(); return true; }
        inp && inp.dispatchEvent && inp.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        inp && inp.dispatchEvent && inp.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
        return true;
      `, chosenInput);
    }

    await sleep(160);

    const verified = await driver.executeScript(`
      const inp = arguments[0];
      const checked = !!(inp.checked || inp.getAttribute && inp.getAttribute('aria-checked') === 'true');
      const id = inp.id || '';
      const label = (inp.parentElement && inp.parentElement.innerText) ? inp.parentElement.innerText.trim() : (inp.closest && inp.closest('mat-checkbox') ? (inp.closest('mat-checkbox').innerText||'').trim() : '');
      return { id, label, checked };
    `, chosenInput);

    console.log('[selectPrimaryCause] click result:', diagBefore, verified);
    return { clicked: true, before: diagBefore, verified };
  } catch (err) {
    console.error('[selectPrimaryCause] error:', err);
    throw err;
  }
}


async function findElByCssOrLabels(driver, css, labels, root = null) {
  const searchContext = root || driver;

  if (css) {
    try {
      return await searchContext.findElement(By.css(css));
    } catch (err) {
       console.warn(`[findElByCssOrLabels] CSS selector not found (${css}) in ${root ? 'root' : 'document'}`);
    }
  }

  if (!labels || !labels.length) {
    throw new Error(`No css or labels provided to find element.`);
  }

  const found = await driver.executeScript(
    (rootNode, labelsArr) => {
      const root = rootNode || document;
      const candidates = Array.from(root.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"]'));
      function textOf(node) {
         if (!node) return '';
        const label = node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('placeholder') || '');
        if (label && label.trim()) return label.trim();
        const id = node.id;
        if (id) {
          const byLabel = root.querySelector(`label[for="${id}"]`);
          if (byLabel && byLabel.innerText) return byLabel.innerText.trim();
        }
         let n = node.parentElement;
        for (let i = 0; i < 6 && n; i++) {
          const t = (n.innerText || '').trim();
          if (t) return t;
          n = n.parentElement;
        }
        return '';
      }

      for (const L of labelsArr) {
        const target = String(L).trim().toLowerCase();
        for (const cand of candidates) {
          try {
            const txt = (textOf(cand) || '').toLowerCase();
            if (txt.includes(target)) {
              return cand;
            }
          } catch (e) {  }
        }
      }
      return null;
    },
    root || null,
    labels
  );

  if (found) return found;
  throw new Error(`Could not locate element by ${css ? css : "(no css)"} or labels: ${labels.join(" | ")} within ${root ? "root" : "document"}`);
}

async function setValueAndVerify(driver, { css = null, labels = null, value, root = null, timeout = 5000, force = false }) {
  const el = await findElByCssOrLabels(driver, css, labels, root);

  try {
    if (!force && await isFieldPopulated(el)) return el;
  } catch (e) {
  }

  try { await driver.wait(until.elementIsVisible(el), 2000); } catch {}
  try { await driver.wait(until.elementIsEnabled(el), 2000); } catch {}

  try { await el.clear(); } catch (e) {  }

  let typed = false;
  try {
    await el.sendKeys(value, Key.TAB);
    typed = true;
  } catch (e) {
  }

  if (!typed) {
    try {
      await driver.executeScript(`
        const el = arguments[0];
        const v = arguments[1];
        if ('value' in el) {
          el.value = v;
        } else {
          el.setAttribute('value', v);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      `, el, value);
      try { await el.sendKeys(Key.TAB); } catch {}
    } catch (ee) {
      console.warn('[setValueAndVerify] JS fallback failed', ee);
    }
  }

  await driver.sleep(120);

  const expected = String(value).trim();
  let got = '';
  try {
    await driver.wait(async () => {
      const attrVal = (await el.getAttribute('value')) || '';
      const textVal = (await el.getText && await el.getText()) || '';
      got = (attrVal || textVal || '').trim();
      return got === expected || got.startsWith(expected) || expected.startsWith(got);
    }, timeout);
  } catch (err) {
    const snap = await driver.executeScript(() => {
      const overlays = Array.from(document.querySelectorAll('.cdk-overlay-pane, .mat-dialog-container')).map(p => ({
        id: p.id || '',
        text: (p.innerText || '').slice(0, 500)
      }));
      return { title: document.title, url: location.href, overlays };
    });
    console.error('[setValueAndVerify] value mismatch after set', { expected, got, snapshot: snap });
    expect(got.trim()).to.equal(expected, `Value did not match expected (expected="${expected}" got="${got}")`);
  }

  return el;
}

async function findOverlayContainingLabels(driver, labels = []) {
  const overlays = await driver.findElements(By.css('.cdk-overlay-pane, .mat-dialog-container'));
  for (let i = overlays.length - 1; i >= 0; i--) {
    const ov = overlays[i];
    try {
      const html = await driver.executeScript('return arguments[0].innerText || arguments[0].textContent || "";', ov);
      const txt = (html || '').toLowerCase();
      for (const L of labels) {
        const target = String(L).trim().toLowerCase();
        if (target && txt.includes(target)) {
          return ov;
        }
      }
    } catch (e) {
    }
  }
  return overlays.length ? overlays[overlays.length - 1] : null;
}

async function closeDatepickers(driver) {
  try { await driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform(); } catch (e) {}
  await driver.sleep(120);
  const dp = await driver.findElements(By.css('.mat-datepicker-popup, .mat-datepicker-content, .mat-calendar'));
  if (dp.length) {
    try {
      await driver.executeScript(`document.body.click();`);
    } catch (e) {}
    await driver.sleep(120);
    try { await driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform(); } catch (e) {}
    await driver.sleep(120);
  }
}


function nowParts() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return { mm, dd, yyyy, hh, mi };
}

describe("E2E: PowerTRX Reliability (.env.pwrtrx)", function () {
  this.timeout(120_000);
  this.retries(1);

  let driver;

  before(async () => {
    driver = createDriver();
    await login(driver);
    await drainAllAlerts(driver);
    await waitForNoAlerts(driver);
    await installStabilityProbes(driver);

    await driver.wait(async () => {
      const readyState = await driver.executeScript('return document.readyState');
      return readyState === 'complete';
    }, 10000);
    
    await ensureOnPwrtrx(driver);
  });

  after(async () => {
    if (!driver) return;
    try { await drainAllAlerts(driver); } catch {}
    try { await clickLogout(driver); } catch {}
    try { await driver.quit(); } catch {}
  });

  it("should be on POWERTRX RELIABILITY", async () => {
    const isInApp = async () => /pwrtrx|powertrx|reliability/i.test(await driver.getCurrentUrl());
    expect(await isInApp(), "Not in PowerTRX Reliability app").to.equal(true);

    const appElement = await driver.wait(
      until.elementLocated(By.xpath("//*[contains(., 'POWERTRX RELIABILITY') or contains(., 'Outages')]")),
      10000,
      "Could not find PowerTRX Reliability UI elements"
    );
    expect(appElement, "PowerTRX Reliability UI not found").to.exist;
  });

  it("Clicks Add Outage", async () => {
    await clickAddOutage(driver, "Relocation");
  });

it("Populates Date, Time, then Address (modal-scoped) — safe against datepicker overlays", async () => {
  const { mm, dd, yyyy, hh, mi } = nowParts();
  const dateStr = `${mm}/${dd}/${yyyy}`;
  const timeStr = `${hh}:${mi}`;
  const testAddress = process.env.PWRTRX_TEST_ADDRESS || "123 Main St";

  const modalRoot = await driver.wait(async () => {
    const m = await findOverlayContainingLabels(driver, [...LABELS.startDate, ...LABELS.address]);
    return m;
  }, 5000);

  const dateEl = await setDateInModal(driver, {
    css: DATE_CSS,
    labels: LABELS.startDate,
    value: dateStr,
    modalRoot,
    timeout: 6000,
    force: true
  });
  console.log('[test] date set (modal) ->', dateStr);

  await driver.sleep(120);

  const timeEl = await setValueAndVerify(driver, {
    css: TIME_CSS,
    labels: LABELS.startTime,
    value: timeStr,
    root: modalRoot,
    timeout: 6000,
    force: true
  });
  console.log('[test] time set (modal) ->', timeStr);

  await driver.sleep(160);

  try {
    await setValueAndVerify(driver, {
      css: null,
      labels: LABELS.address,
      value: testAddress,
      root: modalRoot,
      timeout: 6000,
      force: true
    });
    console.log('[test] address set (modal) ->', testAddress);
  } catch (err) {
    const snap = await driver.executeScript(modalRoot ? 'return arguments[0].outerHTML.slice(0,1200)' : 'return document.body.innerHTML.slice(0,1200)', modalRoot).catch(()=>null);
    console.error('[test] failed to set address. Modal snapshot (truncated):', snap);
    throw err;
  }

  const readDateEl = await findElByCssOrLabels(driver, DATE_CSS, LABELS.startDate, modalRoot);
  const readTimeEl = await findElByCssOrLabels(driver, TIME_CSS, LABELS.startTime, modalRoot);
  const readAddrEl = await findElByCssOrLabels(driver, null, LABELS.address, modalRoot);

  const gotDate = ((await readDateEl.getAttribute('value')) || (await readDateEl.getText()) || '').trim();
  const gotTime = ((await readTimeEl.getAttribute('value')) || (await readTimeEl.getText()) || '').trim();
  const gotAddr = ((await readAddrEl.getAttribute('value')) || (await readAddrEl.getText()) || '').trim();

  expect(gotDate.startsWith(dateStr), `Modal Start Date mismatch: expected ${dateStr} got ${gotDate}`).to.equal(true);
  expect(gotTime.startsWith(timeStr), `Modal Start Time mismatch: expected ${timeStr} got ${gotTime}`).to.equal(true);
  expect(gotAddr === testAddress, `Modal Address mismatch: expected ${testAddress} got ${gotAddr}`).to.equal(true);

  console.log(`[test] verified modal date=${gotDate} time=${gotTime} address=${gotAddr}`);
});

  it("should select a checkbox for a random Primary Cause", async () => {
      const result = await selectPrimaryCause(driver);
      console.log('PrimaryCause select result:', result);

      expect(result && result.verified && result.verified.checked).to.equal(true, 'Checkbox not checked after click');

      await waitForNoOverlays(driver, { timeout: 3000}).catch(()=>{});

      try { await driver.executeScript('document.activeElement && document.activeElement.blur && document.activeElement.blur();'); } catch(e) {}
  
      try { await driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform(); } catch(e) {}
    });

  it("navigates back to ESAMS Main + Log Out", async () => {
    await closeOverlays(driver);
    await withAlertGuard(driver, () => goHome(driver));
    const home = await driver.wait(
      until.elementsLocated(By.xpath(
        "//*[contains(.,'Modules') or contains(.,'Applications') or contains(.,'HOME')]"
      )),
      15_000
    );
    expect(home.length).to.be.greaterThan(0);
  });
});
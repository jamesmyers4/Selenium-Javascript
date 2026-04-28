// utils/stability.js
import { By, until } from 'selenium-webdriver';

// Install once per session: tracks fetch/XHR + DOM mutations timestamps
export async function installStabilityProbes(driver) {
  await driver.executeScript(() => {
    if (window.__probesInstalled) return;
    window.__probesInstalled = true;

    // Network probe
    window.__pendingNet = 0;
    window.__lastNetTs = Date.now();

    const markReq = () => { window.__pendingNet++; window.__lastNetTs = Date.now(); };
    const markRes = () => { window.__pendingNet = Math.max(0, window.__pendingNet - 1); window.__lastNetTs = Date.now(); };

    // fetch
    const _fetch = window.fetch;
    if (_fetch && !_fetch.__wrapped) {
      const wrapped = function(...args){
        markReq();
        return _fetch.apply(this, args).finally(markRes);
      };
      wrapped.__wrapped = true;
      window.fetch = wrapped;
    }

    // XHR
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    if (!_send.__wrapped) {
      XMLHttpRequest.prototype.open = function(...args){ this.__tracking = true; return _open.apply(this, args); };
      XMLHttpRequest.prototype.send = function(...args){
        if (this.__tracking) markReq();
        this.addEventListener('loadend', markRes, { once: true });
        return _send.apply(this, args);
      };
      XMLHttpRequest.prototype.send.__wrapped = true;
    }

    // DOM probe
    window.__lastDomTs = Date.now();
    const mo = new MutationObserver(() => { window.__lastDomTs = Date.now(); });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: false });

    // Angular testability (if present)
    window.__whenAngularStable = (timeoutMs = 8000) => {
      return new Promise(resolve => {
        try {
          const all = window.getAllAngularTestabilities?.();
          if (all && all.length) {
            let done = false;
            const to = setTimeout(() => { if (!done) resolve(false); }, timeoutMs);
            let remaining = all.length;
            all.forEach(t => t.whenStable(() => {
              if (done) return;
              remaining -= 1;
              if (remaining === 0) { done = true; clearTimeout(to); resolve(true); }
            }));
            return;
          }
        } catch {}
        resolve(false); // not Angular or failed
      });
    };
  });
}

// Wait until no net requests for idleMs and no DOM mutations for quietMs
export async function waitForCalm(driver, { network = 600, dom = 250, timeout = 12000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await driver.executeScript(() => ({
      pending: window.__pendingNet || 0,
      lastNetTs: window.__lastNetTs || 0,
      lastDomTs: window.__lastDomTs || 0,
      now: Date.now()
    }));
    const netIdle = state.pending === 0 && (state.now - state.lastNetTs) >= network;
    const domQuiet = (state.now - state.lastDomTs) >= dom;
    if (netIdle && domQuiet) return true;
    await new Promise(r => setTimeout(r, 75));
  }
  return false;
}

// If Angular testability is present, wait for it (no-op otherwise)
export async function waitForAngularStable(driver, timeout = 8000) {
  return await driver.executeAsyncScript((to, done) => {
    if (!window.__whenAngularStable) { done(false); return; }
    window.__whenAngularStable(to).then(done);
  }, timeout);
}

// Convenience that tries Angular first, then calm
export async function settle(driver, {timeout = 15000, network = 700, dom = 300} = {}) {
  await waitForAngularStable(driver, Math.min(6000, timeout)).catch(()=>{});
  await waitForCalm(driver, { network, dom, timeout }).catch(()=>{});
}

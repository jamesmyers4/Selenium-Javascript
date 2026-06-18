## Selenium JavaScript Test Suite

An end-to-end test suite extracted from work on **a multi-module enterprise web application for safety and personnel administration**, targeting fire incident reporting, power outage tracking, and a 30+ module application navigation layer. This repo is a **read-quality showcase** of the testing approach — the test code is real, but it was written against the live application and is **not** clone-and-run. See [Running this](#running-this).

## What this demonstrates

- **Angular Material Design component library** — a purpose-built utility module for interacting with CDK overlay panels, Material Design datepickers, picker dialogs, and checkbox tables, with per-component retry logic and diagnostic screenshot capture on failure. (`utils/pickers.js`)
- **Network and DOM stability probes** — wraps XHR and fetch at the JavaScript level to track in-flight requests, monitors DOM mutations via MutationObserver, and provides a `waitForCalm()` function that gates test actions on genuine browser quiescence rather than arbitrary sleeps. (`utils/stability.js`)
- **Alert guard pattern** — wraps any browser interaction in a retry envelope that catches `UnexpectedAlertOpenError`, dismisses the alert, and retries, so unexpected JavaScript dialogs do not break the test run. (`utils/alerts.js`)
- **Configuration-driven test architecture** — field labels, app names, CSS selectors, and picker behavior are injected via environment variables so the same test code targets multiple environments without branching. (`utils/config.neris.js`, `utils/config.pwrtrx.js`)
- **Batch record creation mode** — the fire incident E2E suite can create N records in a single headless session, controlled by `FIR_RUN_BATCH`, `BATCH_COUNT`, and `BATCH_DELAY_MS`, supporting both CI single-record runs and data seeding. (`tests/e2e/neris.e2e.test.js`)
- **Multi-environment targeting** — dedicated .env files and npm script aliases for classic rendering, integration, and power outage environments, so the right credentials, base URLs, and field configurations load without any test code changes.
- **Field resolution abstraction** — `findField()` resolves inputs by label text, aria-label, placeholder, or name attribute across multiple selector strategies before failing, making form tests resilient to minor markup changes. (`utils/forms.js`)
- **Overlay management** — `closeOverlays()` clears CDK overlay panels via Escape key and backdrop clicks before interactions, preventing stale Material Design overlays from intercepting actions. (`utils/ui.js`)

## Angular Material Design handling

The most substantial part of the utility layer is the Material Design component library (`utils/pickers.js`). Testing an Angular Material application with Selenium presents consistent friction: picker dialogs open asynchronous CDK overlay panels that are detached from the main DOM, datepicker inputs dispatch custom Angular events rather than native input events, and selection dialogs require scrolling table rows to find options before clicking. A single `selectOption()` call in an ordinary Selenium test would fail silently on any of these surfaces.

The library addresses each case directly. `pickFireDepartment()` and `pickPrimaryIncidentType()` handle the specific picker patterns in the fire incident reporting form — opening the picker, searching by text, scrolling the result list, and selecting. `toggleRowCheckbox()` handles checkbox-table rows with a retry cycle that waits for the row to stabilize before attempting a click. `selectFromModal()` handles generic modal dialogs regardless of whether the selection surface is a list, a table, or an overlay panel. Each function captures a diagnostic screenshot on failure if `DEBUG_PICKERS` is set, writing it to `PICKERS_DIAG_DIR` for post-run inspection.

Forms with standard native inputs use a separate path. `findField()` in `utils/forms.js` tries label, aria-label, placeholder, and name lookups in sequence. `typeInto()` dispatches the full Angular event sequence (input, keyup, change, blur) after filling, because Angular's change detection does not trigger on native Selenium `sendKeys` alone. `waitForFieldEnabled()` polls until a field exits the disabled state before attempting input, handling the common pattern where form fields unlock conditionally after a prior selection.

## Stability and resilience

Timing is the primary failure mode in Selenium tests against Angular applications. The suite addresses it at three layers.

`stability.js` installs JavaScript-level probes into the page at test startup. It wraps XHR and fetch to track the count of in-flight requests, and attaches a MutationObserver to track DOM changes. `waitForCalm()` polls both counters until the network has been idle and the DOM has been quiet for a configurable window. `waitForAngularStable()` additionally queries Angular's testability interface if present. `settle()` combines both, providing a single call that guarantees the page has stopped loading and re-rendering before the test proceeds.

`alerts.js` handles a different class of timing failure: unexpected JavaScript alerts that emerge during or after navigation. `dismissAnyJsAlert()` probes for an open alert, accepts or dismisses it, and takes a screenshot. `drainAllAlerts()` repeats until the alert queue is clear. `withAlertGuard()` wraps a higher-order function: if the wrapped call raises `UnexpectedAlertOpenError`, it drains all alerts and retries rather than failing the test.

`waits.js` provides `findByAny()`, which accepts multiple locator strategies and resolves the first one that finds a visible element within the timeout. This is the fallback when a single locator is not reliable across environments.

## Test strategy

The suite covers two E2E flows and one breadth smoke layer.

The **fire incident reporting E2E tests** exercise the full create-navigate-fill cycle for the incident form. A single-record mode creates one incident, navigates the tabbed section structure, and fills required fields using the auto-fill utilities in `required.js` and `topTabsRequired.js`. Batch mode (`FIR_RUN_BATCH=true`) repeats the creation loop N times with a configurable inter-record delay, which serves both data seeding and light load simulation. The form fill logic is context-aware: section-level navigation opens the correct left sidebar item, tab-level navigation iterates through horizontal tabs, and `smartFillControl()` detects the input type (date, time, select, radio, checkbox) and applies the appropriate fill strategy.

The **power outage E2E tests** target a separate module with a modal-scoped form: a datepicker, time input, cause picker, and customer count field. The test opens the module, creates a new outage record, fills the modal form including a Material Design cause picker, and verifies the record saves successfully.

The **application smoke tests** open all 30+ application modules in sequence and assert each navigates without an error state. The module list is held in an environment-variable whitelist so the same test can target a subset for faster runs or a different environment where not all modules are deployed.

## Repo structure

```
tests/
  e2e/
    neris.e2e.test.js          Fire incident reporting E2E (single-record and batch modes)
    pwrtrx.e2e.test.js         Power outage module E2E
  smoke/
    apps-open.smoke.test.js    Opens all 30+ application modules in sequence
    rms-open.smoke.test.js     Report smoke (WIP)
  features/
    incident-reporting.e2e.js       Incident reporting state-transition tests
    incident-reporting.page.js      Page Object for the incident reporting module
    incident-reporting.fixtures.js  Fixture data

utils/
  driver.js               Selenium WebDriver factory (Chrome, headless toggle)
  auth.js                 Login flow with OIDC redirect handling
  nav.js                  goHome(), openApp(), clickLogout()
  forms.js                findField(), typeInto(), selectOption(), setCheckbox()
  ui.js                   closeOverlays(), waitForNoOverlays(), isFieldPopulated()
  alerts.js               dismissAnyJsAlert(), withAlertGuard(), drainAllAlerts()
  pickers.js              Material Design component library (CDK overlays, datepickers, modals)
  waits.js                findByAny(), waitForLoaded(), safeScreenshot()
  stability.js            Network + DOM stability probes, waitForCalm(), settle()
  required.js             collectTabProblems(), smartFillControl(), resolveAllTopTabs()
  topTabsRequired.js      clickLeftSection(), clickTopTab(), satisfyCoreTopTabs()
  diagnostics.js          ensureDir(), saveScreenshot(), writeText()
  assertions.js           Chai assertion helpers
  datetime.js             Date/time formatting helpers
  reporting.js            Report verification helpers
  config.neris.js         FIR environment config loader (frozen config object)
  config.pwrtrx.js        PowerTRX environment config loader
  loginHelper.staging.js      Staging environment login
  loginHelper.trashpanda.js   Integration environment login

scripts/
  print-env.js            Prints resolved environment variables for debugging

.mocharc.json             Timeout 60s, retries 1, spec reporter
package.json              npm scripts per environment target
```

## Running this

This is a read-quality showcase, not a runnable project. The tests were written against the live application and its runtime environment. No environment configuration, credentials, or application source is included — by design. Nothing in this repo is intended to run standalone; it is published to show test architecture, resilience patterns, and judgment about how to handle Angular Material Design components under Selenium.

## Tooling

Selenium WebDriver (Chrome), Mocha 11.7.5, Chai 6.2.0, cross-env, dotenv, ES Modules throughout. The suite exercises Angular Material Design components (CDK overlay panels, datepickers, picker dialogs), OIDC authentication flows, multi-tab form navigation, and a 30+ module application navigation layer.

---

Built by James Myers

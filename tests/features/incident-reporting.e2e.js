const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.trashpanda') });

const createDriver = require('../../../utils/driver');
const { login } = require('../../shared/auth');
const { IncidentReportingPage } = require('./incident-reporting.page');
const { makeIncident } = require('./incident-reporting.fixtures');
const { expectStatusEventually } = require('../../shared/assertions');
const { assertReportCount } = require('../../shared/reporting');

describe('Incident Reporting – E2E', () => {
  let driver;
  beforeAll(async () => { driver = createDriver(); await login(driver); }, 45000);
  afterAll(async () => { await driver.quit(); });

  it('Happy path Draft → Submitted → Closed and visible in Reports', async () => {
    const page = new IncidentReportingPage(driver);
    await page.openFromMain();

    const data = makeIncident();
    await page.startNewIncident(data);

    await expectStatusEventually(driver, page, 'Draft');
    await page.advanceStatus('Submit');
    await expectStatusEventually(driver, page, 'Submitted');
    await page.advanceStatus('Close');
    await expectStatusEventually(driver, page, 'Closed');

    // Cross-check in Reports (adjust names/filters/selectors in shared/reporting.js)
    await assertReportCount(driver, {
      report: 'INCIDENTS',
      filters: { Severity: data.severity, Status: 'Closed', DateRange: 'Today' },
      expected: c => c >= 1, // tolerant if non-empty prod data exists
    });
  }, 60000);
});

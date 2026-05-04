const { By, until } = require('selenium-webdriver');
const { openApp } = require('../../shared/nav');

class IncidentReportingPage {
  constructor(driver) { this.driver = driver; }

  async openFromMain() {
    const ok = await openApp(this.driver, 'INCIDENT REPORTING');
    if (!ok) throw new Error('Could not open Incident Reporting');
    await this.driver.wait(until.elementLocated(By.css('h1, [data-test="incidents-main"]')), 8000);
  }

  async startNewIncident(data) {
    await this.driver.findElement(By.css('[data-test="new-incident"]')).click();
    await this.driver.wait(until.elementLocated(By.css('form[data-test="incident-form"]')), 8000);

    await this.type('[name="Title"]', data.title);
    await this.type('[name="Description"]', data.description);
    await this.select('[name="Severity"]', data.severity);
    
    await this.driver.findElement(By.css('[data-test="save"]')).click();
  }

  async status() {
    const el = await this.driver.findElement(By.css('[data-test="status-badge"]'));
    return (await el.getText()).trim();
  }

  async advanceStatus(nextActionLabel) {
    await this.driver.findElement(By.css('[data-test="change-status"]')).click();
    await this.driver.findElement(By.xpath(`//button[normalize-space()="${nextActionLabel}"]`)).click();
  }

  async type(sel, val) {
    const el = await this.driver.findElement(By.css(sel));
    await el.clear(); await el.sendKeys(val);
  }
  async select(sel, val) {
    const el = await this.driver.findElement(By.css(sel));
    await el.sendKeys(val);
  }
}

module.exports = { IncidentReportingPage };

function makeIncident(overrides = {}) {
  const ts = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0,14);
  return {
    title: `[E2E] Incident ${ts}`,
    description: 'Automatically created by E2E test.',
    severity: 'Medium',
    ...overrides,
  };
}

module.exports = { makeIncident };

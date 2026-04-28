function makeIncident(overrides = {}) {
  const ts = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0,14);
  return {
    title: `[E2E] Incident ${ts}`,
    description: 'Automatically created by E2E test.',
    severity: 'Medium', // or whatever values your select expects
    ...overrides,
  };
}

module.exports = { makeIncident };

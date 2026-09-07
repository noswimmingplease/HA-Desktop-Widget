const { buildSparklinePoints, isSensorSparklineEligible } = require('../../src/sparklines.js');

describe('buildSparklinePoints', () => {
  it('returns an empty point string for an empty series', () => {
    expect(buildSparklinePoints([], 100, 40)).toBe('');
  });

  it('centers a single value', () => {
    expect(buildSparklinePoints([42], 100, 40)).toBe('50,20');
  });

  it('centers flat series without dividing by zero', () => {
    expect(buildSparklinePoints([5, 5, 5], 100, 40)).toBe('0,20 50,20 100,20');
  });

  it('scales a normal series across the sparkline box', () => {
    expect(buildSparklinePoints([0, 50, 100], 100, 40)).toBe('0,40 50,20 100,0');
  });
});

describe('isSensorSparklineEligible', () => {
  const sensor = (entityId, attributes = {}, state = '42') => ({
    entity_id: entityId,
    state,
    attributes,
  });

  it.each([
    ['storage used', sensor('sensor.rho_ssd_storage_used', { state_class: 'measurement' })],
    ['storage free', sensor('sensor.rho_data_storage_free', { device_class: 'data_size' })],
    ['storage total', sensor('sensor.chi_multimedia_storage_total', { device_class: 'data_size' })],
    ['accumulated total', sensor('sensor.energy_consumed', { state_class: 'total_increasing' })],
    ['raw DNS counter', sensor('sensor.pi_hole_dns_queries', { state_class: 'measurement' })],
    ['connected display count', sensor('sensor.gamma_displays_connected')],
  ])('rejects %s', (_label, entity) => {
    expect(isSensorSparklineEligible(entity)).toBe(false);
  });

  it.each([
    ['CPU load', sensor('sensor.rho_cpu_load', { state_class: 'measurement' })],
    ['metadata-poor GPU usage', sensor('sensor.gamma_nvidia_geforce_rtx_3080_usage')],
    ['temperature', sensor('sensor.rho_cpu_temperature', { device_class: 'temperature' })],
    ['power', sensor('sensor.gamma_gpu_power', { device_class: 'power' })],
    ['data rate', sensor('sensor.router_data_rate', { device_class: 'data_rate' })],
    ['blocked percentage', sensor('sensor.pi_hole_ads_percentage_blocked')],
    [
      'total power as a present reading',
      sensor('sensor.total_power', { device_class: 'power', state_class: 'measurement' }),
    ],
    [
      'storage device temperature',
      sensor('sensor.ssd_temperature', { device_class: 'temperature' }),
    ],
  ])('accepts %s', (_label, entity) => {
    expect(isSensorSparklineEligible(entity)).toBe(true);
  });

  it.each([
    [{ entity_id: 'light.office', state: '42', attributes: {} }],
    [sensor('sensor.unknown', {}, 'unavailable')],
    [sensor('sensor.unclassified_number')],
  ])('rejects non-sensor, non-numeric and semantically unknown values', (entity) => {
    expect(isSensorSparklineEligible(entity)).toBe(false);
  });
});

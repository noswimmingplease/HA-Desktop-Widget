function formatSparklineCoordinate(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(2)));
}

const ACCUMULATED_SENSOR_STATE_CLASSES = new Set(['total', 'total_increasing']);
const LIVE_SENSOR_STATE_CLASSES = new Set(['measurement', 'measurement_angle']);
const LIVE_SENSOR_DEVICE_CLASSES = new Set([
  'apparent_power',
  'aqi',
  'atmospheric_pressure',
  'battery',
  'carbon_dioxide',
  'carbon_monoxide',
  'current',
  'data_rate',
  'distance',
  'frequency',
  'gas',
  'humidity',
  'illuminance',
  'irradiance',
  'moisture',
  'nitrogen_dioxide',
  'nitrogen_monoxide',
  'nitrous_oxide',
  'ozone',
  'ph',
  'pm1',
  'pm10',
  'pm25',
  'power',
  'power_factor',
  'precipitation',
  'precipitation_intensity',
  'pressure',
  'reactive_power',
  'signal_strength',
  'sound_pressure',
  'speed',
  'sulphur_dioxide',
  'temperature',
  'volatile_organic_compounds',
  'volatile_organic_compounds_parts',
  'voltage',
  'volume_flow_rate',
  'wind_speed',
]);

function normalizeSensorSemanticText(entity) {
  return [entity?.entity_id?.split('.').slice(1).join(' '), entity?.attributes?.friendly_name]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasFiniteNumericSensorState(entity) {
  if (!entity?.entity_id?.startsWith('sensor.')) return false;
  const raw = typeof entity.state === 'string' ? entity.state.trim() : entity.state;
  if (raw === '' || raw == null) return false;
  return Number.isFinite(Number(raw));
}

/**
 * Whether an automatic Quick Access sparkline adds useful information for a sensor.
 *
 * Home Assistant's `measurement` state class is the strongest general signal that a value is a
 * live reading. Dashboard-specific exclusions run first because storage capacity and raw counters
 * are often exposed as measurements even though their 24-hour mini-lines add clutter rather than
 * diagnostic value. Explicit comparison graphs deliberately do not use this policy.
 */
function isSensorSparklineEligible(entity) {
  if (!hasFiniteNumericSensorState(entity)) return false;

  const attributes = entity.attributes || {};
  const semanticText = normalizeSensorSemanticText(entity);
  const stateClass = String(attributes.state_class || '').toLowerCase();
  const deviceClass = String(attributes.device_class || '').toLowerCase();
  const unit = String(attributes.unit_of_measurement || '').toLowerCase();

  const hasStorageSubject = /\b(?:storage|disk|filesystem|drive|ssd|hdd|space|capacity)\b/.test(
    semanticText
  );
  const hasCapacityMeasure =
    /\b(?:use|used|usage|utilisation|utilization|free|available|remaining|total|size|space|capacity)\b/.test(
      semanticText
    );
  if (hasStorageSubject && hasCapacityMeasure) return false;

  if (
    /\b(?:boot time|last boot|uptime|version|standing charge|cumulative|accumulative)\b/.test(
      semanticText
    )
  ) {
    return false;
  }

  const isRateOrRatio =
    /\b(?:rate|ratio|percentage|percent|per second|per minute|per hour)\b/.test(semanticText) ||
    /\/(?:s|sec|min|h|hr)\b/.test(unit);
  const isCounterOrInventory =
    /\b(?:count|counter|queries?|ads? blocked|clients?|domains?|displays? connected|processes?|packets?|requests?|events?|messages?)\b/.test(
      semanticText
    );
  if (isCounterOrInventory && !isRateOrRatio) return false;

  if (ACCUMULATED_SENSOR_STATE_CLASSES.has(stateClass)) return false;
  if (LIVE_SENSOR_STATE_CLASSES.has(stateClass)) return true;
  if (LIVE_SENSOR_DEVICE_CLASSES.has(deviceClass)) return true;

  return /\b(?:load|usage|utilisation|utilization|memory|temperature|temp|humidity|pressure|power|voltage|current|frequency|signal|latency|ping|speed|throughput|data rate|rate|illuminance|irradiance|battery|moisture|air quality|aqi|percentage|percent)\b/.test(
    semanticText
  );
}

function buildSparklinePoints(values, width, height) {
  const numericValues = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  const chartWidth = Number(width);
  const chartHeight = Number(height);

  if (
    !numericValues.length ||
    !Number.isFinite(chartWidth) ||
    !Number.isFinite(chartHeight) ||
    chartWidth <= 0 ||
    chartHeight <= 0
  ) {
    return '';
  }

  if (numericValues.length === 1) {
    return `${formatSparklineCoordinate(chartWidth / 2)},${formatSparklineCoordinate(chartHeight / 2)}`;
  }

  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const range = max - min;

  return numericValues
    .map((value, index) => {
      const x = (chartWidth * index) / (numericValues.length - 1);
      const y = range === 0 ? chartHeight / 2 : chartHeight - ((value - min) / range) * chartHeight;
      return `${formatSparklineCoordinate(x)},${formatSparklineCoordinate(y)}`;
    })
    .join(' ');
}

export { buildSparklinePoints, isSensorSparklineEligible };

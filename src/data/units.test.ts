import { describe, expect, it } from 'vitest';
import {
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
  unitsLabel,
} from './units';

describe('formatAltitude', () => {
  it('formats aviation feet and metric metres', () => {
    expect(formatAltitude(10_000, 'aviation')).toBe('32,808 ft');
    expect(formatAltitude(10_000, 'metric')).toBe('10,000 m');
  });

  it('handles missing values', () => {
    expect(formatAltitude(null, 'aviation')).toBe('—');
    expect(formatAltitude(null, 'metric')).toBe('—');
  });
});

describe('formatSpeed', () => {
  it('formats knots and kilometres per hour', () => {
    expect(formatSpeed(220, 'aviation')).toBe('428 kts');
    expect(formatSpeed(220, 'metric')).toBe('792 km/h');
  });

  it('handles missing values', () => {
    expect(formatSpeed(null, 'metric')).toBe('—');
  });
});

describe('formatVerticalRate', () => {
  it('formats feet per minute and metres per second', () => {
    expect(formatVerticalRate(2.5, 'aviation')).toBe('+492 fpm');
    expect(formatVerticalRate(2.5, 'metric')).toBe('+2.5 m/s');
    expect(formatVerticalRate(-1.4, 'aviation')).toBe('-276 fpm');
    expect(formatVerticalRate(-1.4, 'metric')).toBe('-1.4 m/s');
  });

  it('handles zero and missing values', () => {
    expect(formatVerticalRate(0, 'aviation')).toBe('+0 fpm');
    expect(formatVerticalRate(0, 'metric')).toBe('+0.0 m/s');
    expect(formatVerticalRate(null, 'metric')).toBe('—');
  });
});

describe('unitsLabel', () => {
  it('labels both unit systems', () => {
    expect(unitsLabel('aviation')).toBe('Aviation (ft, kts)');
    expect(unitsLabel('metric')).toBe('Metric (m, km/h)');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGalCoordFormat,
  setGalCoordFormat,
  onGalCoordFormatChange,
  formatGalLon,
  formatGalLat,
} from './gal-coord-format';

describe('gal-coord-format', () => {
  beforeEach(() => setGalCoordFormat('deg'));

  it('defaults to decimal degrees', () => {
    expect(getGalCoordFormat()).toBe('deg');
  });

  describe('decimal degrees', () => {
    it('formats longitude to one decimal', () => {
      expect(formatGalLon(123.4)).toBe('123.4°');
    });
    it('wraps longitude into [0, 360)', () => {
      expect(formatGalLon(360)).toBe('0.0°');
      expect(formatGalLon(-10)).toBe('350.0°');
    });
    it('keeps latitude signed', () => {
      expect(formatGalLat(30)).toBe('30.0°');
      expect(formatGalLat(-30)).toBe('-30.0°');
    });
  });

  describe('DMS', () => {
    beforeEach(() => setGalCoordFormat('dms'));

    it('breaks a longitude into deg/arcmin/arcsec', () => {
      expect(formatGalLon(123.4)).toBe('123°24′00″');
    });
    it('signs a negative latitude', () => {
      expect(formatGalLat(-30.5)).toBe('-30°30′00″');
    });
    it('carries a rounded 60″ up into arcmin/deg', () => {
      // 45.9999° → 45°59′59.64″ rounds the seconds to 60, carrying to 46°00′00″.
      expect(formatGalLat(45.9999)).toBe('46°00′00″');
    });
  });

  it('fires change handlers on real changes only', () => {
    setGalCoordFormat('deg');
    let calls = 0;
    onGalCoordFormatChange(() => { calls++; });
    setGalCoordFormat('deg');
    expect(calls).toBe(0);
    setGalCoordFormat('dms');
    expect(calls).toBe(1);
    setGalCoordFormat('dms');
    expect(calls).toBe(1);
  });
});

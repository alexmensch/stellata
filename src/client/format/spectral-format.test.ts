import { describe, expect, it } from 'vitest';
import { formatSpectral, spectralLine } from './spectral-format';

const UNKNOWN_LUM = 255;
const UNKNOWN_CLASS = 8;

describe('formatSpectral', () => {
  it('normalises spacing between class and luminosity tokens', () => {
    expect(formatSpectral('K0III', 5, 4)).toEqual({
      label: 'K0 III',
      descriptor: 'orange giant',
    });
    expect(formatSpectral('A0V', 2, 2)).toEqual({
      label: 'A0 V',
      descriptor: 'white main-sequence star',
    });
  });

  it('leaves an already-spaced label unchanged', () => {
    expect(formatSpectral('A0 V', 2, 2).label).toBe('A0 V');
  });

  it('keeps only the primary component of a composite', () => {
    expect(formatSpectral('K0III+K7V', 5, 4).label).toBe('K0 III');
    expect(formatSpectral('G2/G3V', 4, 2).label).toBe('G2');
  });

  it('handles decimal subclasses and supergiant tokens', () => {
    expect(formatSpectral('M1.5Iab', 6, 7)).toEqual({
      label: 'M1.5 Iab',
      descriptor: 'red supergiant',
    });
    expect(formatSpectral('M1Ia', 6, 8).descriptor).toBe('red supergiant');
    expect(formatSpectral('B8Ib', 1, 6).descriptor).toBe('blue-white supergiant');
  });

  it('splits the first luminosity token of a range', () => {
    expect(formatSpectral('F5IV-V', 3, 3).label).toBe('F5 IV-V');
  });

  it('white dwarf: descriptor has no colour prefix, label passes through', () => {
    expect(formatSpectral('DA2', UNKNOWN_CLASS, 0)).toEqual({
      label: 'DA2',
      descriptor: 'white dwarf',
    });
  });

  it('carbon vs Wolf-Rayet on the shared class-7 bucket', () => {
    expect(formatSpectral('C5,4', 7, UNKNOWN_LUM).descriptor).toBe('carbon star');
    expect(formatSpectral('WN5', 7, UNKNOWN_LUM).descriptor).toBe('Wolf-Rayet star');
  });

  it('hypergiant and subdwarf descriptors', () => {
    expect(formatSpectral('G0Ia+', 4, 9).descriptor).toBe('yellow hypergiant');
    expect(formatSpectral('sdB', 1, 1).descriptor).toBe('blue-white subdwarf');
  });

  it('unknown luminosity class → label only, no descriptor', () => {
    expect(formatSpectral('M5-9e', 6, UNKNOWN_LUM)).toEqual({
      label: 'M5-9e',
      descriptor: '',
    });
  });

  it('unknown spectral class → descriptor without colour', () => {
    expect(formatSpectral('kA3hA6mA7', UNKNOWN_CLASS, 2).descriptor).toBe(
      'main-sequence star',
    );
  });

  it('missing raw string → empty label, descriptor still composes', () => {
    expect(formatSpectral(undefined, 5, 4)).toEqual({
      label: '',
      descriptor: 'orange giant',
    });
  });
});

describe('spectralLine', () => {
  it('joins label and descriptor, dropping empty halves', () => {
    expect(spectralLine({ label: 'K0 III', descriptor: 'orange giant' })).toBe(
      'K0 III · orange giant',
    );
    expect(spectralLine({ label: 'M5-9e', descriptor: '' })).toBe('M5-9e');
    expect(spectralLine({ label: '', descriptor: 'orange giant' })).toBe(
      'orange giant',
    );
    expect(spectralLine({ label: '', descriptor: '' })).toBe('');
  });
});

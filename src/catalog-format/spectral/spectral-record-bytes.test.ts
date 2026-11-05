import { describe, it, expect } from 'vitest';
import {
  classifyFromGspspec,
  classifyFromSimbad,
  SPECTRAL_UNKNOWN,
} from './spectral-classify';
import {
  decodeSpectralBytes,
  encodeSpectralBytes,
  LUM_CLASS_UNKNOWN,
  LUM_CLASS_WHITE_DWARF,
  SPECT_CLASS_CARBON,
  SPECT_CLASS_UNKNOWN,
} from './spectral-record-bytes';

const bytesOf = (s: string) => encodeSpectralBytes(classifyFromSimbad(s)!);

describe('encodeSpectralBytes', () => {
  it('writes an MK type as its letter and luminosity class', () => {
    expect(bytesOf('G2V')).toEqual({ spectClass: 4, lumClass: 2 });
    expect(bytesOf('M1.5Iab')).toEqual({ spectClass: 6, lumClass: 7 });
    expect(bytesOf('A0')).toEqual({ spectClass: 2, lumClass: LUM_CLASS_UNKNOWN });
  });

  it('writes carbon and Wolf-Rayet into the one carbon class', () => {
    expect(bytesOf('C5,2e')).toEqual({ spectClass: SPECT_CLASS_CARBON, lumClass: LUM_CLASS_UNKNOWN });
    expect(bytesOf('WN5')).toEqual({ spectClass: SPECT_CLASS_CARBON, lumClass: LUM_CLASS_UNKNOWN });
  });

  it('writes a white dwarf as the unknown class with the WD luminosity code', () => {
    expect(bytesOf('DA1.9')).toEqual({ spectClass: SPECT_CLASS_UNKNOWN, lumClass: LUM_CLASS_WHITE_DWARF });
    expect(bytesOf('A0VII')).toEqual({ spectClass: SPECT_CLASS_UNKNOWN, lumClass: LUM_CLASS_WHITE_DWARF });
  });

  it('writes an ESP-ELS class with no luminosity class', () => {
    expect(encodeSpectralBytes(classifyFromGspspec('K')!))
      .toEqual({ spectClass: 5, lumClass: LUM_CLASS_UNKNOWN });
    expect(encodeSpectralBytes(classifyFromGspspec('CSTAR')!))
      .toEqual({ spectClass: SPECT_CLASS_CARBON, lumClass: LUM_CLASS_UNKNOWN });
  });

  it('writes unknown as both unknown codes', () => {
    expect(encodeSpectralBytes(SPECTRAL_UNKNOWN))
      .toEqual({ spectClass: SPECT_CLASS_UNKNOWN, lumClass: LUM_CLASS_UNKNOWN });
  });
});

describe('decodeSpectralBytes', () => {
  it('round-trips the bytes of every variant', () => {
    for (const info of [
      classifyFromSimbad('K0III')!, classifyFromSimbad('B3')!, classifyFromSimbad('C5,2e')!,
      classifyFromSimbad('WN5')!, classifyFromSimbad('DB4')!, classifyFromGspspec('M')!,
      SPECTRAL_UNKNOWN,
    ]) {
      const bytes = encodeSpectralBytes(info);
      expect(encodeSpectralBytes(decodeSpectralBytes(bytes))).toEqual(bytes);
    }
  });

  it('reads the fields the bytes drop back as not stated', () => {
    expect(decodeSpectralBytes(bytesOf('K0III')))
      .toEqual({ kind: 'mk', letter: 5, subclass: null, lumClass: 4 });
    expect(decodeSpectralBytes(bytesOf('WN5')))
      .toEqual({ kind: 'carbon', subclass: null });
    expect(decodeSpectralBytes(bytesOf('DA1.9')))
      .toEqual({ kind: 'white-dwarf', wdSubclass: null });
  });

  it('decodes exactly the byte pairs the encoder writes, and refuses the rest', () => {
    let decoded = 0;
    for (let spectClass = 0; spectClass < 256; spectClass++) {
      for (let lumClass = 0; lumClass < 256; lumClass++) {
        const bytes = { spectClass, lumClass };
        let info;
        try {
          info = decodeSpectralBytes(bytes);
        } catch {
          continue;
        }
        expect(encodeSpectralBytes(info), `${spectClass} / ${lumClass}`).toEqual(bytes);
        decoded++;
      }
    }
    // 7 letters × (9 luminosity classes + none), carbon, white dwarf, unknown.
    expect(decoded).toBe(73);
  });
});

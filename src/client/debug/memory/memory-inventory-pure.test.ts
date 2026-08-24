import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  byBytesDescending,
  formatBytes,
  geometryBytes,
  mipmapFactor,
  texelBytes,
  textureBytes,
  totalBytes,
  typedArrayRows,
  unknownCount,
  type ResidencyRow,
} from './memory-inventory-pure';

describe('memory-inventory / texelBytes', () => {
  it('sizes the HDR attachment formats', () => {
    // The three colour attachments the frame binds: RGBA16F, RG16F, and
    // the second RGBA16F. Getting these wrong misprices the single
    // largest viewport-scaled allocation in the app.
    expect(texelBytes(THREE.RGBAFormat, THREE.HalfFloatType)).toBe(8);
    expect(texelBytes(THREE.RGFormat, THREE.HalfFloatType)).toBe(4);
    expect(texelBytes(THREE.RedFormat, THREE.FloatType)).toBe(4);
    expect(texelBytes(THREE.RGBAFormat, THREE.UnsignedByteType)).toBe(4);
  });

  it('reads a packed type as a whole-texel size, not per channel', () => {
    // Depth24+stencil8 is 4 bytes for the texel, not 4 per channel.
    expect(texelBytes(THREE.DepthStencilFormat, THREE.UnsignedInt248Type)).toBe(4);
  });

  it('returns null for a compressed format rather than guessing', () => {
    expect(texelBytes(THREE.RGB_S3TC_DXT1_Format, THREE.UnsignedByteType)).toBeNull();
  });
});

describe('memory-inventory / mipmapFactor', () => {
  function texture(generateMipmaps: boolean, minFilter: THREE.MinificationTextureFilter) {
    const t = new THREE.Texture();
    t.generateMipmaps = generateMipmaps;
    t.minFilter = minFilter;
    return t;
  }

  it('charges the chain only when the filter samples it', () => {
    expect(mipmapFactor(texture(true, THREE.LinearMipmapLinearFilter))).toBeCloseTo(4 / 3, 12);
  });

  it('charges nothing when generateMipmaps is on but the filter is not a mipmap filter', () => {
    // three's default generateMipmaps is true, so keying on it alone
    // would inflate every NearestFilter data texture in the app by a third.
    expect(mipmapFactor(texture(true, THREE.LinearFilter))).toBe(1);
    expect(mipmapFactor(texture(true, THREE.NearestFilter))).toBe(1);
  });

  it('charges nothing when mipmaps are off', () => {
    expect(mipmapFactor(texture(false, THREE.LinearMipmapLinearFilter))).toBe(1);
  });
});

describe('memory-inventory / textureBytes', () => {
  it('takes the exact array length for a data texture', () => {
    const data = new Uint8Array(16 * 8 * 4);
    const tex = new THREE.DataTexture(data, 16, 8);
    tex.generateMipmaps = false;
    const row = textureBytes(tex);
    expect(row.basis).toBe('array');
    expect(row.bytes).toBe(512);
  });

  it('counts a 3D texture through its depth', () => {
    const data = new Uint8Array(4 * 4 * 4);
    const tex = new THREE.Data3DTexture(data, 4, 4, 4);
    const row = textureBytes(tex);
    expect(row.bytes).toBe(64);
    expect(row.detail).toContain('4×4×4');
  });

  it('falls back to the format math for an image-backed texture', () => {
    const tex = new THREE.Texture();
    tex.image = { width: 8, height: 4 };
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.generateMipmaps = false;
    const row = textureBytes(tex);
    expect(row.basis).toBe('format');
    expect(row.bytes).toBe(128);
  });

  it('reports an unsizeable texture as unknown, not as zero-cost', () => {
    // A row that cannot be priced must be visible as such — silently
    // adding 0 to the total reads as "this resource is free".
    const tex = new THREE.Texture();
    tex.image = { width: 8, height: 4 };
    tex.format = THREE.RGB_S3TC_DXT1_Format;
    const row = textureBytes(tex);
    expect(row.basis).toBe('unknown');
    expect(row.bytes).toBe(0);
  });
});

describe('memory-inventory / geometryBytes', () => {
  it('sums every attribute plus the index', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(3), 1));
    const row = geometryBytes(g);
    expect(row.bytes).toBe(36 + 24 + 6);
    expect(row.detail).toBe('2 attr + index');
  });

  it('counts an interleaved buffer once, not once per view', () => {
    const buffer = new THREE.InterleavedBuffer(new Float32Array(20), 5);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    g.setAttribute('uv', new THREE.InterleavedBufferAttribute(buffer, 2, 3));
    expect(geometryBytes(g).bytes).toBe(80);
  });
});

describe('memory-inventory / typedArrayRows', () => {
  it('charges a shared ArrayBuffer to one row only', () => {
    // The catalog parse can slice one downloaded buffer into columns;
    // summing every view would report several times what the heap holds.
    const shared = new ArrayBuffer(64);
    const rows = typedArrayRows({
      a: new Float32Array(shared, 0, 8),
      b: new Float32Array(shared, 32, 8),
      own: new Uint8Array(16),
      notAnArray: 'skip me',
    }, 'catalog');
    expect(rows.map((r) => r.label)).toEqual(['catalog.a', 'catalog.b', 'catalog.own']);
    expect(totalBytes(rows)).toBe(64 + 16);
    expect(rows[1].bytes).toBe(0);
    expect(rows[1].detail).toContain('shares a buffer');
  });
});

describe('memory-inventory / row aggregation', () => {
  const rows: ResidencyRow[] = [
    { label: 'small', bytes: 10, basis: 'array', detail: '' },
    { label: 'big', bytes: 1000, basis: 'format', detail: '' },
    { label: 'mystery', bytes: 0, basis: 'unknown', detail: '' },
  ];

  it('totals and counts unknowns', () => {
    expect(totalBytes(rows)).toBe(1010);
    expect(unknownCount(rows)).toBe(1);
  });

  it('sorts largest first', () => {
    expect([...rows].sort(byBytesDescending).map((r) => r.label))
      .toEqual(['big', 'small', 'mystery']);
  });
});

describe('memory-inventory / formatBytes', () => {
  it('holds bytes under a kibibyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('steps up per 1024 and keeps the precision readable', () => {
    expect(formatBytes(1024)).toBe('1.00 KiB');
    expect(formatBytes(1536)).toBe('1.50 KiB');
    expect(formatBytes(15 * 1024)).toBe('15.0 KiB');
    expect(formatBytes(150 * 1024)).toBe('150 KiB');
    expect(formatBytes(128 * 1024 * 1024)).toBe('128 MiB');
  });

  it('stops at gibibytes rather than inventing a unit', () => {
    expect(formatBytes(4 * 1024 ** 3)).toBe('4.00 GiB');
    expect(formatBytes(4096 * 1024 ** 3)).toBe('4096 GiB');
  });
});

import { describe, it, expect, vi } from 'vitest'

function fakePng(size = 120) {
  const buf = Buffer.alloc(size)
  buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
  return buf
}

function makeCfg(overrides = {}) {
  return {
    analysis: {
      preset: 'balanced',
      enableDetailLog: false,
      sampleRate: 1,
      timeoutMs: 1000,
      minBufferSize: 1,
      maxAnalyzableSizeInMB: 10,
      ...overrides
    }
  }
}

describe('imageAnalyzer invalid_dimensions', () => {
  it('当尺寸为 0x0 时返回 invalid_dimensions', async () => {
    vi.resetModules()
    vi.mock('../utils/imageUtils.js', async () => {
      const real = await vi.importActual('../utils/imageUtils.js')
      return {
        ...real,
        identifyImageFormat: () => 'png',
        getImageMetadata: async () => ({ width: 0, height: 0, format: 'png', size: 128 })
      }
    })
    const { analyzeImage } = await import('../lib/imageAnalyzer.js')
    const buf = fakePng(128)
    const res = await analyzeImage({ buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: 'u' }, 'u', makeCfg())
    expect(res.isValid).toBe(false)
    expect(res.reason).toBe('invalid_dimensions')
  })
})



import { describe, it, expect, vi } from 'vitest'

function fakePng(size = 256) {
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
      timeoutMs: 50,
      minBufferSize: 10,
      maxAnalyzableSizeInMB: 10,
      ...overrides
    }
  }
}

describe('imageAnalyzer 严格校验开关', () => {
  it('strictValidation=false（默认）：元数据解析异常应继续并标记 parseErrorContinue', async () => {
    vi.resetModules()
    vi.mock('../utils/imageUtils.js', async () => ({
      identifyImageFormat: () => 'png',
      SUPPORTED_FORMATS: { PNG: 'png' },
      getImageMetadata: async () => { throw new Error('generic parse error') }
    }))
    const { analyzeImage } = await import('../lib/imageAnalyzer.js')
    const buf = fakePng(256)
    const res = await analyzeImage(
      { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: 'u' },
      'u',
      makeCfg({ strictValidation: false })
    )
    expect(res.isValid).toBe(true)
    expect(res.reason).toBeUndefined()
    expect(res.metadata && res.metadata.parseErrorContinue).toBe(true)
  })

  it('strictValidation=true：元数据解析异常应直接判定为 metadata_error', async () => {
    vi.resetModules()
    vi.mock('../utils/imageUtils.js', async () => ({
      identifyImageFormat: () => 'png',
      SUPPORTED_FORMATS: { PNG: 'png' },
      getImageMetadata: async () => { throw new Error('generic parse error') }
    }))
    const { analyzeImage } = await import('../lib/imageAnalyzer.js')
    const buf = fakePng(256)
    const res = await analyzeImage(
      { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: 'u' },
      'u',
      makeCfg({ strictValidation: true })
    )
    expect(res.isValid).toBe(false)
    expect(res.reason).toBe('metadata_error')
  })
})

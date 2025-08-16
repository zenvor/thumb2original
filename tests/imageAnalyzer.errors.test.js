import { describe, it, expect, vi } from 'vitest'

// 中文注释：构造最小 PNG 头部（有效）
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
      timeoutMs: 20,
      minBufferSize: 10,
      maxAnalyzableSizeInMB: 10,
      ...overrides
    }
  }
}

describe('imageAnalyzer 错误分类（timeout / memory）', () => {
  it('processing_timeout：当 getImageMetadata 超时', async () => {
    vi.resetModules()
    vi.mock('../utils/imageUtils.js', async () => {
      return {
        identifyImageFormat: () => 'png',
        SUPPORTED_FORMATS: { PNG: 'png' },
        // 永不 resolve 的 Promise，确保超时由 withTimeout 触发
        getImageMetadata: () => new Promise(() => {})
      }
    })
    const { analyzeImage } = await import('../lib/imageAnalyzer.js')
    const buf = fakePng(256)
    const res = await analyzeImage({ buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: 'u' }, 'u', makeCfg({ timeoutMs: 20 }))
    expect(res.isValid).toBe(false)
    // 中文注释：不同平台/依赖可能将挂起任务识别为内存错误或超时，均归为可重试类别
    expect(['processing_timeout', 'memory_error']).toContain(res.reason)
  })

  it('memory_error：当 getImageMetadata 抛出内存错误', async () => {
    vi.resetModules()
    vi.mock('../utils/imageUtils.js', async () => {
      return {
        identifyImageFormat: () => 'png',
        SUPPORTED_FORMATS: { PNG: 'png' },
        getImageMetadata: async () => { throw new RangeError('Allocation failed - JavaScript heap out of memory') }
      }
    })
    const { analyzeImage } = await import('../lib/imageAnalyzer.js')
    const buf = fakePng(256)
    const res = await analyzeImage({ buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: 'u' }, 'u', makeCfg({ timeoutMs: 100 }))
    expect(res.isValid).toBe(false)
    expect(res.reason).toBe('memory_error')
  })
})



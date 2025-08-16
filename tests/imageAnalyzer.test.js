import { describe, it, expect, vi } from 'vitest'
import { analyzeImage } from '../lib/imageAnalyzer.js'

function makeCfg(overrides = {}) {
  return {
    analysis: {
      preset: 'balanced',
      enableDetailLog: false,
      sampleRate: 100,
      timeoutMs: 2000,
      minBufferSize: 100,
      maxAnalyzableSizeInMB: 1,
      ...overrides
    }
  }
}

// 构造最小 PNG 头部（有效）
function fakePng(size = 120) {
  const buf = Buffer.alloc(size)
  buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
  return buf
}

// 构造 SVG 文本
function fakeSvg(text = '<svg viewBox="0 0 10 10"></svg>') {
  return Buffer.from(text, 'utf8')
}

describe('imageAnalyzer (P0)', () => {
  it('允许 image/* 内容类型并判定为有效（PNG）', async () => {
    const buffer = fakePng()
    const res = await analyzeImage({ buffer, headers: { 'content-type': 'image/png' }, finalUrl: 'u' }, 'u', makeCfg())
    expect(res.isValid).toBe(true)
    expect(res.metadata.format).toBeTruthy()
  })

  it('buffer 过小时标记 content_too_small', async () => {
    const buffer = Buffer.alloc(10)
    const res = await analyzeImage({ buffer, headers: {}, finalUrl: 'u' }, 'u', makeCfg({ minBufferSize: 100 }))
    expect(res.isValid).toBe(false)
    expect(res.reason).toBe('content_too_small')
  })

  it('未知格式时返回 unknown_format', async () => {
    const buffer = Buffer.alloc(200) // 无法识别
    const res = await analyzeImage({ buffer, headers: {}, finalUrl: 'u' }, 'u', makeCfg())
    expect(res.isValid).toBe(false)
    expect(res.reason).toBe('unknown_format')
  })

  it('超大文件跳过尺寸解析并根据嗅探判定', async () => {
    // 根据实现与校验规则，实际阈值最小为 1MB，这里构造 >1MB 的 PNG 头部缓冲
    const buffer = fakePng(2 * 1024 * 1024)
    const res = await analyzeImage({ buffer, headers: { 'content-type': 'image/png' }, finalUrl: 'u' }, 'u', makeCfg({ maxAnalyzableSizeInMB: 1 }))
    expect(res.metadata.skipped).toBe('too_large')
    expect(res.isValid).toBe(true)
  })

  it('text/plain + 实际为 SVG 时放行为有效', async () => {
    const svgPayload = '<svg width="120" height="120">' + 'x'.repeat(200) + '</svg>'
    const buffer = fakeSvg(svgPayload)
    const res = await analyzeImage({ buffer, headers: { 'content-type': 'text/plain' }, finalUrl: 'u' }, 'u', makeCfg({ minBufferSize: 50 }))
    expect(res.isValid).toBe(true)
    expect(res.metadata.format.toLowerCase()).toBe('svg')
  })

  it('SVG 无尺寸且无 viewBox 时，尺寸应为 unknown 且视为有效', async () => {
    const svgPayload = '<svg><!-- no width/height/viewBox --></svg>'
    const buffer = fakeSvg(svgPayload)
    const res = await analyzeImage({ buffer, headers: { 'content-type': 'image/svg+xml' }, finalUrl: 'u' }, 'u', makeCfg({ minBufferSize: 10 }))
    expect(res.isValid).toBe(true)
    expect(res.metadata.format.toLowerCase()).toBe('svg')
    expect(res.metadata.width === null || typeof res.metadata.width === 'undefined').toBe(true)
    expect(res.metadata.height === null || typeof res.metadata.height === 'undefined').toBe(true)
  })

  it('不在白名单的 content-type 且非 SVG 时返回 unsupported_content_type', async () => {
    const buffer = Buffer.alloc(200) // 非图片内容
    const res = await analyzeImage({ buffer, headers: { 'content-type': 'text/plain' }, finalUrl: 'u' }, 'u', makeCfg({ minBufferSize: 10 }))
    expect(res.isValid).toBe(false)
    expect(res.reason).toBe('unsupported_content_type')
  })
})



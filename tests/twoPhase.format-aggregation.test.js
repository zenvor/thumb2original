import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

// 模拟 fetchImage：根据 URL 后缀返回对应格式的 buffer 与 headers
vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    if (url.endsWith('.png')) {
      const buf = Buffer.alloc(256); buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
      return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
    }
    if (url.endsWith('.jpg')) {
      const buf = Buffer.alloc(256); buf[0] = 0xff; buf[1] = 0xd8; buf.write('JFIF', 2, 'utf8')
      return { buffer: buf, headers: { 'content-type': 'image/jpeg' }, finalUrl: url }
    }
    if (url.endsWith('.svg')) {
      const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
      return { buffer: buf, headers: { 'content-type': 'image/svg+xml' }, finalUrl: url }
    }
    throw new Error('unsupported test url')
  })
}))

// 模拟 analyzeImage：直接按 URL 后缀返回对应的 format，统一判定为有效
vi.mock('../lib/imageAnalyzer.js', () => ({
  analyzeImage: vi.fn(async (imageData, url) => {
    const ext = url.split('.').pop().toLowerCase()
    const fmt = ext === 'jpg' ? 'jpeg' : ext
    return { isValid: true, metadata: { format: fmt, width: 10, height: 10, size: imageData.buffer.length } }
  })
}))

// 说明：此用例不 mock fileManager，使用真实 saveImage() 以验证其按“最终落盘格式”统计

describe('twoPhase 混合格式聚合统计（无统一转换）', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_twoPhase_mix_out')
  const tempDir = path.join(process.cwd(), '.tmp_e2e_twoPhase_mix_tmp')
  const cfg = {
    concurrentDownloads: 3,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    outputDirectory: outDir,
    // 禁止统一格式转换，按原始格式落盘与统计
    format: { convertTo: 'none' },
    analysis: {
      mode: 'twoPhase',
      tempDir,
      cleanupTempOnStart: true,
      cleanupTempOnComplete: true,
      enableDetailLog: false,
      // 放宽最小 buffer 限制，避免对 SVG 文本等产生干扰
      minBufferSize: 1
    }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    await fs.mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('应累计为 PNG=1、JPEG=1、SVG=1', async () => {
    const urls = [
      'http://example.com/a.png',
      'http://example.com/b.jpg',
      'http://example.com/c.svg'
    ]

    const res = await processDownloadQueue(urls, outDir, { config: cfg }, /* downloadedImages */ undefined)

    expect(res).toBeTruthy()
    expect(res.formatCounts).toBeTruthy()

    // 断言混合格式累计
    expect(res.formatCounts.png || 0).toBe(1)
    expect(res.formatCounts.jpeg || 0).toBe(1) // 注意：jpg 归一化为 jpeg
    expect(res.formatCounts.svg || 0).toBe(1)

    // 基本sanity：应成功写出至少 3 个文件
    const files = await fs.readdir(outDir).catch(() => [])
    expect(files.length).toBeGreaterThanOrEqual(3)
  })
})

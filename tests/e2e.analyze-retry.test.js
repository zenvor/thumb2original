import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'
import { logger } from '../utils/logger.js'

// 通过调用次数模拟第一次过小、第二次有效
const callCount = new Map()

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    const c = (callCount.get(url) || 0) + 1
    callCount.set(url, c)
    if (url.includes('retry-small')) {
      if (c === 1) {
        return { buffer: Buffer.alloc(10), headers: { 'content-type': 'image/png' }, finalUrl: url }
      }
      const buf = Buffer.alloc(200); buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
      return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
    }
    const buf = Buffer.alloc(200); buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

vi.mock('../lib/fileManager.js', async () => {
  const actual = await vi.importActual('../lib/fileManager.js')
  return {
    ...actual,
    saveImage: vi.fn(async (...args) => {
      const stats = args[3]
      stats.successful++
    }),
    generateFileName: (url) => `${path.basename(url)}.png`
  }
})

// 监视 logger.header 以确认阶段日志输出
const headerSpy = vi.spyOn(logger, 'header')

describe('E2E - 分析失败可重试（content_too_small）', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_retry')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 2,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', minBufferSize: 50, enableDetailLog: false }
  }

  beforeEach(async () => {
    callCount.clear()
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    headerSpy.mockClear()
  })

  it('第一次分析 content_too_small 进入重试，第二次成功；统计应累计失败原因一次', async () => {
    const urls = ['http://retry-small']
    const context = { config: cfg }
    const res = await processDownloadQueue(urls, outDir, context, [])

    // 第一次失败（content_too_small）被记录一次；重试后成功写盘一次
    expect(res.analysisFailures.content_too_small).toBe(1)
    expect(callCount.get('http://retry-small')).toBeGreaterThanOrEqual(2)

    // 阶段日志至少包含一次“Analyzing images ...”
    expect(headerSpy).toHaveBeenCalled()
    const calledWithAnalyzing = headerSpy.mock.calls.some(c => String(c[0]).includes('Analyzing images'))
    expect(calledWithAnalyzing).toBe(true)
  })
})

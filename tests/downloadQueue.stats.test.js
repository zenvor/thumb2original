import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { processDownloadQueue } from '../lib/downloadQueue.js'

// mock fetchImage：制造一成功一失败（过小）
vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    if (url.includes('too-small')) return { buffer: Buffer.alloc(10), headers: {}, finalUrl: url }
    const buf = Buffer.alloc(200); buf[0]=0x89; buf.write('PNG',1,'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

// mock saveImage：不写盘，只计数
vi.mock('../lib/fileManager.js', async () => {
  const actual = await vi.importActual('../lib/fileManager.js')
  return {
    ...actual,
    saveImage: vi.fn(async (buffer, filePath, imageUrl, stats) => {
      stats.successful++
    }),
    generateFileName: (url) => `${path.basename(url)}.png`
  }
})

describe('downloadQueue stats aggregation', () => {
  it('应累计 analyzed 与 analysisFailures，并返回聚合结果', async () => {
    const urls = ['http://ok-1', 'http://too-small-2']
    const cfg = {
      concurrentDownloads: 2,
      minRequestDelayMs: 0,
      maxRequestDelayMs: 0,
      maxRetries: 0,
      retryDelayMs: 0,
      analysis: { preset: 'balanced', minBufferSize: 50 }
    }
    const context = { config: cfg }
    const res = await processDownloadQueue(urls, process.cwd(), context, [])
    expect(res.analyzed).toBe(2)
    expect(res.analysisFailures.content_too_small).toBe(1)
    expect(Array.isArray(res.analysisFailedUrls)).toBe(true)
  })
})



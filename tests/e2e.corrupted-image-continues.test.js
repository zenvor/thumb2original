import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { saveMock } = vi.hoisted(() => ({
  saveMock: vi.fn(async (buffer, filePath, imageUrl, stats) => {
    stats.successful++
    if (stats && stats.formatCounts) {
      stats.formatCounts.png = (stats.formatCounts.png || 0) + 1
    }
  })
}))

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    // 伪造 PNG 头，但内容损坏，迫使 metadata 解析失败
    const buf = Buffer.alloc(128)
    buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

vi.mock('../utils/imageUtils.js', async () => {
  const actual = await vi.importActual('../utils/imageUtils.js')
  return {
    ...actual,
    getImageMetadata: vi.fn(async () => {
      // 非超时/内存类错误：应被记录并继续，不视为失败
      throw new Error('metadata parse error: corrupted image data')
    })
  }
})

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('E2E - 损坏图片（元数据失败）仍应保存', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_corrupted_image')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', timeoutMs: 500, enableDetailLog: false }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的累加逻辑，导致 formatCounts 统计丢失。
    saveMock.mockClear()
  })

  it('metadata 异常但被放行并保存', async () => {
    const urls = ['http://img-corrupted']
    const res = await processDownloadQueue(urls, outDir, { config: cfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(res.analyzed).toBe(1)
    // 不应计入失败原因
    const failSum = Object.values(res.analysisFailures).reduce((a, b) => a + b, 0)
    expect(failSum).toBe(0)
    // 统计按落盘格式（PNG）
    expect(res.formatCounts.png || 0).toBe(1)
  })
})

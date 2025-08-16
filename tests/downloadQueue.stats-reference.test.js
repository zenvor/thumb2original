import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { saveMock, captured } = vi.hoisted(() => {
  const captured = { stats: null }
  return {
    captured,
    saveMock: vi.fn(async (buffer, filePath, imageUrl, stats) => {
      // 捕获传入 saveImage 的 stats 引用
      captured.stats = stats
      // 模拟成功保存与类型统计
      stats.successful++
      if (stats && stats.formatCounts) {
        stats.formatCounts.png = (stats.formatCounts.png || 0) + 1
      }
    })
  }
})

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    const buf = Buffer.alloc(256)
    buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    return {
      buffer: buf,
      headers: { 'content-type': 'image/png' },
      finalUrl: url
    }
  })
}))

vi.mock('../lib/imageAnalyzer.js', () => ({
  analyzeImage: vi.fn(async () => ({ isValid: true, metadata: { format: 'png', width: 10, height: 10, size: 256 } }))
}))

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('downloadQueue stats 引用一致性', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_stats_ref')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', enableDetailLog: false }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现
    saveMock.mockClear()
    captured.stats = null
  })

  it('saveImage 接收的 stats.formatCounts 与返回结果中的 formatCounts 引用相同，且累计可观测', async () => {
    const url = 'http://example.com/img.png'
    const res = await processDownloadQueue([url], outDir, { config: cfg }, [])

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(captured.stats).toBeTruthy()

    // 验证同一引用
    expect(captured.stats.formatCounts).toBe(res.formatCounts)

    // 验证累计可观测
    expect(res.analyzed).toBe(1)
    expect(Object.values(res.analysisFailures).reduce((a,b)=>a+b,0)).toBe(0)
    expect(res.formatCounts.png || 0).toBe(1)
  })
})

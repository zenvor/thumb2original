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
    const buf = Buffer.alloc(256)
    buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

vi.mock('../lib/imageAnalyzer.js', () => ({
  analyzeImage: vi.fn(async () => ({
    isValid: true,
    metadata: { format: 'png', width: 10, height: 10, size: 256, parseErrorContinue: true }
  }))
}))

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('downloadQueue observability（parseErrorContinue 计数）', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_obs_out')
  const urls = ['http://a', 'http://b', 'http://c']

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    saveMock.mockClear()
  })

  it('inline 路径应累计 metadata_parse_error_continue 并出现在返回对象', async () => {
    const cfg = {
      concurrentDownloads: 2,
      minRequestDelayMs: 0,
      maxRequestDelayMs: 0,
      maxRetries: 0,
      retryDelayMs: 0,
      outputDirectory: outDir,
      analysis: { preset: 'balanced', enableDetailLog: false }
    }
    const res = await processDownloadQueue(urls, outDir, { config: cfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(urls.length)
    expect(res.analysisObservations).toBeTruthy()
    expect(res.analysisObservations.metadata_parse_error_continue).toBe(urls.length)
  })

  it('twoPhase 路径也应累计 metadata_parse_error_continue 并出现在返回对象', async () => {
    const cfg = {
      concurrentDownloads: 3,
      minRequestDelayMs: 0,
      maxRequestDelayMs: 0,
      maxRetries: 0,
      retryDelayMs: 0,
      outputDirectory: outDir,
      analysis: {
        preset: 'balanced',
        enableDetailLog: false,
        mode: 'twoPhase',
        tempDir: path.join(process.cwd(), '.tmp_e2e_obs_temp'),
        cleanupTempOnStart: true,
        cleanupTempOnComplete: true
      }
    }
    const res = await processDownloadQueue(urls, outDir, { config: cfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(urls.length)
    expect(res.analysisObservations).toBeTruthy()
    expect(res.analysisObservations.metadata_parse_error_continue).toBe(urls.length)
  })
})

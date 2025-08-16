import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// hoisted mocks
const { writeFileMock, identifyMock, convertMock } = vi.hoisted(() => {
  return {
    writeFileMock: vi.fn(async () => {}),
    identifyMock: vi.fn(),
    convertMock: vi.fn()
  }
})

vi.mock('fs/promises', () => ({
  default: {
    writeFile: writeFileMock,
    mkdir: vi.fn(async () => {}),
    rm: vi.fn(async () => {})
  }
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    process: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    header: vi.fn(),
    progress: vi.fn(),
    categories: { DOWNLOAD: 'download', NETWORK: 'network', SYSTEM: 'system' }
  }
}))

vi.mock('../utils/htmlMemoryManager.js', () => ({
  htmlMemoryManager: {
    generateImageInfo: vi.fn(async () => ({ url: '', name: '', storagePath: '' })),
    appendImageInfo: vi.fn(async () => {})
  }
}))

vi.mock('../utils/imageUtils.js', () => ({
  identifyImageFormat: identifyMock,
  convertWebpToPng: vi.fn(),
  getFileNameFromUrl: vi.fn(() => 'name.jpg'),
  SUPPORTED_FORMATS: ['png','jpeg','webp','svg'],
  convertImageFormat: convertMock
}))

// 注意：在 mocks 之后再导入被测函数
import { saveImage } from '../lib/fileManager.js'

function makeJpegBuffer() {
  const buf = Buffer.alloc(10)
  buf[0] = 0xff; buf[1] = 0xd8 // JPEG SOI
  return buf
}

function makePngBuffer() {
  const buf = Buffer.alloc(10)
  buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
  return buf
}

describe('saveImage 最终格式计数（按落盘格式）', () => {
  beforeEach(() => {
    writeFileMock.mockClear()
    identifyMock.mockReset()
    convertMock.mockReset()
  })

  it('默认启用转换：JPEG -> PNG，统计应计入 png', async () => {
    // 原始 JPEG
    const input = makeJpegBuffer()
    // identify: 统计阶段应识别为 png（saveImage 会优先用 analysisResult.metadata 识别原始格式，
    // 此处只需保证最终一次对 finalBuffer 的识别为 png）
    identifyMock.mockReturnValue('png')

    // 模拟转换
    const converted = makePngBuffer()
    convertMock.mockResolvedValue(converted)

    const stats = { total: 1, successful: 0, failed: 0, failedUrls: [], formatCounts: Object.create(null) }
    const filePath = path.join(process.cwd(), 'out', 'name.jpg')
    const config = { /* 使用默认 enableConversion=true, convertTo='png' */ }

    await saveImage(input, filePath, 'http://x/img.jpg', stats, null, config, { isValid: true, metadata: { format: 'jpeg', size: 10 } })

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    // 应按最终格式 png 计数
    expect(stats.formatCounts.png || 0).toBe(1)
    expect(stats.formatCounts.jpeg || 0).toBe(0)
    expect(stats.successful).toBe(1)
  })

  it('禁用转换：保持 JPEG，统计应计入 jpeg', async () => {
    const input = makeJpegBuffer()
    // identify 最终仍为 jpeg
    identifyMock
      .mockReturnValueOnce('jpeg') // original
      .mockReturnValueOnce('jpeg') // final

    convertMock.mockResolvedValue(null) // 不会被调用，但保持安全

    const stats = { total: 1, successful: 0, failed: 0, failedUrls: [], formatCounts: Object.create(null) }
    const filePath = path.join(process.cwd(), 'out', 'name.jpg')
    const config = { format: { convertTo: 'none' } }

    await saveImage(input, filePath, 'http://x/img.jpg', stats, null, config, { isValid: true, metadata: { format: 'jpeg', size: 10 } })

    expect(writeFileMock).toHaveBeenCalledTimes(1)
    expect(stats.formatCounts.jpeg || 0).toBe(1)
    expect(stats.formatCounts.png || 0).toBe(0)
    expect(stats.successful).toBe(1)
  })
})

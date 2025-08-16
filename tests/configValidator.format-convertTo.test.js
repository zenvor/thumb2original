import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock fs/promises 提前定义，避免实际文件系统操作与噪音日志
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => {}),
    access: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ isDirectory: () => true }))
  }
}))

// mock logger，便于断言 warn/info
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    process: vi.fn(),
    success: vi.fn(),
    header: vi.fn(),
    progress: vi.fn(),
    categories: { SYSTEM: 'system', NETWORK: 'network', DOWNLOAD: 'download' }
  }
}))

// 被测模块
import { validateAndNormalizeConfig } from '../lib/configValidator.js'
import { logger } from '../utils/logger.js'

describe('configValidator: format.convertTo 校验与一次性提示', () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  it('非法 convertTo 值应回退为 none，并输出 warn', async () => {
    const raw = { format: { enableConversion: true, convertTo: 'jpg' } }
    const cfg = await validateAndNormalizeConfig(raw)

    expect(cfg.format.convertTo).toBe('none')
    // 至少一次 warn，且包含关键字
    const warnCalls = logger.warn.mock.calls.map(args => String(args[0] || ''))
    expect(warnCalls.some(m => m.includes('format.convertTo 非法值'))).toBe(true)
  })

  it('启用转换且 convertTo!=none 时，SVG/AVIF 仅识别不转换提示仅打印一次（同一进程内）', async () => {
    logger.info.mockClear()

    const raw1 = { format: { enableConversion: true, convertTo: 'png' } }
    const raw2 = { format: { enableConversion: true, convertTo: 'png' } }

    await validateAndNormalizeConfig(raw1)
    await validateAndNormalizeConfig(raw2)

    const infoMsgs = logger.info.mock.calls.map(args => String(args[0] || ''))
    const matched = infoMsgs.filter(m => m.includes('SVG/AVIF 当前仅用于识别与统计'))
    expect(matched.length).toBe(1)
  })
})

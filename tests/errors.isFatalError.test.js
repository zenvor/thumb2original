import { describe, it, expect } from 'vitest'

import { isFatalError } from '../utils/errors.js'

describe('isFatalError 安全性', () => {
  it('缺少 message 字段时返回 false', () => {
    expect(isFatalError({})).toBe(false)
  })

  it('检测连接断开关键字时返回 true', () => {
    expect(isFatalError({ message: 'Protocol error: Connection closed unexpectedly' })).toBe(true)
  })
})

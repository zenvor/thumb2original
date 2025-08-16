import { describe, it, expect } from 'vitest'
import { shouldAcceptResponse, ALLOWED_BINARY_DEFAULT } from '../utils/contentPolicy.js'

function headers(ct, extra = {}) {
  const base = {}
  if (ct !== undefined) base['content-type'] = ct
  return { ...base, ...extra }
}

describe('shouldAcceptResponse - 基本规则', () => {
  it('拒绝 text/html（即使 accept=true）', () => {
    expect(shouldAcceptResponse(headers('text/html'), true)).toBe(false)
    expect(shouldAcceptResponse(headers('text/html'), ['application/octet-stream', ''])).toBe(false)
  })

  it('允许 image/*', () => {
    expect(shouldAcceptResponse(headers('image/jpeg'), false)).toBe(true)
    expect(shouldAcceptResponse(headers('image/png'), [])).toBe(true)
  })

  it('允许 Content-Disposition: attachment（无 content-type）', () => {
    expect(shouldAcceptResponse(headers(undefined, { 'content-disposition': 'attachment; filename="a.bin"' }), false)).toBe(true)
  })

  it('text/html + attachment 仍拒绝（优先拒绝 HTML）', () => {
    expect(shouldAcceptResponse(headers('text/html', { 'content-disposition': 'attachment' }), true)).toBe(false)
  })
})

describe('shouldAcceptResponse - acceptBinaryContentTypes=true（放宽）', () => {
  it('缺失 content-type 时放行', () => {
    expect(shouldAcceptResponse(headers(undefined), true)).toBe(true)
  })
  it('内置二进制白名单放行', () => {
    for (const ct of ALLOWED_BINARY_DEFAULT) {
      expect(shouldAcceptResponse(headers(ct), true)).toBe(true)
    }
  })
  it('带分号参数的 content-type 仍放行（true 模式 + 默认白名单）', () => {
    expect(shouldAcceptResponse(headers('application/octet-stream; charset=binary'), true)).toBe(true)
  })
})

describe("shouldAcceptResponse - acceptBinaryContentTypes=['...']（数组模式）", () => {
  it("缺失 content-type，但数组包含 '' 时放行", () => {
    expect(shouldAcceptResponse(headers(undefined), [''])).toBe(true)
  })
  it("缺失 content-type，数组不含 '' 时拒绝", () => {
    expect(shouldAcceptResponse(headers(undefined), ['application/octet-stream'])).toBe(false)
  })
  it('仅允许列出的类型', () => {
    expect(shouldAcceptResponse(headers('application/octet-stream'), ['application/octet-stream'])).toBe(true)
    expect(shouldAcceptResponse(headers('application/binary'), ['application/octet-stream'])).toBe(false)
  })
  it('大小写不敏感', () => {
    expect(shouldAcceptResponse(headers('Application/Octet-Stream'), ['application/octet-stream'])).toBe(true)
  })
  it('带参数时匹配主类型（数组模式）', () => {
    expect(shouldAcceptResponse(headers('application/octet-stream; charset=binary'), ['application/octet-stream'])).toBe(true)
  })
})

describe('shouldAcceptResponse - acceptBinaryContentTypes=false/未设置（严格）', () => {
  it('仅允许 image/*', () => {
    expect(shouldAcceptResponse(headers('image/webp'), false)).toBe(true)
    expect(shouldAcceptResponse(headers('application/octet-stream'), false)).toBe(false)
    expect(shouldAcceptResponse(headers(undefined), false)).toBe(false)
  })
})

import { describe, it, expect, vi } from 'vitest'
import * as axiosMod from 'axios'
import { axiosFetchOnce } from '../../lib/fetcher/axiosFetcher.js'

vi.mock('axios')

describe('axiosFetcher P1 acceptBinaryContentTypes', () => {
  it('允许缺失 content-type（acceptBinaryContentTypes=true）', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('abc'), headers: {} })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: true })
    expect(res).not.toBeNull()
  })

  it('允许 application/octet-stream', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('abc'), headers: { 'content-type': 'application/octet-stream' } })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: true })
    expect(res).not.toBeNull()
  })

  it('拒绝 text/html（回退）', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('<html/>'), headers: { 'content-type': 'text/html' } })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: true })
    expect(res).toBeNull()
  })

  it('当 acceptBinaryContentTypes=false 时：拒绝 application/octet-stream', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('abc'), headers: { 'content-type': 'application/octet-stream' } })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: false })
    expect(res).toBeNull()
  })

  it('当 acceptBinaryContentTypes=false 时：拒绝缺失 content-type', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('abc'), headers: {} })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: false })
    expect(res).toBeNull()
  })

  it('当 acceptBinaryContentTypes 为数组时：包含 application/octet-stream 则放行', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('abc'), headers: { 'content-type': 'application/octet-stream' } })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: ['application/octet-stream'] })
    expect(res).not.toBeNull()
  })

  it('当 acceptBinaryContentTypes 为数组时：包含空字符串允许缺失 content-type', async () => {
    axiosMod.default.mockResolvedValue({ data: Buffer.from('abc'), headers: {} })
    const res = await axiosFetchOnce('http://x', {}, 1000, { acceptBinaryContentTypes: [''] })
    expect(res).not.toBeNull()
  })
})





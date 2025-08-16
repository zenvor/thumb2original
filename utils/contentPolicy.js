// 统一的响应可接受性判定策略（访问阶段与分析阶段共享）
// - 拒绝 text/html（访问阶段需回退到 HTML 解析）
// - 允许 image/*
// - 允许 Content-Disposition: attachment
// - 放宽二进制与缺失 content-type：由 acceptBinaryContentTypes 控制
//    * true: 允许缺失 content-type，且允许内置二进制白名单
//    * string[]: 允许列表内的类型；若包含空串 ''，则允许缺失 content-type
//    * false/未设置: 仅允许 image/*

/**
 * @typedef {boolean | string[]} AcceptBinaryContentTypes
 * - true: 放宽规则，允许缺失 Content-Type，且允许内置二进制白名单
 * - string[]: 自定义允许列表（大小写不敏感）；若包含空串 '' 则允许缺失 Content-Type
 * - false/undefined: 严格模式，仅允许 image/*（及不涉及 HTML 的 attachment 情况）
 */

export const ALLOWED_BINARY_DEFAULT = [
  'application/octet-stream',
  'application/binary',
  'application/x-binary',
  'application/x-octet-stream',
  'binary/octet-stream'
]

/**
 * 判定给定响应头是否可被接受为图片/二进制内容（访问/分析阶段统一使用）。
 * - 拒绝 text/html（访问阶段回退到 HTML 解析；分析阶段不应出现）
 * - 允许 image/*
 * - 允许 Content-Disposition: attachment（但不会覆盖 text/html 的拒绝）
 * - 放宽策略由 acceptBinaryContentTypes 决定（见 typedef）
 * @param {Record<string, any>} headers 响应头（将读取 content-type 与 content-disposition，大小写不敏感）
 * @param {AcceptBinaryContentTypes} acceptBinaryContentTypes 配置项
 * @returns {boolean} 是否允许该响应体被接受
 */
export function shouldAcceptResponse(headers = {}, acceptBinaryContentTypes) {
  try {
    const ct = (headers['content-type'] || headers['Content-Type'] || '').toString().toLowerCase()
    const cd = (headers['content-disposition'] || headers['Content-Disposition'] || '').toString().toLowerCase()
    const hasCT = !!ct
    const ctBare = hasCT ? ct.split(';')[0].trim() : ''

    if (hasCT && ctBare.includes('text/html')) return false
    if (cd.includes('attachment')) return true
    if (hasCT && ctBare.startsWith('image/')) return true

    if (acceptBinaryContentTypes === true) {
      if (!hasCT) return true
      return ALLOWED_BINARY_DEFAULT.includes(ctBare)
    }

    if (Array.isArray(acceptBinaryContentTypes)) {
      const list = acceptBinaryContentTypes.map(s => String(s).toLowerCase().trim())
      if (!hasCT && list.includes('')) return true
      if (!hasCT) return false
      const allowedSet = new Set(list)
      return allowedSet.has(ctBare)
    }

    // false/undefined/非法 → 严格模式
    return false
  } catch {
    // headers 异常：访问阶段保守拒绝；分析阶段会有嗅探兜底
    return false
  }
}

/**
 * 解析图片链接
 * @param {string} webUrl
 * @returns
 */
export function parseUrl(webUrl) {
  try {
    // 使用URL对象来解析链接
    const url = new URL(webUrl)

    // 获取协议、域名和路径
    const protocol = url.protocol
    const domain = url.host
    const path = url.pathname

    // 从路径中提取文件名
    const fileName = path.split('/').pop()

    // 从文件名中提取文件扩展名
    const fileExtension = fileName.split('.').pop()

    return {
      protocol,
      domain,
      fileExtension,
      protocolAndDomain: `${protocol}//${domain}`
    }
  } catch (error) {
    // 如果解析失败，返回错误信息
    console.error('解析图片链接失败: ' + error.message)
  }
}

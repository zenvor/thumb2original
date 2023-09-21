/**
 * 生成正则表达式
 * @param {string} protocol
 * @param {string} domain
 * @param {string} fileExtension
 * @returns
 */
export function generateRegex(protocol, domain, fileExtension) {
  // 使用传入的协议、域名和文件扩展名来生成正则表达式
  // 参考 https:\/\/baidu\.to\/[\w/-]+\.jpg/g
  const regexPattern = new RegExp(`${protocol}\/\/${domain}\/[\\w/-]+\\.${fileExtension}`, 'g')
  return regexPattern
}

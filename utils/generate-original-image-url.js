/**
 * 根据缩略图链接获取原图链接
 * @param {string} thumbnailUrl
 * @returns
 */

export function generateOriginalImageUrl(thumbnailUrl) {
  if (thumbnailUrl.includes('https://i.pximg.net')) {
    // 对于网站 "https://i.pximg.net"
    // 去掉缩略图链接中的`c/250x250_80_a2/`
    let originalUrl = thumbnailUrl.replace(/c\/250x250_80_a2\//, '')
    // 把缩略图链接中的`img-master`替换成`img-original`
    originalUrl = originalUrl.replace(/img-master/, 'img-original')
    originalUrl = originalUrl.replace(/custom-thumb/, 'img-original')
    // 去掉缩略图链接中的文件名后缀`_custom1200.jpg`或者`_square1200.jpg`
    originalUrl = originalUrl.replace(/_custom1200\.jpg|_square1200\.jpg/, '.jpg')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://i001.imx.to')) {
    // 对于网站 "https://i001.imx.to"
    // 将"/t/"替换为"/i/"
    return thumbnailUrl.replace('/t/', '/i/')
  } else if (thumbnailUrl.includes('https://i8.vipr.im')) {
    // 对于网站 "https://i8.vipr.im"
    // 将"/th/"替换为"/i/"
    return thumbnailUrl.replace('/th/', '/i/')
  } else if (thumbnailUrl.includes('https://boobsphoto.name')) {
    const urlRegex = /https:\/\/boobsphoto\.name\/uploads\/posts\/.*\.jpg/g
    const match = thumbnailUrl.match(urlRegex)
    return match[0]
  } else {
    // 如果是其他网站，返回原始链接
    return thumbnailUrl
  }
}

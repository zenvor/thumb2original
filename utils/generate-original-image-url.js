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
  } else if (thumbnailUrl.includes('https://c-ssl.dtstatic.com')) {
    // 把缩略图链接中的`dtstatic.com`替换成`duitang.com`
    let originalUrl = thumbnailUrl.replace('dtstatic.com', 'duitang.com')
    // 去掉缩略图链接中的`.thumb.400_0`
    originalUrl = originalUrl.replace('.thumb.400_0', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://thumbs2.imgbox.com')) {
    // 把缩略图链接中的`thumbs2`替换成`images2`
    let originalUrl = thumbnailUrl.replace('thumbs2', 'images2')
    // 把缩略图链接中的`_t`替换成`_o`
    originalUrl = originalUrl.replace('_t', '_o')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://static-ca-cdn.eporner.com')) {
    // 去掉缩略图链接中的`_296x1000`
    let originalUrl = thumbnailUrl.replace('_296x1000', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('userapi.com')) {
    let originalUrl = thumbnailUrl
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdn.pichunter.com')) {
    // 把缩略图链接中的`_i`替换成`_o`
    let originalUrl = thumbnailUrl.replace('_i', '_o')
    // 返回原图链接
    return originalUrl
  } else if (
    thumbnailUrl.includes('https://cdn.elitebabes.com') ||
    thumbnailUrl.includes('https://cdn.femjoyhunter.com') ||
    thumbnailUrl.includes('https://cdn.pmatehunter.com')
  ) {
    // 去掉缩略图链接中的`_w800`
    let originalUrl = thumbnailUrl.replace('_w400', '')
    // 返回原图链接
    return originalUrl
  } else {
    // 如果是其他网站，返回原始链接
    return thumbnailUrl
  }
}

/**
 * 根据缩略图链接获取原图链接
 * @param {string} thumbnailUrl
 * @returns
 */

export function generateOriginalImageUrl(thumbnailUrl, type) {
  if (thumbnailUrl.includes('https://i.pximg.net')) {
    // 去掉缩略图链接中的`c/250x250_80_a2/`
    let originalUrl = thumbnailUrl.replace(/c\/250x250_80_a2\//, '')
    // 把缩略图链接中的`img-master`替换成`img-original`
    originalUrl = originalUrl.replace(/img-master/, 'img-original')
    originalUrl = originalUrl.replace(/custom-thumb/, 'img-original')
    // 去掉缩略图链接中的文件名后缀`_custom1200.jpg`或者`_square1200.jpg`
    originalUrl = originalUrl.replace(/_custom1200\.jpg|_square1200\.jpg/, '.jpg')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('imx.to')) {
    // 将"/t/"替换为"/i/"
    if (!thumbnailUrl.includes('/t/')) return ''
    return thumbnailUrl.replace('/t/', '/i/')
  } else if (thumbnailUrl.includes('i8.vipr.im')) {
    if (!thumbnailUrl.includes('/th/')) return ''
    // 将"/th/"替换为"/i/"
    let originalUrl = thumbnailUrl.replace('/th/', '/i/')
    // originalUrl = originalUrl.replace('.jpg', '.jpeg')
    return originalUrl
  } else if (thumbnailUrl.includes('https://c-ssl.dtstatic.com')) {
    // 把缩略图链接中的`dtstatic.com`替换成`duitang.com`
    let originalUrl = thumbnailUrl.replace('dtstatic.com', 'duitang.com')
    // 去掉缩略图链接中的`.thumb.400_0`
    originalUrl = originalUrl.replace('.thumb.400_0', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://thumbs2.imgbox.com')) {
    if (!thumbnailUrl.includes('thumbs2')) return ''
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
    if (!thumbnailUrl.includes('_w400')) return ''
    // 去掉缩略图链接中的`_w800`
    let originalUrl = thumbnailUrl.replace('_w400', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('http://i.girlsfordays.com')) {
    // 去掉缩略图链接中的`/thumbnails`
    let originalUrl = thumbnailUrl.replace('/thumbnails', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://images.sexynude.pics')) {
    // 去掉缩略图链接中的`/thumbs`
    let originalUrl = thumbnailUrl.replace('/thumbs', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdn.cherrynudes.com')) {
    // 去掉缩略图链接中的`-410x410`
    let originalUrl = thumbnailUrl.replace('-410x410', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://thefapspot.com')) {
    // 去掉缩略图链接中的`-150x150`
    let originalUrl = thumbnailUrl.replace('-150x150', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdni.sexynakedgirls.pics')) {
    // 把缩略图链接中的`/460`替换成`/1280`
    let originalUrl = thumbnailUrl.replace('/460', '/1280')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://static-ca-cdn.eporner.com')) {
    // 去掉缩略图链接中的`_296x1000`
    let originalUrl = thumbnailUrl.replace('_296x1000', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdn.erocurves.com')) {
    if (!thumbnailUrl.includes('-172x262')) return ''
    // 去掉缩略图链接中的`-172x262`
    let originalUrl = thumbnailUrl.replace('-172x262', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdn.perfectnaked.com')) {
    if (!thumbnailUrl.includes('-200x270')) return ''
    // 去掉缩略图链接中的`-172x262`
    let originalUrl = thumbnailUrl.replace('-200x270', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://www.ametart.com')) {
    if (!thumbnailUrl.includes('/thumbs') && !thumbnailUrl.includes('/280x_01')) return ''
    // 把缩略图链接中的`/thumbs`替换成`/photos`
    let originalUrl = thumbnailUrl.replace('/thumbs', '/photos')
    // 把缩略图链接中的`/280x_01`替换成`/01`
    originalUrl = thumbnailUrl.replace('/280x_01', '/01')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdn.metarthunter.com')) {
    if (!thumbnailUrl.includes('_w400')) return ''
    // 把缩略图链接中的`_w400`替换成`_1200`
    let originalUrl = thumbnailUrl.replace('_w400', '')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://data-cdn.multi.xnxx.com')) {
    if (!thumbnailUrl.includes('/new_small')) return ''
    // 把缩略图链接中的`/new_small`替换成`/full`
    let originalUrl = thumbnailUrl.replace('/new_small', '/full')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://erohd.club')) {
    if (!thumbnailUrl.includes('/img_cache/img_cache_garden-bed_matty')) return ''
    // 把缩略图链接中的`/img_cache/img_cache_garden-bed_matty`替换成`//Garden-Bed_Matty`
    let originalUrl = thumbnailUrl.replace('/img_cache/img_cache_garden-bed_matty', '//Garden-Bed_Matty')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://img119.imagetwist.com')) {
    if (!thumbnailUrl.includes('/th')) return ''
    // 把缩略图链接中的`/th`替换成`/i`
    let originalUrl = thumbnailUrl.replace('/th', '/i')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://chpic.su')) {
    if (!thumbnailUrl.includes('_data')) return ''

    const slashStringIndex = thumbnailUrl.lastIndexOf('/')
    let path = thumbnailUrl.substring(0, slashStringIndex)
    let fileName = thumbnailUrl.substring(slashStringIndex)
    let underlinedIndex = fileName.lastIndexOf('_')
    fileName = fileName.substring(0, underlinedIndex) + fileName.substring(underlinedIndex).replace('_', '@@')
    console.log('fileName: ', fileName)
    fileName = fileName.replace(/\/.*?@@/, '/')
    thumbnailUrl = path + fileName
    // 把缩略图链接中的`/_data`替换成`/save2/ru`
    let originalUrl = thumbnailUrl.replace(/\/_data\b/, '/save2/ru')
    // 使用正则表达式替换
    originalUrl = originalUrl.replace(/\/stickers\/[a-z]\//i, '/stickers/')
    // 使用正则表达式替换
    originalUrl = originalUrl.replace(/\.webp[^/]*/, `/f=webp_c=png_bg=${type}`)
    // originalUrl = originalUrl.replace(/\.webp[^/]*/, '/f=webp_c=png_bg=white')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://x3vid.com')) {
    if (!thumbnailUrl.includes('/thumbs/')) return ''
    let originalUrl = thumbnailUrl.replace('/thumbs/', '/images/')
    if (thumbnailUrl.includes('/ept')) originalUrl = originalUrl.replace('/ept', '/ep2')
    if (thumbnailUrl.includes('__ept')) originalUrl = originalUrl.replace('__ept', '__ep5')
    originalUrl = originalUrl.replace('_160', '_1000')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('https://cdni.pornpics.com')) {
    if (!thumbnailUrl.includes('/460/')) return ''
    let originalUrl = thumbnailUrl.replace('/460/', '/1280/')
    // 返回原图链接
    return originalUrl
  } else if (thumbnailUrl.includes('http://asiantgp.net')) {
    if (!thumbnailUrl.includes('tn_')) return ''
    let originalUrl = thumbnailUrl.replace('tn_', '')
    // 返回原图链接
    return originalUrl
  } 
  else if (thumbnailUrl.includes('https://www.sigmapic.com')) {
    if (!thumbnailUrl.includes('/7_t')) return ''
    let originalUrl = thumbnailUrl.replace('/7_t', '/7_553')
    return originalUrl
  } 
  else if (thumbnailUrl.includes('pixhost.to')) {
    if (!thumbnailUrl.includes('/thumbs')) return ''
    let originalUrl = thumbnailUrl.replace('/thumbs', '/images')
    originalUrl = thumbnailUrl.replace('//t', '//img')
    return originalUrl
  } 
  else {
    // 如果是其他网站，返回原始链接
    return ''
  }
}
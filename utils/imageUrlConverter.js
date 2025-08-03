/**
 * @fileoverview
 * 该模块提供将缩略图 URL 转换为其原始高分辨率版本的功能，适用于各种图片托管网站。
 * 它采用策略模式，其中每个特定于网站的转换逻辑都封装在一个“转换器”对象中。
 * 这种设计使得在不改变主函数的情况下，可以轻松地为不同站点添加、删除或修改转换逻辑。
 */

/**
 * 一个转换器策略数组。每个转换器包含：
 * - name: 转换器的描述性名称（例如，网站域名）。
 * - shouldApply: 一个函数，接收一个 URL 并返回 true（如果此转换器可以处理该 URL）。
 * - convert: 一个函数，接收缩略图 URL 并将其转换为原始 URL。
 */
const converters = [
  {
    name: 'pximg.net',
    shouldApply: (url) => url.includes('https://i.pximg.net'),
    convert: (url) => {
      return url
        .replace(/c\/250x250_80_a2\//, '')
        .replace(/img-master|custom-thumb/, 'img-original')
        .replace(/_custom1200\.jpg|_square1200\.jpg/, '.jpg')
    },
  },
  {
    name: 'imx.to',
    shouldApply: (url) => url.includes('imx.to') && url.includes('/t/'),
    convert: (url) => url.replace('/t/', '/i/'),
  },
  {
    name: 'imx.to/upload/small',
    shouldApply: (url) => url.includes('imx.to/upload/small/'),
    convert: (url) => url.replace('imx.to/upload/small/', 'i001.imx.to/i/'),
  },
  {
    name: 'vipr.im',
    shouldApply: (url) => url.includes('vipr.im') && url.includes('/th/'),
    convert: (url) => url.replace('/th/', '/i/'),
  },
  {
    name: 'imgbox.com',
    shouldApply: (url) => url.includes('https://thumbs2.imgbox.com'),
    convert: (url) => url.replace('thumbs2', 'images2').replace('_t', '_o'),
  },
  {
    name: 'static-ca-cdn.eporner.com',
    shouldApply: (url) => url.includes('https://static-ca-cdn.eporner.com'),
    convert: (url) => url.replace('_296x1000', ''),
  },
  {
    name: 'userapi.com',
    shouldApply: (url) => url.includes('userapi.com'),
    convert: (url) => url, // 返回原始 URL
  },
  {
    name: 'cdn.pichunter.com',
    shouldApply: (url) => url.includes('https://cdn.pichunter.com'),
    convert: (url) => url.replace('_i', '_o'),
  },
  {
    name: 'various cdn sites',
    shouldApply: (url) =>
      (url.includes('https://cdn.elitebabes.com') ||
        url.includes('https://cdn.femjoyhunter.com') ||
        url.includes('https://cdn.pmatehunter.com')) &&
      url.includes('_w400'),
    convert: (url) => url.replace('_w400', ''),
  },
  {
    name: 'i.girlsfordays.com',
    shouldApply: (url) => url.includes('http://i.girlsfordays.com'),
    convert: (url) => url.replace('/thumbnails', ''),
  },
  {
    name: 'images.sexynude.pics',
    shouldApply: (url) => url.includes('https://images.sexynude.pics'),
    convert: (url) => url.replace('/thumbs', ''),
  },
  {
    name: 'cdn.cherrynudes.com',
    shouldApply: (url) => url.includes('https://cdn.cherrynudes.com'),
    convert: (url) => url.replace('-410x410', ''),
  },
  {
    name: 'thefapspot.com',
    shouldApply: (url) => url.includes('https://thefapspot.com'),
    convert: (url) => url.replace('-150x150', ''),
  },
  {
    name: 'cdni.sexynakedgirls.pics',
    shouldApply: (url) => url.includes('https://cdni.sexynakedgirls.pics'),
    convert: (url) => url.replace('/460', '/1280'),
  },
  {
    name: 'cdn.erocurves.com',
    shouldApply: (url) => url.includes('https://cdn.erocurves.com') && url.includes('-172x262'),
    convert: (url) => url.replace('-172x262', ''),
  },
  {
    name: 'cdn.perfectnaked.com',
    shouldApply: (url) => url.includes('https://cdn.perfectnaked.com') && url.includes('-200x270'),
    convert: (url) => url.replace('-200x270', ''),
  },
  {
    name: 'www.ametart.com',
    shouldApply: (url) =>
      url.includes('https://www.ametart.com') && (url.includes('/thumbs') || url.includes('/280x_01')),
    convert: (url) => url.replace('/thumbs', '/photos').replace('/280x_01', '/01'),
  },
  {
    name: 'cdn.metarthunter.com',
    shouldApply: (url) => url.includes('https://cdn.metarthunter.com') && url.includes('_w400'),
    convert: (url) => url.replace('_w400', ''), // 注意：注释中说的是 _1200，但代码是空字符串。以代码为准。
  },
  {
    name: 'data-cdn.multi.xnxx.com',
    shouldApply: (url) => url.includes('https://data-cdn.multi.xnxx.com') && url.includes('/new_small'),
    convert: (url) => url.replace('/new_small', '/full'),
  },
  {
    name: 'erohd.club',
    shouldApply: (url) => url.includes('https://erohd.club') && url.includes('/img_cache/img_cache_garden-bed_matty'),
    convert: (url) => url.replace('/img_cache/img_cache_garden-bed_matty', '//Garden-Bed_Matty'),
  },
  {
    name: 'img119.imagetwist.com',
    shouldApply: (url) => url.includes('https://img119.imagetwist.com') && url.includes('/th'),
    convert: (url) => url.replace('/th', '/i'),
  },
  {
    name: 'chpic.su',
    shouldApply: (url) => url.includes('chpic.su') && url.includes('/stickers/'),
    convert: (url, type) => {
      let originalUrl = url.split('?')[0]

      const regex = /\/([^/]+)\/[^/]+\.webp$/
      const match = regex.exec(originalUrl)

      if (match) {
        const extractedPart = match[1]
        originalUrl = originalUrl.replace(`/${extractedPart}_`, '/')
      }

      originalUrl = originalUrl
        .replace('/_data', '')
        .replace(/\/stickers\/[a-z]\/+/, '/save2/ru/stickers/')
        .replace('data.chpic.su', 'chpic.su')
        .replace(/\.webp[^/]*/, `/f=webp_c=png_bg=${type}`)

      return `${originalUrl}?type=${type}`
    },
  },
  {
    name: 'c-ssl.dtstatic.com',
    shouldApply: (url) => url.includes('https://c-ssl.dtstatic.com'),
    convert: (url) => url.replace('dtstatic.com', 'duitang.com').replace('.thumb.400_0', ''),
  },
  {
    name: 'x3vid.com',
    shouldApply: (url) => url.includes('https://x3vid.com') && url.includes('/thumbs/'),
    convert: (url) => {
      let originalUrl = url.replace('/thumbs/', '/images/')
      if (url.includes('/ept')) originalUrl = originalUrl.replace('/ept', '/ep2')
      if (url.includes('__ept')) originalUrl = originalUrl.replace('__ept', '__ep5')
      originalUrl = originalUrl.replace('_160', '_1000')
      return originalUrl
    },
  },
  {
    name: 'cdni.pornpics.com',
    shouldApply: (url) => url.includes('https://cdni.pornpics.com') && url.includes('/460/'),
    convert: (url) => url.replace('/460/', '/1280/'),
  },
  {
    name: 'asiantgp.net',
    shouldApply: (url) => url.includes('http://asiantgp.net') && url.includes('tn_'),
    convert: (url) => url.replace('tn_', ''),
  },
  {
    name: 'www.sigmapic.com',
    shouldApply: (url) => url.includes('https://www.sigmapic.com') && url.includes('/7_t'),
    convert: (url) => url.replace('/7_t', '/7_553'),
  },
  {
    name: 'pixhost.to',
    shouldApply: (url) => url.includes('pixhost.to') && url.includes('/thumbs'),
    convert: (url) => {
      // 修正了原始实现中替换操作未被链接的潜在错误。
      return url.replace('/thumbs', '/images').replace('//t', '//img')
    },
  },
  {
    name: 'bravoerotica.com',
    shouldApply: (url) => url.includes('bravoerotica.com') && url.includes('/hegre'),
    convert: (url) => {
      return url.replace(/\/([^/]*)$/, (match, p1) => {
        return '/' + p1.replace(/t/g, '')
      })
    },
  },
]

/**
 * 通过应用匹配的策略，将缩略图 URL 转换为其原始图片 URL。
 * 它会遍历预定义的转换器列表，并使用第一个匹配 URL 的转换器。
 *
 * @param {string} thumbnailUrl 缩略图的 URL。
 * @param {string} [type] 某些转换器（如 'chpic.su'）使用的可选参数。
 * @returns {string} 原始图片 URL，如果未找到匹配的转换器，则返回空字符串。
 */
export function convertThumbnailToOriginalUrl(thumbnailUrl, type) {
  const converter = converters.find((c) => c.shouldApply(thumbnailUrl))

  if (converter) {
    return converter.convert(thumbnailUrl, type)
  }

  // 如果未找到转换器，则返回空字符串，以保持原始行为。
  return ''
}

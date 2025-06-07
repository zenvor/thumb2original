/**
 * 根据缩略图链接获取原图链接
 * @param {string} thumbnailUrl 缩略图的完整 URL
 * @param {string} [type]        仅在 chpic.su 场景下使用，指定格式类型
 * @returns {string}             原图 URL，若无匹配规则则返回空字符串
 */
export function generateOriginalImageUrl(thumbnailUrl, type) {
  if (typeof thumbnailUrl !== 'string' || thumbnailUrl.trim() === '') {
    return ''
  }

  let parsed
  try {
    parsed = new URL(thumbnailUrl)
  } catch {
    return ''
  }

  const { hostname, pathname, href } = parsed

  /**
   * 连续对字符串执行一系列替换函数
   * @param {string} input      原始字符串
   * @param {Array<function(string): string>} fns  一系列替换函数
   * @returns {string}          依次执行后的最终字符串
   */
  function batchReplace(input, fns) {
    return fns.reduce((prev, fn) => {
      const next = fn(prev)
      return next === '' ? '' : next
    }, input)
  }

  // 定义每个域名对应的规则列表
  const rules = [
    {
      test: (h) => h === 'i.pximg.net',
      transforms: [
        (url) =>
          batchReplace(url, [
            (str) => str.replace(/c\/250x250_80_a2\//g, ''),
            (str) => str.replace(/img-master/g, 'img-original'),
            (str) => str.replace(/custom-thumb/g, 'img-original'),
            (str) => str.replace(/_custom1200\.jpg|_square1200\.jpg/g, '.jpg'),
          ]),
      ],
    },
    {
      test: (h) => h === 'imx.to',
      transforms: [(url) => (url.includes('/t/') ? url.replace('/t/', '/i/') : '')],
    },
    {
      test: (h) => h === 'imx.to' && pathname.startsWith('/upload/small/'),
      transforms: [(url) => url.replace('imx.to/upload/small/', 'i001.imx.to/i/')],
    },
    {
      test: (h) => h === 'vipr.im' && pathname.includes('/th/'),
      transforms: [(url) => url.replace('/th/', '/i/')],
    },
    {
      test: (h) => h === 'thumbs2.imgbox.com',
      transforms: [
        (url) => batchReplace(url, [(str) => str.replace('thumbs2', 'images2'), (str) => str.replace('_t', '_o')]),
      ],
    },
    {
      test: (h) => h === 'static-ca-cdn.eporner.com',
      transforms: [(url) => url.replace(/_296x1000/g, '')],
    },
    {
      test: (h) => h.includes('userapi.com'),
      transforms: [(url) => url],
    },
    {
      test: (h) => h === 'cdn.pichunter.com',
      transforms: [(url) => url.replace('_i', '_o')],
    },
    {
      test: (h) => ['cdn.elitebabes.com', 'cdn.femjoyhunter.com', 'cdn.pmatehunter.com'].includes(h),
      transforms: [(url) => (pathname.includes('_w400') ? url.replace('_w400', '') : '')],
    },
    {
      test: (h) => h === 'i.girlsfordays.com',
      transforms: [(url) => url.replace('/thumbnails', '')],
    },
    {
      test: (h) => h === 'images.sexynude.pics',
      transforms: [(url) => url.replace('/thumbs', '')],
    },
    {
      test: (h) => h === 'cdn.cherrynudes.com',
      transforms: [(url) => url.replace('-410x410', '')],
    },
    {
      test: (h) => h === 'thefapspot.com',
      transforms: [(url) => url.replace('-150x150', '')],
    },
    {
      test: (h) => h === 'cdni.sexynakedgirls.pics',
      transforms: [(url) => url.replace('/460', '/1280')],
    },
    {
      test: (h) => h === 'cdn.erocurves.com' && href.includes('-172x262'),
      transforms: [(url) => url.replace('-172x262', '')],
    },
    {
      test: (h) => h === 'cdn.perfectnaked.com' && href.includes('-200x270'),
      transforms: [(url) => url.replace('-200x270', '')],
    },
    {
      test: (h) => h === 'www.ametart.com' && (pathname.includes('/thumbs') || pathname.includes('/280x_01')),
      transforms: [
        (url) =>
          batchReplace(url, [(str) => str.replace('/thumbs', '/photos'), (str) => str.replace('/280x_01', '/01')]),
      ],
    },
    {
      test: (h) => h === 'cdn.metarthunter.com' && pathname.includes('_w400'),
      transforms: [(url) => url.replace('_w400', '')],
    },
    {
      test: (h) => h === 'data-cdn.multi.xnxx.com' && pathname.includes('/new_small'),
      transforms: [(url) => url.replace('/new_small', '/full')],
    },
    {
      test: (h) => h === 'erohd.club' && pathname.includes('/img_cache/img_cache_garden-bed_matty'),
      transforms: [(url) => url.replace('/img_cache/img_cache_garden-bed_matty', '//Garden-Bed_Matty')],
    },
    {
      test: (h) => h === 'img119.imagetwist.com' && pathname.includes('/th'),
      transforms: [(url) => url.replace('/th', '/i')],
    },
    {
      test: (h) => h.includes('chpic.su'),
      transforms: [
        (url) => {
          let tmp = url.split('?')[0]
          const regex = /\/([^/]+)\/[^/]+\.webp$/
          const match = regex.exec(tmp)
          if (match) {
            const part = match[1]
            tmp = tmp.replace(`/${part}_`, '/')
          }
          tmp = tmp.replace('/_data', '')
          tmp = tmp.replace(/\/stickers\/[a-z]\/+/, '/save2/ru/stickers/')
          tmp = tmp.replace('data.chpic.su', 'chpic.su')
          tmp = tmp.replace(/\.webp[^/]*/, `/f=webp_c=png_bg=${type}`)
          return `${tmp}?type=${type}`
        },
      ],
    },
    {
      test: (h) => h === 'c-ssl.dtstatic.com',
      transforms: [(url) => url.replace('dtstatic.com', 'duitang.com').replace('.thumb.400_0', '')],
    },
    {
      test: (h) => h === 'x3vid.com' && pathname.includes('/thumbs/'),
      transforms: [
        (url) => {
          let out = url.replace('/thumbs/', '/images/')
          if (url.includes('/ept')) out = out.replace('/ept', '/ep2')
          if (url.includes('__ept')) out = out.replace('__ept', '__ep5')
          return out.replace('_160', '_1000')
        },
      ],
    },
    {
      test: (h) => h === 'cdni.pornpics.com' && pathname.includes('/460/'),
      transforms: [(url) => url.replace('/460/', '/1280/')],
    },
    {
      test: (h) => h === 'asiantgp.net' && pathname.includes('tn_'),
      transforms: [(url) => url.replace('tn_', '')],
    },
    {
      test: (h) => h === 'www.sigmapic.com' && pathname.includes('/7_t'),
      transforms: [(url) => url.replace('/7_t', '/7_553')],
    },
    {
      test: (h) => h.includes('pixhost.to') && pathname.includes('/thumbs'),
      transforms: [(url) => url.replace('/thumbs', '/images').replace('//t', '//img')],
    },
    {
      test: (h) => h === 'bravoerotica.com' && pathname.includes('/hegre'),
      transforms: [(url) => url.replace(/\/([^/]*)$/, (match, p1) => '/' + p1.replace(/t/g, ''))],
    },
    {
      test: (h) => h === 'jjgirls.com' && pathname.includes('/cute-'),
      transforms: [(url) => url.replace('/cute-', '')],
    },
  ]

  for (const rule of rules) {
    if (rule.test(hostname)) {
      let originalUrl = href
      for (const transform of rule.transforms) {
        originalUrl = transform(originalUrl)
        if (originalUrl === '') {
          return ''
        }
      }
      return originalUrl
    }
  }

  return ''
}

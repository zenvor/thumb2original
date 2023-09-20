const config = {
  // 运行模式 'parseWebPage' | 'parseFile'
  runningMode: 'parseWebPage',
  // 下载模式 'downloadAllImages' | 'downloadSomeSpecificImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadAllImages',
  // 目标解析网站
  targetCrawlingWebPageLink: 'https://chpic.su/en/stickers/nekostickerpack690/',
  // 缩略图链接（匹配和这个链接命名相似的其他链接）
  thumbnailUrl: '',
  // 下载的目标文件路径
  targetDownloadFolderPath: './download/Girls can use sticker',
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 最大并发请求数（每一轮）
  maxConcurrentRequests: 30,
  // 最大请求间隔时间（毫秒）
  maxIntervalMs: 2000,
  // 最小请求间隔时间（毫秒）
  minIntervalMs: 200,
  // 目标读取文件路径
  targetReadFilePath: ''
}

const {
  runningMode,
  downloadMode,
  retryInterval,
  targetCrawlingWebPageLink,
  targetReadFilePath,
  thumbnailUrl,
  targetDownloadFolderPath,
  maxConcurrentRequests,
  maxIntervalMs,
  minIntervalMs
} = config

export {
  runningMode,
  downloadMode,
  retryInterval,
  targetCrawlingWebPageLink,
  targetReadFilePath,
  thumbnailUrl,
  targetDownloadFolderPath,
  maxConcurrentRequests,
  maxIntervalMs,
  minIntervalMs
}

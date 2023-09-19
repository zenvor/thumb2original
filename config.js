const config = {
  // 运行模式 'parseWebPage' | 'parseFile'
  runningMode: 'parseWebPage',
  // 下载模式 'downloadAllImages' | 'downloadSomeSpecificImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadAllImages',
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 目标解析网站
  targetCrawlingWebPageLink: 'https://www.duitang.com/album/?id=94101894',
  // 缩略图链接（匹配和这个链接命名相似的其他链接）
  thumbnailUrl: '',
  // 目标读取文件路径
  targetReadFilePath: '',
  // 下载的目标文件路径
  targetDownloadFolderPath: './Profile Photo2',
  
}

const {
  runningMode,
  downloadMode,
  retryInterval,
  targetCrawlingWebPageLink,
  targetReadFilePath,
  thumbnailUrl,
  targetDownloadFolderPath,
} = config

export {
  runningMode,
  downloadMode,
  retryInterval,
  targetCrawlingWebPageLink,
  targetReadFilePath,
  thumbnailUrl,
  targetDownloadFolderPath,
}

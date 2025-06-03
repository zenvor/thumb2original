import ImageExtractor from './crawler.js'
// 配置文件中的变量
import { config } from './config.js'

const imageExtractor = new ImageExtractor(config)
imageExtractor.extractImages()

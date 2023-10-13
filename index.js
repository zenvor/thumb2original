import ImageExtractor from './crawler-class.js'
// 配置文件中的变量
import { config } from './config.js'

const imageExtractor = new ImageExtractor(config)
imageExtractor.start()

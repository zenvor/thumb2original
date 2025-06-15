// download/DownloadExecutor.js
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { validateAndModifyFileName } from '../../utils/file/validateAndModifyFileName.js'
import { ImageFormatDetector } from '../image/ImageFormatDetector.js'
import { ImageConverter } from '../image/ImageConverter.js'

/**
 * 🚀 下载执行器
 * 负责执行具体的下载任务，包括Puppeteer和Axios的实现、文件保存、错误处理和回退机制。
 */
export class DownloadExecutor {
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.requestFailedImages = []
    this.ERROR_MESSAGES = {
      NOT_IMAGE: 'This URL is not an image',
      NAVIGATION_FAILED: 'Protocol error (Page.navigate): Cannot navigate to invalid URL',
    }
  }

  async downloadWithPuppeteer(page, imageUrl, stateManager, targetDownloadPath) {
    // 🔥 关键修复：避免直接导航到图片URL以防止触发下载
    try {
      let responseBuffer = null
      let downloadError = null
      let responseReceived = false

      const responseHandler = async (response) => {
        if (response.url() === imageUrl && !responseReceived) {
          responseReceived = true
          try {
            responseBuffer = await response.buffer()
            this.logger.debug(`通过响应拦截获取图片数据: ${imageUrl}`)
          } catch (err) {
            downloadError = err
            this.logger.debug(`获取图片数据失败: ${err.message}`)
          }
        }
      }

      page.on('response', responseHandler)

      try {
        // 🛡️ 防下载修复：不直接导航到图片URL，而是通过page.evaluate发起请求
        const result = await page.evaluate(async (imageUrl) => {
          try {
            const response = await fetch(imageUrl, {
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              }
            })
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }
            
            const arrayBuffer = await response.arrayBuffer()
            return {
              success: true,
              data: Array.from(new Uint8Array(arrayBuffer)),
              contentType: response.headers.get('content-type') || ''
            }
          } catch (error) {
            return {
              success: false,
              error: error.message
            }
          }
        }, imageUrl)

        if (!result.success) {
          throw new Error(result.error || '通过fetch获取图片失败')
        }

        responseBuffer = Buffer.from(result.data)
        
        if (!responseBuffer || responseBuffer.length === 0) {
          throw new Error('获取的图片数据为空')
        }
        
        if (!ImageFormatDetector.isImageBuffer(responseBuffer)) {
          throw new Error(this.ERROR_MESSAGES.NOT_IMAGE)
        }

        const fileName = validateAndModifyFileName(this.extractFileName(imageUrl, responseBuffer))
        const targetFilePath = path.join(targetDownloadPath, fileName)
        await this._handleDownloadSuccess(responseBuffer, targetFilePath, imageUrl, stateManager)
        
        this.logger.debug(`Puppeteer下载成功（无导航模式）: ${imageUrl}`)
      } finally {
        page.off('response', responseHandler)
      }
    } catch (error) {
      const enableProgressBar = this.config.enableProgressBar
      if (!enableProgressBar) {
        this.logger.warn(`Puppeteer下载失败，尝试使用axios下载: ${imageUrl}`)
        this.logger.debug(`Puppeteer错误信息: ${error.message}`)
      } else {
        this.logger.debug(`Puppeteer下载失败，fallback到axios: ${imageUrl}`, error)
      }
      try {
        await this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
        if (!enableProgressBar) this.logger.success(`axios fallback下载成功: ${imageUrl}`)
        else this.logger.debug(`axios fallback下载成功: ${imageUrl}`)
      } catch (axiosError) {
        await this._handleDownloadError(axiosError, imageUrl, stateManager)
        if (!enableProgressBar) this.logger.error(`Puppeteer和axios都下载失败: ${imageUrl}`)
        else this.logger.debug(`Puppeteer和axios都下载失败: ${imageUrl}`, axiosError)
      }
    }
  }

  async downloadWithAxios(imageUrl, stateManager, targetDownloadPath) {
    // ... (从原始 DownloadManager.js 复制 downloadWithAxios 方法的全部代码)
    try {
      const timeout = this.config.timeouts?.imageDownload || 30000
      const response = await axios({
        method: 'get',
        url: imageUrl,
        responseType: 'arraybuffer',
        timeout: timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      })
      const buffer = response.data
      let fileName
      if (imageUrl.includes('chpic.su')) {
        const type = imageUrl.split('?type=')[1]
        const contentDisposition = response.headers['content-disposition']
        this.logger.debug('contentDisposition: ', contentDisposition)
        if (contentDisposition) {
          const match = contentDisposition.match(/filename=["']?([^"']+)/)
          if (match) fileName = type + '_' + match[1].split('_-_')[1]
        }
      } else {
        fileName = validateAndModifyFileName(this.extractFileName(imageUrl, buffer))
      }
      const targetFilePath = path.join(targetDownloadPath, fileName)
      stateManager.incrementRequestSuccess()
      await this._handleDownloadSuccess(buffer, targetFilePath, imageUrl, stateManager)
    } catch (error) {
      await this._handleDownloadError(error, imageUrl, stateManager)
    }
  }

  async _handleDownloadSuccess(buffer, targetFilePath, imageUrl, stateManager) {
    await this._saveFile(buffer, targetFilePath, imageUrl, stateManager)
  }

  async _handleDownloadError(error, imageUrl, stateManager) {
    // ... (从原始 DownloadManager.js 复制 _handleDownloadError 方法的全部代码)
    const enableProgressBar = this.config.enableProgressBar
    stateManager.incrementRequestFailed()
    stateManager.incrementDownloadFailed()
    if (!enableProgressBar) {
      this.logger.error('图片下载错误', error)
      this.logger.warn(`访问图片时发生错误：${imageUrl}`, error)
    } else {
      this.logger.debug(`下载失败: ${imageUrl}`, error)
    }
    this.logger.debug('请求失败: ', stateManager.requestFailedCount)
    this.logger.debug('请求失败/下载失败: ', stateManager.downloadFailedCount)
    if (error.message !== this.ERROR_MESSAGES.NOT_IMAGE && error.message !== this.ERROR_MESSAGES.NAVIGATION_FAILED) {
      this.requestFailedImages.push(imageUrl)
      this.logger.debug('错误请求集合个数: ', this.requestFailedImages.length)
    }
  }

  async _saveFile(buffer, targetFilePath, imageUrl, stateManager) {
    // ... (从原始 DownloadManager.js 复制 _saveFile 方法的全部代码)
    try {
      const processed = await ImageConverter.processImage(buffer, targetFilePath)
      if (processed.filePath !== targetFilePath) {
        stateManager.incrementWebpConversions()
      }
      await fs.promises.writeFile(processed.filePath, processed.buffer)
      stateManager.incrementDownloadSuccess()
      const fileName = processed.filePath.split('/').pop()
      const enableProgressBar = this.config.enableProgressBar
      if (!enableProgressBar) {
        this.logger.success(`已下载 ${stateManager.downloadSuccessCount} 张 | ${fileName}`)
      }
      this.logger.debug(`source: ${imageUrl}`)
    } catch (error) {
      this.requestFailedImages.push(imageUrl)
      stateManager.incrementDownloadFailed()
      const enableProgressBar = this.config.enableProgressBar
      if (!enableProgressBar) {
        this.logger.error('下载失败', error)
      } else {
        this.logger.debug(`文件保存失败: ${imageUrl}`, error)
      }
      this.logger.debug('下载失败: ', stateManager.downloadFailedCount)
    }
  }

  extractFileName(url, buffer) {
    // ... (从原始 DownloadManager.js 复制 extractFileName 方法的全部代码)
    const urlPath = url.split('?')[0]
    const fileName = urlPath.split('/').pop()
    const type = fileName.split('.').pop()
    const imageName = fileName.replace(`.${type}`, '')
    try {
      if (buffer && buffer.length >= 16) {
        const format = ImageFormatDetector.getImageFormat(buffer)
        if (format !== 'unknown') {
          const extension = format === 'jpeg' ? 'jpeg' : format
          return imageName + '.' + extension
        }
      }
    } catch (error) {
      this.logger.debug('文件名格式检测失败，使用原扩展名', error)
    }
    return fileName
  }

  getFailedImages() {
    return this.requestFailedImages
  }

  clearFailedImages() {
    this.requestFailedImages = []
  }

  /**
   * 根据配置的下载方式执行下载
   * @param {Object} page - Puppeteer页面对象
   * @param {string} imageUrl - 图片URL
   * @param {Object} stateManager - 状态管理器
   * @param {string} targetDownloadPath - 目标下载路径
   * @returns {Promise<void>}
   */
  async executeDownloadByMethod(page, imageUrl, stateManager, targetDownloadPath) {
    const downloadMethod = this.config.downloadMethod
    
    switch (downloadMethod) {
      case 'axios':
        // 强制使用Axios
        return this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
      
      case 'puppeteer-priority':
      case 'auto':
      default:
        // 优先使用Puppeteer，失败时fallback到Axios（当前默认行为）
        if (page) {
          return this.downloadWithPuppeteer(page, imageUrl, stateManager, targetDownloadPath)
        } else {
          // 如果没有页面对象，直接使用Axios
          return this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
        }
    }
  }


}
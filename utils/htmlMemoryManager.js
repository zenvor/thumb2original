import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import sizeOf from 'image-size'
import { logger } from './logger.js'

/**
 * @description HTML文件记忆管理器 - 每个HTML文件对应一个JSONL文件
 * 新架构：每个HTML文件都有独立的JSONL记忆文件，统一存放在memory目录中
 */
class HtmlMemoryManager {
  constructor(memoryDirectory = './memory') {
    this.memoryDirectory = memoryDirectory
    this.processedFiles = new Set() // 已处理文件的路径集合
    this.fileMemoryMap = new Map() // HTML文件路径 -> JSONL文件路径的映射
    this._memoryDirSnapshot = null // 记忆目录快照，用于回退匹配
    this.htmlRoot = null // HTML 根目录（用于相对 key 归一化）
  }

  /**
   * @description 设置 HTML 根目录，用于生成稳定相对 key（提升路径稳健性）
   * @param {string|null} htmlRoot - HTML 根目录（绝对或相对路径）。传 null 取消设置。
   */
  setHtmlRoot(htmlRoot) {
    try {
      if (!htmlRoot) {
        this.htmlRoot = null
        return
      }
      this.htmlRoot = path.resolve(htmlRoot)
      logger.info(`已设置 HTML 根目录: ${this.htmlRoot}`)
    } catch (error) {
      logger.warn(`设置 HTML 根目录失败: ${error.message}`)
      this.htmlRoot = null
    }
  }

  /**
   * @description 初始化记忆目录
   * @returns {Promise<void>}
   */
  async initializeMemoryDirectory() {
    try {
      await fs.mkdir(this.memoryDirectory, { recursive: true })
      logger.info(`记忆目录已创建: ${this.memoryDirectory}`)
      // 尝试加载已持久化的索引
      await this._loadIndex()
    } catch (error) {
      logger.error(`创建记忆目录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * @description 批量预检查文件完成状态 - 高效检查多个文件的处理状态
   * @param {string[]} htmlFiles - HTML文件路径数组
   * @returns {Promise<{completed: string[], needProcess: string[], partialDownload: Array<Object>}>} 分类结果
   */
  async batchPreCheck(htmlFiles) {
    const result = {
      completed: [],      // 已完全处理的文件
      needProcess: [],    // 需要处理的文件（未开始）
      partialDownload: [] // 部分下载的文件
    }

    logger.info(`开始批量预检查 ${htmlFiles.length} 个HTML文件...`)
    
    for (const htmlFile of htmlFiles) {
      try {
        const absolutePath = this._getAbsolutePath(htmlFile)
        const jsonlPath = await this.resolveJsonlPathForHtml(absolutePath)
        
        // 快速检查记忆文件是否存在
        const fileExists = await this._checkFileExists(jsonlPath)
        if (!fileExists) {
          // 记忆文件不存在，需要处理
          result.needProcess.push(htmlFile)
          continue
        }
        
        // 读取最后一条记录（最新状态）
        const lastRecord = await this._getLastRecord(jsonlPath)
        if (!lastRecord) {
          // 记忆文件存在但无有效记录，需要处理
          result.needProcess.push(htmlFile)
          continue
        }
        
        // 使用快速完成检查优化性能
        const completionCheck = await this._fastCompletionCheck(jsonlPath)
        
        if (completionCheck.isCompleted) {
          // 文件已完成
          result.completed.push(htmlFile)
        } else if (completionCheck.downloadedCount > 0) {
          // 有部分下载记录，需要断点续传
          result.partialDownload.push({
            filePath: htmlFile,
            downloadedCount: completionCheck.downloadedCount,
            totalImages: completionCheck.totalImages,
            hasMetadata: completionCheck.hasMetadata
          })
        } else {
          // 没有下载记录，需要处理
          result.needProcess.push(htmlFile)
        }
      } catch (error) {
        logger.warn(`预检查文件 ${path.basename(htmlFile)} 时出错: ${error.message}，将其标记为需要处理`)
        result.needProcess.push(htmlFile)
      }
    }
    
    // 输出预检查结果
    logger.success(`批量预检查完成：`)
    logger.info(`  ✅ 已完成: ${result.completed.length} 个文件`)
    logger.info(`  🔄 部分下载: ${result.partialDownload.length} 个文件`)
    logger.info(`  📝 需要处理: ${result.needProcess.length} 个文件`)
    
    // 显示每个文件的详细状态
    if (result.completed.length > 0) {
      logger.info('\n已完成的文件:')
      for (const htmlFile of result.completed) {
        const jsonlPath = await this.resolveJsonlPathForHtml(htmlFile)
        const completionCheck = await this._fastCompletionCheck(jsonlPath)
        logger.info(`  - ${path.basename(htmlFile)} (已下载 ${completionCheck.downloadedCount}/${completionCheck.totalImages} 张图片)`)
      }
    }
    
    if (result.partialDownload.length > 0) {
      logger.info('\n部分下载的文件:')
      for (const fileInfo of result.partialDownload) {
        logger.info(`  - ${path.basename(fileInfo.filePath)} (已下载 ${fileInfo.downloadedCount} 张图片${fileInfo.totalImages ? '/' + fileInfo.totalImages : ''})`)
      }
    }
    
    return result
  }

  /**
   * @description 快速检查文件是否已完成处理（完全基于首行元数据）
   * @param {string} jsonlPath - JSONL文件路径
   * @returns {Promise<{isCompleted: boolean, totalImages: number, downloadedCount: number, hasMetadata: boolean}>} 检查结果
   * @private
   */
  async _fastCompletionCheck(jsonlPath) {
    try {
      const content = await fs.readFile(jsonlPath, 'utf-8')
      const lines = content.trim().split('\n').filter(line => line.trim())
      
      if (lines.length === 0) {
        return { isCompleted: false, totalImages: 0, downloadedCount: 0, hasMetadata: false }
      }
      
      // 解析首行元数据记录
      const firstLine = JSON.parse(lines[0])
      if (firstLine.type !== 'metadata' || !firstLine.totalImages) {
        // 不符合新格式要求，视为无效
        logger.warn(`记忆文件 ${path.basename(jsonlPath)} 不是新格式，缺少元数据首行`)
        return { isCompleted: false, totalImages: 0, downloadedCount: 0, hasMetadata: false }
      }
      
      // 使用首行元数据快速检查
      const totalImages = firstLine.totalImages
      
      // 统计图片记录行数（排除metadata、start、complete等非图片记录）
      const imageRecordCount = lines.slice(1).filter(line => {
        try {
          const record = JSON.parse(line)
          return record.type === 'image' || record.updateType === 'imageAdded'
        } catch {
          return false
        }
      }).length
      
      return {
        isCompleted: imageRecordCount >= totalImages,
        totalImages: totalImages,
        downloadedCount: imageRecordCount,
        hasMetadata: true
      }
    } catch (error) {
      logger.debug(`快速完成检查失败 ${path.basename(jsonlPath)}: ${error.message}`)
      return { isCompleted: false, totalImages: 0, downloadedCount: 0, hasMetadata: false }
    }
  }

  /**
   * @description 快速获取JSONL文件的最后一条记录
   * @param {string} jsonlPath - JSONL文件路径
   * @returns {Promise<Object|null>} 最后一条记录
   * @private
   */
  async _getLastRecord(jsonlPath) {
    try {
      const content = await fs.readFile(jsonlPath, 'utf-8')
      const lines = content.trim().split('\n').filter(line => line.trim())
      
      if (lines.length === 0) {
        return null
      }
      
      // 解析最后一行
      const lastLine = lines[lines.length - 1]
      return JSON.parse(lastLine)
    } catch (error) {
      logger.debug(`读取最后记录失败 ${path.basename(jsonlPath)}: ${error.message}`)
      return null
    }
  }
  
  /**
   * @description 读取并解析JSONL文件
   * @param {string} jsonlPath - JSONL文件路径
   * @returns {Promise<{lines: Array, lastRecord: Object|null}>} 解析结果
   * @private
   */
  async _readJsonlFile(jsonlPath) {
    try {
      const data = await fs.readFile(jsonlPath, 'utf-8')
      const lines = data.trim().split('\n').filter(line => line.trim())
      
      if (lines.length === 0) {
        return { lines, lastRecord: null }
      }
      
      try {
        const lastRecord = JSON.parse(lines[lines.length - 1])
        return { lines, lastRecord }
      } catch (parseError) {
        logger.warn(`解析JSONL文件最后一行失败: ${parseError.message}`)
        return { lines, lastRecord: null }
      }
    } catch (error) {
      logger.error(`读取JSONL文件失败: ${error.message}`)
      return { lines: [], lastRecord: null }
    }
  }

  /**
   * @description 根据HTML文件路径生成对应的JSONL文件路径
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {string} JSONL文件路径
   */
  getJsonlPathForHtml(htmlFilePath) {
    // 使用稳定的相对 key 生成唯一的文件名，避免绝对根路径变化导致哈希不一致
    const absolutePath = path.resolve(htmlFilePath)
    const key = this._normalizeHtmlKey(absolutePath)
    const hash = crypto.createHash('md5').update(key).digest('hex')
    const baseName = path.basename(htmlFilePath, '.html')
    const jsonlFileName = `${baseName}_${hash.substring(0, 8)}.jsonl`
    return path.join(this.memoryDirectory, jsonlFileName)
  }

  /**
   * @description 生成稳定的 HTML 路径 key：优先取 /html/ 之后的相对路径，统一小写与分隔符
   * @param {string} htmlFilePath - HTML 文件路径（绝对路径）
   * @returns {string} 稳定 key
   * @private
   */
  _normalizeHtmlKey(htmlFilePath) {
    const absolute = path.resolve(htmlFilePath)
    // 优先使用注入的 htmlRoot 生成稳定的相对 key，仅当位于 root 子树内时采用
    if (this.htmlRoot) {
      try {
        const rootAbs = path.resolve(this.htmlRoot)
        const rel = path.relative(rootAbs, absolute)
        const isSubPath = rel && !path.isAbsolute(rel) && !rel.startsWith('..' + path.sep) && rel !== '..'
        if (isSubPath) {
          return rel.split(path.sep).join('/').toLowerCase()
        }
      } catch {}
    }
    const posixPath = absolute.split(path.sep).join('/')
    const lower = posixPath.toLowerCase()
    const marker = '/html/'
    const idx = lower.lastIndexOf(marker)
    if (idx !== -1) {
      return lower.slice(idx + marker.length)
    }
    // 回退：使用目录名/文件名，尽量稳定
    const dir = path.basename(path.dirname(absolute))
    const base = path.basename(absolute)
    return `${dir}/${base}`.toLowerCase()
  }

  /**
   * @description 计算索引文件路径
   * @returns {string}
   * @private
   */
  _getIndexFilePath() {
    return path.join(this.memoryDirectory, 'index.json')
  }

  /**
   * @description 加载持久化索引（htmlKey -> jsonlPath），无则忽略
   * @private
   */
  async _loadIndex() {
    try {
      const indexPath = this._getIndexFilePath()
      const exists = await this._checkFileExists(indexPath)
      if (!exists) return
      const content = await fs.readFile(indexPath, 'utf-8')
      const data = JSON.parse(content)
      let loaded = 0
      for (const [key, jsonlPath] of Object.entries(data || {})) {
        if (typeof key !== 'string' || typeof jsonlPath !== 'string') continue
        if (await this._checkFileExists(jsonlPath)) {
          this._indexMap.set(key, jsonlPath)
          loaded++
        }
      }
      if (loaded > 0) {
        logger.info(`已加载索引映射 ${loaded} 项`)
      }
    } catch (error) {
      logger.warn(`加载索引映射失败: ${error.message}`)
    }
  }

  /**
   * @description 更新索引并调度刷盘；存在冲突时按 mtime 较新者取
   * @private
   */
  async _updateIndexMapping(htmlKey, jsonlPath) {
    try {
      if (!this._indexMap) this._indexMap = new Map()
      const existing = this._indexMap.get(htmlKey)
      if (existing && existing !== jsonlPath) {
        try {
          const [a, b] = await Promise.all([
            fs.stat(existing).catch(() => null),
            fs.stat(jsonlPath).catch(() => null),
          ])
          const pick = b && (!a || b.mtimeMs >= a.mtimeMs) ? jsonlPath : existing
          if (pick !== existing) {
            logger.info(`索引冲突，采用较新文件: ${path.basename(jsonlPath)}`)
            this._indexMap.set(htmlKey, pick)
          }
        } catch {
          this._indexMap.set(htmlKey, jsonlPath)
        }
      } else {
        this._indexMap.set(htmlKey, jsonlPath)
      }
    } catch {
      // 保底写入
      this._indexMap.set(htmlKey, jsonlPath)
    }
    this._scheduleSaveIndex()
  }

  /**
   * @description 调度索引刷盘（去抖）
   * @private
   */
  _scheduleSaveIndex() {
    try {
      if (!this._saveIndexDebounceMs) this._saveIndexDebounceMs = 2000
      if (this._saveIndexTimer) clearTimeout(this._saveIndexTimer)
      this._saveIndexTimer = setTimeout(() => {
        this._flushIndex().catch((e) => logger.warn(`写入索引失败: ${e.message}`))
        this._saveIndexTimer = null
      }, this._saveIndexDebounceMs)
    } catch {}
  }

  /**
   * @description 将索引原子写入磁盘
   * @private
   */
  async _flushIndex() {
    try {
      const indexPath = this._getIndexFilePath()
      const tmpPath = indexPath + '.tmp'
      const obj = Object.fromEntries((this._indexMap || new Map()).entries())
      const json = JSON.stringify(obj, null, 2)
      await fs.writeFile(tmpPath, json, 'utf-8')
      await fs.rename(tmpPath, indexPath)
    } catch (error) {
      logger.warn(`写入索引失败: ${error.message}`)
    }
  }

  /**
   * @description 解析 HTML 对应的 JSONL 路径：先按新规则生成，若不存在则回退匹配历史文件
   * @param {string} htmlFilePath - HTML 文件路径（绝对或相对）
   * @returns {Promise<string>} JSONL 文件路径（可能是旧文件路径）
   */
  async resolveJsonlPathForHtml(htmlFilePath) {
    const expected = this.getJsonlPathForHtml(htmlFilePath)
    const key = this._normalizeHtmlKey(htmlFilePath)

    // 1) 先查持久化索引映射
    const indexedPath = this._indexMap?.get?.(key)
    if (indexedPath) {
      if (await this._checkFileExists(indexedPath)) {
        const absolutePath = this._getAbsolutePath(htmlFilePath)
        this.fileMemoryMap.set(absolutePath, indexedPath)
        return indexedPath
      } else {
        // 记录已失效，删除并稍后保存
        this._indexMap.delete(key)
        this._scheduleSaveIndex()
      }
    }
    if (await this._checkFileExists(expected)) return expected

    // 回退：扫描 memory 目录中与 baseName 相同前缀的文件，读取 metadata.htmlPath 做归一化比对
    try {
      if (!this._memoryDirSnapshot) {
        this._memoryDirSnapshot = await fs.readdir(this.memoryDirectory)
      }
      const baseName = path.basename(htmlFilePath, '.html')
      let candidates = this._memoryDirSnapshot.filter(
        (f) => f.startsWith(baseName + '_') && f.endsWith('.jsonl')
      )
      // 如果快照为空或未命中，刷新一次快照
      if (candidates.length === 0) {
        try {
          const fresh = await fs.readdir(this.memoryDirectory)
          this._memoryDirSnapshot = fresh
          candidates = fresh.filter((f) => f.startsWith(baseName + '_') && f.endsWith('.jsonl'))
        } catch {}
      }
      const targetKey = this._normalizeHtmlKey(htmlFilePath)

      for (const file of candidates) {
        const p = path.join(this.memoryDirectory, file)
        try {
          const content = await fs.readFile(p, 'utf-8')
          const firstLine = content.trim().split('\n').find(Boolean)
          if (!firstLine) continue
          const rec = JSON.parse(firstLine)
          if (rec.type === 'metadata' && rec.htmlPath) {
            const metaKey = this._normalizeHtmlKey(rec.htmlPath)
            if (metaKey === targetKey) {
              const absolutePath = this._getAbsolutePath(htmlFilePath)
              this.fileMemoryMap.set(absolutePath, p)
              // 更新索引映射并异步刷盘
              await this._updateIndexMapping(targetKey, p)
              return p
            }
          }
        } catch (e) {
          // 忽略解析失败
        }
      }
    } catch (e) {
      logger.debug(`回退匹配 JSONL 失败: ${e.message}`)
    }

    return expected
  }
  
  /**
   * @description 获取HTML文件的绝对路径
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {string} 绝对路径
   * @private
   */
  _getAbsolutePath(htmlFilePath) {
    return path.resolve(htmlFilePath)
  }

  /**
   * @description 加载所有HTML文件的记忆记录
   * @returns {Promise<number>} 加载的已处理文件数量
   */
  async loadAllMemories() {
    try {
      await this.initializeMemoryDirectory()
      
      // 扫描记忆目录中的所有JSONL文件
      const files = await fs.readdir(this.memoryDirectory)
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'))
      
      this.processedFiles.clear()
      this.fileMemoryMap.clear()
      
      let totalProcessedFiles = 0
      
      for (const jsonlFile of jsonlFiles) {
        const jsonlPath = path.join(this.memoryDirectory, jsonlFile)
        const fileData = await this._readJsonlFile(jsonlPath)
        
        if (!fileData.lastRecord) continue
        
        const lastRecord = fileData.lastRecord
        if (lastRecord.htmlPath && lastRecord.status === 'completed') {
          this.processedFiles.add(lastRecord.htmlPath)
          this.fileMemoryMap.set(lastRecord.htmlPath, jsonlPath)
          totalProcessedFiles++
        }
      }
      
      logger.info(`已从 ${jsonlFiles.length} 个JSONL文件加载 ${totalProcessedFiles} 个已处理HTML文件的记录`)
      return totalProcessedFiles
    } catch (error) {
      logger.error(`加载记忆记录失败: ${error.message}`)
      this.processedFiles = new Set()
      this.fileMemoryMap = new Map()
      return 0
    }
  }

  /**
   * @description 检查HTML文件是否已被处理过
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {boolean} 是否已处理
   */
  isProcessed(htmlFilePath) {
    const absolutePath = this._getAbsolutePath(htmlFilePath)
    return this.processedFiles.has(absolutePath)
  }

  /**
   * @description 开始处理HTML文件，写入元数据和开始记录
   * @param {string} htmlFilePath - HTML文件路径
   * @param {Object} [additionalInfo] - 额外信息
   * @param {boolean} [lazyMode=false] - 是否启用懒加载模式
   * @param {number} [totalImages] - 图片总数（用于优化检查）
   * @returns {Promise<void>}
   */
  async startProcessing(htmlFilePath, additionalInfo = {}, lazyMode = false, totalImages = null) {
    try {
      const absolutePath = this._getAbsolutePath(htmlFilePath)
      const jsonlPath = await this.resolveJsonlPathForHtml(absolutePath)
      
      // 在懒加载模式下，检查文件是否已存在
      if (lazyMode) {
        const fileExists = await this._checkFileExists(jsonlPath)
        if (fileExists) {
          // 文件已存在，只更新内存映射
          this.fileMemoryMap.set(absolutePath, jsonlPath)
          logger.debug(`使用现有记忆文件: ${path.basename(jsonlPath)}`)
          return
        } else {
          // 文件不存在，继续创建
          logger.debug(`创建新记忆文件: ${path.basename(jsonlPath)}`)
        }
      }
      
      const timestamp = new Date().toISOString()
      
      // 如果提供了图片总数，先写入元数据记录（优化版本）
      if (totalImages !== null && totalImages > 0) {
        const metadataRecord = {
          type: 'metadata',
          htmlPath: absolutePath,
          totalImages: totalImages,
          timestamp: timestamp,
          version: '2.0' // 标记为新版本格式
        }
        await this._appendJsonlRecord(jsonlPath, metadataRecord)
      }
      
      // 写入开始处理记录
      const startRecord = {
        type: 'start',
        htmlPath: absolutePath,
        timestamp,
        status: 'started',
        startedAt: timestamp,
        ...additionalInfo
      }
      
      await this._appendJsonlRecord(jsonlPath, startRecord)
      this.fileMemoryMap.set(absolutePath, jsonlPath)
      
      logger.success(`已开始处理HTML文件: ${path.basename(htmlFilePath)}`)
      if (totalImages) {
        logger.info(`记忆文件: ${path.basename(jsonlPath)} (图片总数: ${totalImages})`)
      } else {
        logger.info(`记忆文件: ${path.basename(jsonlPath)}`)
      }
    } catch (error) {
      logger.error(`写入开始记录失败: ${error.message}`)
      throw error
    }
  }
  
  /**
   * @description 检查文件是否存在
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} 文件是否存在
   * @private
   */
  async _checkFileExists(filePath) {
    try {
      await fs.access(filePath)
      return true
    } catch (error) {
      return false
    }
  }
  
  /**
   * @description 向JSONL文件追加一条记录
   * @param {string} jsonlPath - JSONL文件路径
   * @param {Object} record - 记录对象
   * @returns {Promise<void>}
   * @private
   */
  async _appendJsonlRecord(jsonlPath, record) {
    const jsonLine = JSON.stringify(record) + '\n'
    await fs.appendFile(jsonlPath, jsonLine, 'utf-8')
    return jsonLine
  }

  /**
   * @description 实时追加单张图片信息
   * @param {string} htmlFilePath - HTML文件路径
   * @param {Object} imageInfo - 图片信息
   * @returns {Promise<boolean>} 是否成功追加
   */
  async appendImageInfo(htmlFilePath, imageInfo) {
    try {
      const absolutePath = this._getAbsolutePath(htmlFilePath)
      const jsonlPath = this.fileMemoryMap.get(absolutePath) || await this.resolveJsonlPathForHtml(absolutePath)
      
      // 使用新的记录格式，支持快速检查
      const record = {
        type: 'image',
        htmlPath: absolutePath,
        timestamp: new Date().toISOString(),
        imageInfo: imageInfo
      }
      
      await this._appendJsonlRecord(jsonlPath, record)
      
      // 格式化文件大小显示
      const fileSizeKB = Math.round(imageInfo.size / 1024)
      const fileSizeMB = (imageInfo.size / (1024 * 1024)).toFixed(1)
      const sizeDisplay = fileSizeKB > 1024 ? `${fileSizeMB}MB` : `${fileSizeKB}KB`
      
      // 构建详细的日志信息
      const logMessage = `📸 已记录图片信息: ${imageInfo.name} (${imageInfo.resolution}, ${sizeDisplay}) -> ${path.basename(htmlFilePath)}`
      logger.info(logMessage)
      return true
    } catch (error) {
      logger.error(`❌ 记录图片信息失败: ${imageInfo.name} -> ${path.basename(htmlFilePath)}: ${error.message}`)
      return false
    }
  }

  /**
   * @description 完成HTML文件处理，写入完成记录
   * @param {string} htmlFilePath - HTML文件路径
   * @param {Object} [additionalInfo] - 额外信息
   * @returns {Promise<void>}
   */
  async completeProcessing(htmlFilePath, additionalInfo = {}) {
    try {
      const absolutePath = this._getAbsolutePath(htmlFilePath)
      const jsonlPath = this.fileMemoryMap.get(absolutePath) || await this.resolveJsonlPathForHtml(absolutePath)
      
      // 获取已下载的图片信息
      const downloadedImages = await this.getDownloadedImages(htmlFilePath)
      
      // 准备记录数据
      const timestamp = new Date().toISOString()
      const record = {
        type: 'complete',
        htmlPath: absolutePath,
        timestamp,
        status: 'completed',
        completedAt: timestamp,
        imageCount: downloadedImages.length,
        ...additionalInfo
      }
      
      // 写入记录并更新映射
      await this._appendJsonlRecord(jsonlPath, record)
      
      // 更新内存记录
      this.processedFiles.add(absolutePath)
      this.fileMemoryMap.set(absolutePath, jsonlPath)
      
      logger.success(`HTML文件处理完成: ${path.basename(htmlFilePath)} (${downloadedImages.length}张图片)`)
    } catch (error) {
      logger.error(`写入完成记录失败: ${error.message}`)
      throw error
    }
  }

  /**
   * @description 生成图片信息对象
   * @param {string} imagePath - 图片文件路径
   * @param {string} originalUrl - 原始图片URL
   * @returns {Promise<Object>} 图片信息对象
   */
  async generateImageInfo(imagePath, originalUrl) {
    const timestamp = new Date().toISOString()
    const fileName = path.basename(imagePath)
    
    try {
      // 检查文件是否存在并获取大小
      const stats = await fs.stat(imagePath)
      
      // 读取文件内容用于 image-size 分析
      const buffer = await fs.readFile(imagePath)
      
      // 使用 buffer 而不是文件路径来避免 ArrayBuffer 错误
      const dimensions = sizeOf(buffer)
      
      return {
        name: fileName,
        resolution: this._formatResolution(dimensions),
        size: stats.size,
        storagePath: imagePath,
        url: originalUrl,
        downloadedAt: timestamp
      }
    } catch (error) {
      logger.warn(`生成图片信息失败 ${imagePath}: ${error.message}`)
      
      // 尝试获取文件大小，即使无法获取分辨率
      const fileSize = await this._safeGetFileSize(imagePath)
      
      return {
        name: fileName,
        resolution: 'unknown',
        size: fileSize,
        storagePath: imagePath,
        url: originalUrl,
        downloadedAt: timestamp,
        error: error.message
      }
    }
  }
  
  /**
   * @description 安全地获取文件大小
   * @param {string} filePath - 文件路径
   * @returns {Promise<number>} 文件大小，如果出错则返回0
   * @private
   */
  async _safeGetFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath)
      return stats.size
    } catch (error) {
      logger.warn(`无法获取文件大小 ${filePath}: ${error.message}`)
      return 0
    }
  }
  
  /**
   * @description 格式化分辨率信息
   * @param {Object|null} dimensions - 尺寸对象
   * @returns {string} 格式化的分辨率字符串
   * @private
   */
  _formatResolution(dimensions) {
    return dimensions && dimensions.width && dimensions.height 
      ? `${dimensions.width}x${dimensions.height}` 
      : 'unknown'
  }

  /**
   * @description 获取HTML文件已下载的图片列表（用于断点续传）
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {Promise<Array>} 已下载的图片信息列表
   */
  async getDownloadedImages(htmlFilePath) {
    try {
      const absolutePath = this._getAbsolutePath(htmlFilePath)
      const jsonlPath = await this.resolveJsonlPathForHtml(absolutePath)
      
      // 检查JSONL文件是否存在
      const fileExists = await this._checkFileExists(jsonlPath)
      if (!fileExists) {
        return [] // 文件不存在，返回空数组
      }
      
      // 读取并解析JSONL文件
      const fileData = await this._readJsonlFile(jsonlPath)
      if (!fileData.lines || fileData.lines.length === 0) {
        return []
      }
      
      // 检查首行是否为元数据记录
      try {
        const firstLine = JSON.parse(fileData.lines[0])
        if (firstLine.type !== 'metadata' || !firstLine.totalImages) {
          logger.warn(`记忆文件 ${path.basename(jsonlPath)} 不是新格式，缺少元数据首行`)
          return [] // 不符合新格式要求，返回空数组
        }
      } catch (error) {
        logger.warn(`记忆文件 ${path.basename(jsonlPath)} 首行解析失败，不是有效的元数据格式`)
        return [] // 首行解析失败，返回空数组
      }
      
      const downloadedImages = []
      
      // 遍历所有记录，仅收集新格式的图片信息
      // 从第二行开始（跳过元数据首行）
      for (const line of fileData.lines.slice(1)) {
        try {
          const record = JSON.parse(line)
          if (record.type === 'image' && record.imageInfo) {
            // 验证本地文件是否存在
            const imageFileExists = await this._checkFileExists(record.imageInfo.storagePath)
            if (imageFileExists) {
              downloadedImages.push({
                url: record.imageInfo.url,
                storagePath: record.imageInfo.storagePath,
                name: record.imageInfo.name,
                downloadedAt: record.imageInfo.timestamp || record.timestamp
              })
            } else {
              logger.warn(`图片文件不存在，将重新下载: ${record.imageInfo.storagePath}`)
            }
          }
        } catch (parseError) {
          // 跳过无效的记录
          continue
        }
      }
      
      return downloadedImages
    } catch (error) {
      logger.error(`获取已下载图片列表失败 ${htmlFilePath}: ${error.message}`)
      return []
    }
  }

  /**
   * @description 获取HTML文件已下载图片的URL集合（用于增量下载过滤）
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {Promise<Set<string>>} 已下载图片的URL集合
   */
  async getDownloadedImageUrls(htmlFilePath) {
    try {
      const downloadedImages = await this.getDownloadedImages(htmlFilePath)
      const urlSet = new Set()
      
      for (const image of downloadedImages) {
        if (image.url) {
          urlSet.add(image.url)
        }
      }
      
      logger.info(`HTML文件 ${path.basename(htmlFilePath)} 已下载 ${urlSet.size} 张图片`)
      return urlSet
    } catch (error) {
      logger.error(`获取已下载图片URL集合失败 ${htmlFilePath}: ${error.message}`)
      return new Set()
    }
  }

  /**
   * @description 过滤出未下载的图片URL列表（增量下载核心逻辑）
   * @param {string} htmlFilePath - HTML文件路径
   * @param {string[]} allImageUrls - 从HTML文件提取的所有图片URL
   * @returns {Promise<{pendingUrls: string[], downloadedCount: number, totalCount: number}>} 过滤结果
   */
  async filterPendingImageUrls(htmlFilePath, allImageUrls) {
    try {
      const downloadedUrls = await this.getDownloadedImageUrls(htmlFilePath)
      const pendingUrls = allImageUrls.filter(url => !downloadedUrls.has(url))
      
      const result = {
        pendingUrls,
        downloadedCount: downloadedUrls.size,
        totalCount: allImageUrls.length
      }
      
      logger.info(`HTML文件 ${path.basename(htmlFilePath)} 增量下载分析: 总计${result.totalCount}张，已下载${result.downloadedCount}张，待下载${pendingUrls.length}张`)
      
      return result
    } catch (error) {
      logger.error(`过滤待下载图片URL失败 ${htmlFilePath}: ${error.message}`)
      return {
        pendingUrls: allImageUrls, // 出错时返回所有URL
        downloadedCount: 0,
        totalCount: allImageUrls.length
      }
    }
  }

  /**
   * @description 检查HTML文件是否有部分下载记录（用于断点续传判断）
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {Promise<boolean>} 是否有部分下载记录
   */
  async hasPartialDownload(htmlFilePath) {
    const downloadedImages = await this.getDownloadedImages(htmlFilePath)
    return downloadedImages.length > 0
  }

  /**
   * @description 获取已处理文件的数量
   * @returns {number} 已处理文件数量
   */
  getProcessedCount() {
    return this.processedFiles.size
  }

  /**
   * @description 获取所有已处理的HTML文件路径
   * @returns {string[]} 已处理HTML文件路径数组
   */
  getProcessedFiles() {
    return Array.from(this.processedFiles)
  }

  /**
   * @description 获取HTML文件的详细处理信息
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {Promise<Object|null>} 文件详细信息
   */
  async getFileInfo(htmlFilePath) {
    try {
      const absolutePath = this._getAbsolutePath(htmlFilePath)
      const jsonlPath = this.fileMemoryMap.get(absolutePath) || await this.resolveJsonlPathForHtml(absolutePath)
      
      // 检查JSONL文件是否存在
      const fileExists = await this._checkFileExists(jsonlPath)
      if (!fileExists) {
        return null // 文件不存在
      }
      
      // 读取并解析JSONL文件
      const fileData = await this._readJsonlFile(jsonlPath)
      if (!fileData.lines || fileData.lines.length === 0) {
        return null
      }
      
      // 返回最后一条记录（最新状态）
      return fileData.lastRecord
    } catch (error) {
      logger.error(`获取文件信息失败 ${htmlFilePath}: ${error.message}`)
      return null
    }
  }

  /**
   * @description 清空指定HTML文件的处理记录
   * @param {string} htmlFilePath - HTML文件路径
   * @returns {Promise<boolean>} 是否成功清空
   */
  async clearFileMemory(htmlFilePath) {
    try {
      const absolutePath = this._getAbsolutePath(htmlFilePath)
      const jsonlPath = await this.resolveJsonlPathForHtml(absolutePath)
      
      // 删除JSONL文件
      await this._safeDeleteFile(jsonlPath)
      
      // 从内存中移除
      this.processedFiles.delete(absolutePath)
      this.fileMemoryMap.delete(absolutePath)
      
      logger.info(`已清空HTML文件记录: ${path.basename(htmlFilePath)}`)
      return true
    } catch (error) {
      logger.error(`清空文件记录失败: ${error.message}`)
      return false
    }
  }
  
  /**
   * @description 安全地删除文件，忽略文件不存在的错误
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} 是否成功删除
   * @private
   */
  async _safeDeleteFile(filePath) {
    try {
      await fs.unlink(filePath)
      logger.info(`已删除文件: ${path.basename(filePath)}`)
      return true
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 文件不存在，视为成功
        return true
      }
      // 其他错误则抛出
      throw error
    }
  }

  /**
   * @description 清空所有处理记录
   * @returns {Promise<boolean>} 是否成功清空
   */
  async clearAllMemories() {
    try {
      // 删除整个记忆目录
      await fs.rm(this.memoryDirectory, { recursive: true, force: true })
      
      // 重新创建空目录
      await this.initializeMemoryDirectory()
      
      // 清空内存记录
      this.processedFiles.clear()
      this.fileMemoryMap.clear()
      
      logger.info('已清空所有处理记录')
      return true
    } catch (error) {
      logger.error(`清空所有记录失败: ${error.message}`)
      return false
    }
  }
}

// 导出单例实例
export const htmlMemoryManager = new HtmlMemoryManager()

// 导出类以便需要时创建自定义实例
export { HtmlMemoryManager }
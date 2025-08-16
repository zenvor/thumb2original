import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'

/**
 * 中文注释：确保临时目录存在
 */
export async function ensureTempDir(tempDir) {
  const abs = path.resolve(tempDir)
  await fs.mkdir(abs, { recursive: true })
  return abs
}

/**
 * 中文注释：将 Buffer 写入临时文件，返回绝对路径
 */
export async function writeBufferToTemp(buffer, tempDir) {
  const dir = await ensureTempDir(tempDir)
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, buffer)
  return filePath
}

/**
 * 中文注释：从临时文件读取 Buffer
 */
export async function readBufferFromTemp(tempPath) {
  return await fs.readFile(tempPath)
}

/**
 * 中文注释：删除指定临时文件，忽略错误
 */
export async function removeTempFile(tempPath) {
  try { await fs.unlink(tempPath) } catch {}
}

/**
 * 中文注释：清理整个临时目录（谨慎使用）
 */
export async function cleanupTempDir(tempDir) {
  try {
    const abs = path.resolve(tempDir)
    const entries = await fs.readdir(abs)
    await Promise.all(entries.map((name) => fs.unlink(path.join(abs, name)).catch(() => {})))
  } catch (e) {
    logger.warn(`清理临时目录失败: ${e.message}`)
  }
}



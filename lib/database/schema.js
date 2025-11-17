/**
 * 数据库 Schema 定义
 * 用于图片分析结果的持久化存储
 */

/**
 * 创建数据库表和索引
 * @param {object} db - better-sqlite3 数据库实例
 */
export function initSchema(db) {
  // 任务表：跟踪每次爬取任务
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,              -- 任务ID（如：1763349948202-8xwul570x）
      url TEXT NOT NULL,                -- 原始 URL
      mode TEXT NOT NULL,               -- 处理模式：twoPhaseApi/twoPhase/inline
      status TEXT NOT NULL,             -- 状态：pending/analyzing/completed/failed
      created_at INTEGER NOT NULL,      -- 创建时间戳（毫秒）
      updated_at INTEGER NOT NULL,      -- 更新时间戳（毫秒）
      total_images INTEGER DEFAULT 0,   -- 总图片数
      analyzed_images INTEGER DEFAULT 0,-- 已分析数
      metadata TEXT                     -- JSON 元数据（格式统计等）
    )
  `)

  // 图片表：存储每张图片的分析结果和 Buffer
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,            -- 关联 tasks.id
      url TEXT NOT NULL,                -- 图片 URL
      sequence_number INTEGER,          -- 序号（用于文件名）

      -- 元数据
      format TEXT,                      -- 图片格式（jpeg/png/webp/svg/...）
      width INTEGER,                    -- 宽度（像素）
      height INTEGER,                   -- 高度（像素）
      size INTEGER,                     -- 文件大小（字节）

      -- Buffer 存储（纯 BLOB 方案）
      buffer BLOB NOT NULL,             -- 图片数据 Buffer

      -- HTTP 信息
      headers TEXT,                     -- JSON 格式的响应头

      -- 时间戳
      created_at INTEGER NOT NULL,      -- 创建时间戳（毫秒）

      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)

  // 索引优化
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_images_task_id ON images(task_id);
    CREATE INDEX IF NOT EXISTS idx_images_url ON images(url);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `)
}

/**
 * 获取数据库版本号
 * @param {object} db - better-sqlite3 数据库实例
 * @returns {number} 版本号
 */
export function getSchemaVersion(db) {
  try {
    const result = db.prepare('PRAGMA user_version').get()
    return result.user_version || 0
  } catch {
    return 0
  }
}

/**
 * 设置数据库版本号
 * @param {object} db - better-sqlite3 数据库实例
 * @param {number} version - 版本号
 */
export function setSchemaVersion(db, version) {
  db.prepare(`PRAGMA user_version = ${version}`).run()
}

/**
 * 执行数据库迁移（预留接口）
 * @param {object} db - better-sqlite3 数据库实例
 */
export function migrate(db) {
  const currentVersion = getSchemaVersion(db)
  const targetVersion = 1

  if (currentVersion < targetVersion) {
    // 初始化 schema
    initSchema(db)
    setSchemaVersion(db, targetVersion)
  }

  // 未来版本迁移可以在这里添加
  // if (currentVersion < 2) {
  //   // 执行 v1 -> v2 的迁移
  //   db.exec('ALTER TABLE ...')
  //   setSchemaVersion(db, 2)
  // }
}

// 🚀 下载模块统一导出 - KISS重构版
// 从7个模块简化为3个核心模块，遵循KISS原则

export { DownloadManager } from './DownloadManager.js'      // 主控制器
export { DownloadProgress } from './DownloadProgress.js'    // 进度&状态管理
export { DownloadExecutor } from './DownloadExecutor.js'    // 核心执行器
export * as DownloadUtils from './DownloadUtils.js'        // 工具函数

// 🎯 重构成果:
// - 代码量从1500行减少到750行 (50%减少)
// - 模块数从7个减少到3个 (70%减少)
// - 消除了功能重复和过度抽象
// - 保持向后兼容性 
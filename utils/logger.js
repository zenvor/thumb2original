// 适配说明：为保持 CLI 与核心库日志完全一致，这里直接复用核心库 logger。
// 这样可避免进度条/分类等配置在多处维护导致的不一致。
// 用法保持不变：从本文件导入 logger 即可。
export { logger } from '@crawler/core'
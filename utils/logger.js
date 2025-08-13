import pino from 'pino';
import logUpdate from 'log-update';
import fs from 'fs';
import path from 'path';
import { defaultLogConfig } from '../config/logConfig.js';

/**
 * @description 基于 Pino v9.7.0 的增强版日志记录器，提供文件日志、多种日志级别、分类和终端进度显示功能
 */

// 确保日志目录存在
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 日志分类常量
const LOG_CATEGORIES = {
  NETWORK: 'network',  // 网络请求相关
  DOWNLOAD: 'download', // 下载相关
  PROCESS: 'process',  // 处理过程相关
  SYSTEM: 'system'     // 系统相关
};

// 终端颜色代码
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

// 创建文件传输目标
const fileTransport = {
  target: 'pino/file',
  level: 'info',
  options: {
    destination: path.join(logsDir, `app-${new Date().toISOString().split('T')[0]}.log`),
    mkdir: true
  }
};

// 创建终端美化输出传输目标
const prettyTransport = {
  target: 'pino-pretty',
  level: 'info',
  options: { colorize: true }
};

// 组合传输目标
const transport = pino.transport({
  targets: [fileTransport]
});

// 创建 Pino 日志实例
const pinoLogger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: undefined, // 不包含默认的 pid 和主机名
  formatters: {
    level(label) {
      return { level: label };
    }
  }
}, transport);

// 进度模式相关状态
let isProgressMode = false;
let progressStates = []; // 用于存储多个层级的进度状态
let logBuffer = [];
let ringBuffer = []; // 用于终端显示的环形缓冲区
const RING_BUFFER_SIZE = 5;

// 日志配置状态
let logConfig = { ...defaultLogConfig };
let enabledCategories = [...defaultLogConfig.enabledCategories];

/**
 * @description 格式化时间戳
 * @returns {string} 格式化的时间字符串
 */
function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * @description 渲染多级进度条和日志
 */
function renderProgress() {
  if (!isProgressMode) return;

  const progressDisplay = progressStates.map((state, index) => {
    const { current = 0, total = 0, message = '' } = state || {};
    if (total === 0 && !message) return ''; // 如果没有总数和消息，则不显示该级别的进度条
    const percentage = total > 0 ? Math.floor((current / total) * 100) : 100;
    const barLength = 30;
    const filledLength = total > 0 ? Math.round(barLength * (percentage / 100)) : barLength;
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    const indent = '  '.repeat(index); // 根据层级缩进
    const progressCounter = total > 0 ? `${percentage}% (${current}/${total})` : '';
    return `${indent}${COLORS.cyan}进度: ${bar} ${progressCounter}${COLORS.reset} ${message}`;
  }).filter(Boolean).join('\n');

  const logs = ringBuffer.filter(Boolean).join('\n');

  const output = `${progressDisplay}\n\n--- 最近日志 ---\n${logs}`;
  logUpdate(output);
}

/**
 * @description 添加日志到环形缓冲区
 * @param {string} line - 日志行
 */
function pushToRingBuffer(line) {
  ringBuffer.push(line);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
  renderProgress();
}

/**
 * @description 通用日志输出函数
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {string} category - 日志分类
 * @param {string} color - 颜色代码
 */
function log(level, message, category = LOG_CATEGORIES.SYSTEM, color = COLORS.reset, meta) {
  // 检查分类是否启用
  if (!enabledCategories.includes(category)) {
    return;
  }
  
  // 构建日志对象，包含分类信息
  const logObject = { category, msg: message };
  if (meta && typeof meta === 'object') {
    Object.assign(logObject, meta);
  }
  
  // 写入文件日志
  pinoLogger[level](logObject);
  
  // 处理终端显示
  const timestamp = logConfig.showTimestamp ? `${COLORS.gray}[${getTimestamp()}]${COLORS.reset} ` : '';
  const levelDisplay = getColoredLevel(level, color);
  const categoryTag = category ? `${COLORS.gray}[${category}]${COLORS.reset} ` : '';
  const displayLine = `${timestamp}${levelDisplay} ${categoryTag}${message}`;
  
  if (isProgressMode) {
    // 进度模式下，添加到缓冲区并更新显示
    logBuffer.push(displayLine);
    pushToRingBuffer(displayLine);
  } else {
    // 非进度模式，直接输出到控制台
    console.log(displayLine);
  }
}

/**
 * @description 获取带颜色的日志级别显示
 * @param {string} level - 日志级别
 * @param {string} color - 颜色代码
 * @returns {string} 带颜色的日志级别
 */
function getColoredLevel(level, color) {
  return `${color}[${level.toUpperCase()}]${COLORS.reset}`;
}

// 导出日志接口
export const logger = {
  // 基础日志方法
  debug: (message, category = LOG_CATEGORIES.SYSTEM, meta) => 
    log('debug', message, category, COLORS.gray, meta),
  
  info: (message, category = LOG_CATEGORIES.SYSTEM, meta) => 
    log('info', message, category, COLORS.cyan, meta),
  
  success: (message, category = LOG_CATEGORIES.SYSTEM, meta) => 
    log('info', message, category, COLORS.green, meta),
  
  warn: (message, category = LOG_CATEGORIES.SYSTEM, meta) => 
    log('warn', message, category, COLORS.yellow, meta),
  
  error: (message, category = LOG_CATEGORIES.SYSTEM, meta) => 
    log('error', message, category, COLORS.red, meta),
  
  header: (message, category = LOG_CATEGORIES.SYSTEM, meta) => 
    log('info', message, category, `${COLORS.blue}${COLORS.bright}`, meta),
    
  // 网络相关日志快捷方法
  network: (message) => 
    log('info', message, LOG_CATEGORIES.NETWORK, COLORS.magenta),
    
  // 下载相关日志快捷方法
  download: (message) => 
    log('info', message, LOG_CATEGORIES.DOWNLOAD, COLORS.cyan),
    
  // 处理相关日志快捷方法
  process: (message) => 
    log('info', message, LOG_CATEGORIES.PROCESS, COLORS.blue),
  
  // 进度相关方法
  progress: (current, total, message = '', level = 0) => {
    // 如果配置禁用了进度显示，直接返回
    if (!logConfig.showDownloadProgress) {
      return;
    }
    
    if (!isProgressMode) {
      // 非进度模式下的简单回退实现
      const percentage = total > 0 ? Math.floor((current / total) * 100) : 0;
      process.stdout.write(`进度: ${percentage}% (${current}/${total})\r`);
      if (current === total) console.log();
      return;
    }

    // 更新指定层级的进度状态
    progressStates[level] = { current, total, message };

    // 清理更深层级的旧进度，避免混乱
    if (progressStates.length > level + 1) {
      progressStates.splice(level + 1);
    }
    renderProgress();
  },
  
  // 统计信息
  stats: (stats) => {
    const statsInfo = {
      successful: stats.successful || 0,
      failed: stats.failed || 0,
      total: stats.total || 0
    };
    
    // 记录到文件
    pinoLogger.info({ type: 'stats', stats: statsInfo });
    
    // 终端显示
    console.log(`\n${COLORS.bright}${COLORS.blue}=== 下载统计 ===${COLORS.reset}`);
    console.log(`${COLORS.green}✓ 成功: ${statsInfo.successful}${COLORS.reset}`);
    console.log(`${COLORS.red}✗ 失败: ${statsInfo.failed}${COLORS.reset}`);
    console.log(`${COLORS.cyan}📊 总计: ${statsInfo.total}${COLORS.reset}`);
    
    if (stats.failedUrls && stats.failedUrls.length > 0) {
      console.log(`${COLORS.yellow}失败的URL:${COLORS.reset}`);
      stats.failedUrls.forEach(url => console.log(`  ${COLORS.dim}${url}${COLORS.reset}`));
      
      // 记录失败URL到文件
      pinoLogger.warn({ type: 'failed_urls', urls: stats.failedUrls });
    }
    console.log();
  },
  
  // 配置方法
  setLevel: (level) => {
    if (typeof level === 'string') {
      pinoLogger.level = level.toLowerCase();
    }
  },
  
  getLevel: () => pinoLogger.level,
  
  // 日志分类常量
  categories: LOG_CATEGORIES,
  
  // 便捷方法
  separator: (char = '-', length = 50) => {
    const line = char.repeat(length);
    console.log(COLORS.gray + line + COLORS.reset);
    pinoLogger.info({ type: 'separator' });
  },
  
  clear: () => {
    console.clear();
  },

  // 进度模式控制
  startProgress: () => {
    // 检查配置是否允许显示进度条
    if (!logConfig.showDownloadProgress) {
      return;
    }
    if (isProgressMode) return;
    isProgressMode = true;
    logBuffer.length = 0;
    ringBuffer.length = 0;
    progressStates.length = 0;
    logUpdate.clear();
    pinoLogger.info({ type: 'progress_mode', status: 'started' });
  },

  stopProgress: () => {
    // 如果进度条被禁用，直接返回
    if (!logConfig.showDownloadProgress) {
      return;
    }
    if (!isProgressMode) return;
    isProgressMode = false;
    logUpdate.clear();
    logUpdate.done();
    
    // 打印所有缓冲的日志
    if (logBuffer.length > 0) {
      console.log('\n--- 任务期间日志 ---');
      console.log(logBuffer.join('\n'));
    }
    
    logBuffer.length = 0;
    ringBuffer.length = 0;
    progressStates.length = 0;
    pinoLogger.info({ type: 'progress_mode', status: 'stopped' });
  },
  
  // 配置管理方法
  initConfig: (userConfig = {}) => {
    // 合并用户配置与默认配置
    logConfig = { ...defaultLogConfig, ...userConfig };
    
    // 设置日志级别
    if (logConfig.logLevel) {
      pinoLogger.level = logConfig.logLevel.toLowerCase();
    }
    
    // 设置启用的日志分类
    enabledCategories = [...logConfig.enabledCategories];
    
    // 如果不显示详细的网络请求信息，禁用网络分类
    if (!logConfig.showDetailedNetworkInfo && enabledCategories.includes('network')) {
      enabledCategories = enabledCategories.filter(c => c !== 'network');
    }
    
    return logConfig;
  },
  
  // 获取当前配置
  getConfig: () => ({ ...logConfig }),
  
  // 启用/禁用分类的方法（保持向后兼容）
  enableCategories: (categories) => {
    if (Array.isArray(categories)) {
      enabledCategories = [...categories];
    }
  },
  
  disableCategory: (category) => {
    enabledCategories = enabledCategories.filter(c => c !== category);
  },
  
  enableCategory: (category) => {
    if (!enabledCategories.includes(category)) {
      enabledCategories.push(category);
    }
  },
  
  // 提供原始 pino 实例，以便高级用法
  pino: pinoLogger
};
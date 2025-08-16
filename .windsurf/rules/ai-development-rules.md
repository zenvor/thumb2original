---
trigger: model_decision
---

# AI 开发约束规则 - 避免逻辑复杂化

## 核心原则：KISS (Keep It Simple, Stupid)

### 🚫 禁止行为

1. **过度抽象**
   - 禁止为了"可能的需求"增加复杂性
   - 禁止创建超过 3 层的嵌套函数
   - 禁止使用复杂正则表达式除非确有必要

2. **复杂匹配逻辑**
   - 禁止使用带反向引用的正则 `/pattern\1/`，优先简单前缀匹配
   - 禁止一次性处理所有边界情况，分步简单处理
   - 禁止"一行代码解决所有问题"的写法

3. **过早优化**
   - 禁止在功能未验证前进行性能优化
   - 禁止引入第三方库来解决可以简单实现的问题
   - 禁止创建"通用框架"来处理具体问题

### ✅ 推荐行为

1. **简单直接**
   ```javascript
   // 好：直接前缀检查
   if (value.startsWith('url("http')) {
     return value.slice(5, -2)
   }
   
   // 坏：复杂正则匹配
   const match = value.match(/url\((["']?)([^"')]+)\1\)/i)
   ```

2. **分步处理**
   ```javascript
   // 好：分情况处理
   if (isDataUrl(value)) return handleDataUrl(value)
   if (isHttpUrl(value)) return handleHttpUrl(value)
   return null
   
   // 坏：一个函数处理所有情况
   return complexUrlParser(value, options)
   ```

3. **显式边界**
   ```javascript
   // 好：明确的条件检查
   if (!value || typeof value !== 'string') return null
   if (value.length < 10) return null
   
   // 坏：依赖复杂验证函数
   if (!isValidComplexInput(value)) return null
   ```

### 📋 代码审查检查点

1. **函数长度** - 单个函数不超过 30 行
2. **分支复杂度** - if/else 分支不超过 5 层
3. **参数数量** - 函数参数不超过 4 个
4. **正则复杂度** - 避免使用超过 20 个字符的正则表达式
5. **嵌套深度** - 代码嵌套不超过 3 层

### 🔍 问题识别信号

- 需要写注释解释复杂逻辑
- 单元测试难以编写
- 调试时需要多个断点才能理解流程
- 修改一处逻辑影响多个功能点
- 代码审查时需要反复解释实现原理

### 💡 重构策略

1. **复杂条件拆分**
   ```javascript
   // 重构前
   if (a && (b || c) && !d && validate(e)) { ... }
   
   // 重构后  
   const hasValidA = a
   const hasValidBC = b || c
   const isNotD = !d
   const isValidE = validate(e)
   if (hasValidA && hasValidBC && isNotD && isValidE) { ... }
   ```

2. **提取简单函数**
   ```javascript
   // 重构前：一个复杂函数
   function processUrl(url) {
     // 50 行复杂逻辑
   }
   
   // 重构后：多个简单函数
   function isDataUrl(url) { return url.startsWith('data:') }
   function extractDataUrl(url) { return url.slice(5) }
   function processUrl(url) {
     if (isDataUrl(url)) return extractDataUrl(url)
     // ...
   }
   ```

### 🎯 性能指标

- **代码行数减少** 30% 以上
- **函数数量增加** 但平均复杂度降低
- **bug 率降低** 50% 以上
- **开发效率提升** 可快速定位问题

### 📝 提交信息模板

```
refactor: 简化 [功能名] 实现，遵循 KISS 原则

- 替换复杂正则为直接前缀匹配
- 拆分 [大函数名] 为 3 个简单函数  
- 移除不必要的抽象层
- 提升 [性能指标] X 倍

遵循约束规则: avoid-complexity.md
```

---

**记住**：能用简单 if/else 解决的问题，不要用复杂算法。代码是写给人看的，不是写给机器炫技的。

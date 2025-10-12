## 通用开发规范

### 用户偏好

- 始终使用中文回复。
- 始终提供中文注释。
- 在创建提交信息时，遵循 Conventional Commits 规范生成 commit message。

### 代码风格

- 使用中文注释
- 采用 camelCase 命名（避免全大写）
- 优先保证代码简洁易维护
- 遵循 KISS 原则，避免过度设计

### ES Modules 模块规范

- **重要**: 本项目使用 ES modules 语法 (`"type": "module"`)
- 必须使用 `import/export` 语法，禁止使用 `require()` 和 `module.exports`
- 脚本文件需要使用 ES modules 语法：`import { execSync } from 'child_process'`
- 需要 `__dirname` 时使用：`import { fileURLToPath } from 'url'; const __dirname = path.dirname(fileURLToPath(import.meta.url));`

---

_此文档会随项目发展持续更新，请确保所有开发者都能访问到最新版本。_

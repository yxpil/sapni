# sapni 测试说明

Sapni — Self-Evolving AI Terminal Assistant。测试基于 Node.js 内置运行器 `node --test`，**只覆盖无重依赖的纯工具模块**，不需要安装 express/ink/react/puppeteer 等运行时依赖。

## 运行方式

```bash
npm test
```

测试文件为 `.cjs`（根 package.json 为 `"type":"module"`，Tools 子包为 commonjs），按 `tests/**/*.test.cjs` 匹配。

## 测了什么

测试目录：`tests/`
- `edit_tools.test.cjs` —— `edit_lines`（insert_before/after/replace/delete）、`read_lines`（行范围读取）、`search_in_range`（范围搜索），均在临时文件上验证主路径。
- `template.test.cjs` —— `use_template` 模板引擎：list 列模板、generate 缺名/不存在模板/非法 JSON 参数/未知 action 的错误分支。

### 边界 / 注入相关
- **行号越界防护**：`edit_lines` 行号超出文件范围返回 `[越界]` 且**不写盘**；未知操作返回错误。
- **文件不存在**：编辑/读取/搜索均先判 `existsSync`，返回 `[不存在]` 而非抛异常。
- **搜索大小写与截断**：忽略大小写可切换、`maxResults` 截断、无匹配返回提示。
- **模板参数注入**：非法 JSON `params` 被捕获并返回 `[失败]`，不进入 `generate`；未知 action 不崩溃。

> 本仓库的交互 UI 基于 ink/react（TUI），启动需完整依赖与 LLM API，不在本可跑绿套件内；未补 jsdom 钩子测试。

## 预期结果

```
# tests 7
# pass 7
# fail 0
```

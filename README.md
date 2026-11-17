# API Debugger

在 VS Code 里像 Postman 一样调试接口：图形化面板构造请求，请求由扩展宿主（Node）发出，因此没有 CORS、没有浏览器同源限制，可以直接访问 `localhost`、内网地址和任意 HTTP 方法。

## 功能

- 面板内完成 GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS 请求
- Params / Headers 表格编辑（支持勾选启用、批量编辑），Body 支持 `none` / `raw(JSON·XML·Text)` / `x-www-form-urlencoded` / `form-data`
- 响应展示状态码、耗时、大小、响应头；JSON 自动格式化并高亮；图片响应直接预览；超过 2MB 截断
- 变量占位符 `{{baseUrl}}`，配合环境（dev / test / prod）一键切换
- 请求历史与收藏集合写入工作区 `.api-debugger/`，随 Git 提交、可人工编辑
- 多标签编辑：历史、收藏与 cURL 导入都在新标签中打开，不会覆盖正在编辑的请求
- 支持从 cURL 命令导入请求，也可把当前请求导出（复制）为 cURL
- 请求可取消（面板内「取消」按钮），支持快捷键 `Ctrl+Enter` 发送

## 安装

- 在 VS Code 扩展视图搜索 `API Debugger`（发布者 `ID-wj`）
- 或命令行：`code --install-extension ID-wj.api-debugger`

## 使用

1. 点击活动栏的 API Debugger 图标，或命令面板执行 `API Debugger: Open Request Panel`
2. 选择方法、填写 URL（可含 `{{变量}}`），在 Params / Headers / Body 中补充内容
3. 点击「发送」或按 `Ctrl+Enter`，响应显示在下方
4. 「保存」把当前请求存入收藏集合；历史与收藏可在侧边栏查看，点击即可在新标签中打开

面板顶部是请求标签栏：`＋` 新建请求，标签右侧 `×`（或鼠标中键）关闭。每个标签独立保存请求、请求页签（Params / Headers / Body）、响应与加载状态，并发请求互不干扰。

### 环境与变量

在 `.api-debugger/environments.json` 中定义：

```json
{
  "globals": { "userAgent": "api-debugger" },
  "environments": [
    { "name": "dev", "variables": { "baseUrl": "http://localhost:8080", "token": "dev-token" } },
    { "name": "prod", "variables": { "baseUrl": "https://api.example.com", "token": "prod-token" } }
  ],
  "activeEnvironment": "dev"
}
```

变量解析优先级：环境变量 > 集合变量（预留给后续版本）> 全局变量。未解析的变量会保留原文，并在响应区提示具体变量名。

### cURL 导入 / 导出

- 面板工具栏的「cURL」按钮可打开对话框，「导入 cURL」粘贴命令后在新标签中打开（当前标签未编辑过时直接使用当前标签）；「导出 cURL」把当前标签生成单行命令，点「复制」即可在终端执行
- 支持 bash / zsh 的反斜杠续行、PowerShell 的反引号续行、Windows cmd 的 `^` 续行，以及单引号 / 双引号 / `$'...'` 三种引号写法
- 识别的常用选项：`-X/--request`、`-H/--header`、`-d/--data*`、`--json`、`-F/--form`、`-u/--user`、`-G/--get`、`-I/--head`、`--url`、`--url-query`；无法处理的内容（如 `@文件`）会提示并跳过
- `{{变量}}` 占位符在导入、导出两个方向都原样保留
- 命令面板另有 `API Debugger: Import from cURL`（自动读取剪贴板预填）与 `API Debugger: Export as cURL`；历史与收藏项右键菜单支持「Copy as cURL」

### 存储文件

| 文件 | 内容 |
| --- | --- |
| `.api-debugger/environments.json` | 全局变量、环境列表、当前激活环境 |
| `.api-debugger/collections.json` | 收藏的请求（按 `group` 分组） |
| `.api-debugger/history.json` | 请求历史（按 `method + url` 去重，默认最多 200 条） |

没有打开工作区时，文件写入扩展的全局存储目录。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `api-debugger.timeout` | `30000` | 单个请求超时时间（毫秒） |
| `api-debugger.followRedirects` | `true` | 是否自动跟随 3xx 重定向 |
| `api-debugger.maxHistory` | `200` | 历史记录条数上限 |
| `api-debugger.storageDir` | `.api-debugger` | 数据目录（相对工作区根目录） |

## 开发

```bash
npm install
npm run build     # 打包扩展（esbuild）+ 打包 Webview（vite）
npm run watch     # 同时监听两端，F5 启动扩展宿主后改代码需 Reload Window
npm test          # 变量解析 / 请求构造的单元测试
```

- 扩展端入口：`src/extension.ts`，打包到 `dist/extension.js`（`vscode` 为 external）
- Webview 端入口：`webview-ui/src/main.ts`，打包到 `dist/webview/assets/`
- 只想调 UI 样式时，在 `webview-ui` 下执行 `npx vite`，`bridge.ts` 会启用内置 mock，直接在浏览器里预览

## 架构说明

请求永远由扩展宿主发出（`src/services/httpClient.ts`），Webview 只负责渲染。

- 因此不存在 CORS、同源策略、混合内容限制，也不受浏览器 Cookie 策略影响
- Webview 页面本身被 CSP 限制为不可联网，脚本只允许带 nonce 的本地打包产物
- 代价是 Webview 内不能使用 VS Code 原生表单控件，UI 改动需 `Reload Window` 生效

## 已知限制

- 不支持上传文件（form-data 仅文本字段）
- 不支持自签名 / 私有 CA 证书（请求走 Node fetch 默认校验）
- `GET` / `HEAD` 请求不允许携带请求体，导入时 `-d` 数据会转为查询参数或被忽略
- 不支持请求前后脚本、Postman 集合导入、WebSocket / GraphQL，见后续规划

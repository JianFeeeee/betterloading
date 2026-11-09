# 让 betterloading 在 dsh 桌面端生效

**这份文档写给替用户执行改造的 dsh agent。** 目标读者不需要读本插件的源码，
需要的是：判断目标机器上能不能改、改哪里、怎么验证、什么时候该放弃。

如果你只是想装插件，看 [README](../README.zh.md)。本文只解决一件事：
**dsh 桌面端（Electron）里怎么让这层遮罩出现。**

---

## 0. 先确认到底需不需要做

依次执行，任一命中就**不要**往下做：

```bash
# ① 用户用的其实是桌面浏览器（宽屏）→ 插件已经正常工作，无需改造
#    判据：访问的是 http:// 或 https://，且 dsh --help 里只有 web
dsh --help | grep -E '^\s+dsh <profile>|profile:' 

# ② 安装里没有 Electron / 桌面端包 → 没有「桌面端」这个东西
ls /usr/lib/node_modules/@deepseek-ai | grep -iE 'desktop|electron' || echo "no desktop package"

# ③ 插件在 web 端都没跑起来 → 先修 web，别碰桌面端
curl -s "$DSH_WEB_URL/" | grep -c 'id="__bl"'   # 必须是 ≥1
```

三条都通过（确认是 Electron 应用、且 web 端正常）才继续。

---

## 1. 为什么默认不生效

web 端的遮罩靠 dsh 的官方注入点进入页面：

```
WebServer.renderIndex(html)
  = applyIndexTaps( renderIndexInjections(html, collectIndexInjections()) )
                                              ^ emit('webserver/index-inject')
```

`dsh-host-frontend-static` 在**每次返回 index 时**调用它，所以插件推的四行
（`style` / `html`×2 / `script`）会被插进 `<head>` 与 `<body>` 开头。

桌面端不走这条路：Electron 从 `dsh-app://app/` 读**打包好的 dist 产物**，
`renderIndex` 不被调用，注入行永远到不了文档。上游
`docs/subsystems/web-server` 的原话是：

> the server serves browsers only: Electron loads built files over `file://`
> and sends fetch requests through an IPC bridge, and does not use this server.

客户端 bundle 也帮不上忙：`dsh-client-modules` 会拒绝任何
`dsh.client.platform !== "web"` 的声明，桌面端不加载 `/plugins/…` bundle。

**所以只有两条路：改打包产物（A），或改 Electron 让它调用 `renderIndex`（B）。**

---


## 2. 端侧适配清单

先看这张表，再决定走哪条路线。**「必须」的三项缺一不可**，任一项没做，页面里都不会有遮罩。

| # | 适配项 | 类别 | 不做会怎样 |
|---|---|---|---|
| A1 | 注入行进入文档 | **必须** | 没有遮罩，什么都没发生 |
| A2 | CSP 放行内联脚本与 blob worker | **必须** | 有遮罩但不持动（worker 起不来，主脚本被拦） |
| A3 | 退出判定降级 | **必须** | 遮罩永不消失，或页面还空着就消失 |
| B1 | 设置页的替代方案 | 建议 | 只能改快照，改配置要重打补丁 |
| B2 | 主题跟随 | 通常自动 | 深色下仍用浅色磨砂 |
| B3 | 首帧层的价值 | 说明 | 无实际损失（桌面端加载快） |
| C1 | 客户端 bundle 分发 | **做不到** | 设置页、官方 phase 信号都拿不到 |

### A1. 注入行进入文档（必须）

插件通过 `webserver/index-inject` 产出四行：`style` / worker 源码 / 遮罩结构 / 主线程脚本。
Electron 不消费这张表，所以要把它「补进」文档。两条路：

- **路线 A**（改打包产物）：见下一节，用 `scripts/patch-desktop-index.mjs`
- **路线 B**（改 Electron）：让它调用 `renderIndex`

**判据**：控制台里 `document.getElementById('__bl')` 不是 `null`。

### A2. CSP 放行内联脚本与 blob worker（必须）

这一项最容易被漏掉，而且**失败是静默的**：遮罩出现了，但水面一动不动，因为脚本被 CSP 拦了。

插件需要两样东西：

```text
script-src  'unsafe-inline'        # 主线程脚本是内联 <script>
worker-src  blob:                  # 波动在 new Worker(URL.createObjectURL(blob)) 里跑
```

Electron 的默认 CSP 往往只留 `'self'`，于是：

- 内联主脚本被拦 → `window.__betterloading` 是 `undefined` → 水位永远 0
- `blob:` worker 被拦 → canvas 不画 → 没有波浪

**适配方式**（任一）：

1. 放宽 Electron 加载 index 时的 CSP（`Content-Security-Policy` meta 或响应头）
2. 给内联脚本加 `nonce`，并在 CSP 里声明 `'nonce-…'`（更严格，推荐）
3. 干脆把注入内容改成外部文件引用（`<script src>`），但这又要求 Electron 能服务那些文件

**判据**（三条都要）：

```js
typeof window.__betterloading          // "object"
document.getElementById('__bl').className  // 含 "__bl_live"（worker 首帧后挂上）
window.__blDiag.inFlight()             // 不报错（说明主脚本完整执行了）
```

若 `__bl` 在但没有 `__bl_live`，基本可以断定 worker 被 CSP 拦了。控制台会有
`Refused to create a worker from 'blob:…'`。

### A3. 退出判定降级（必须）

web 端的退出靠两个官方信号：`sessions.list.phase` 与 `workspaces.list.phase` 都变成
`ready`。桌面端没有客户端 bundle，这两个信号**拿不到**，只剩下静态层兜底：

```text
#root 有子节点  +  没有在飞请求  +  资源静默 800ms  +  壳子挂上后稳定一段时间
```

这套在桌面端通常够用（本地文件加载很快），但两种情况要手动调：

| 现象 | 处理 |
|---|---|
| 内容多、数据请求慢，遮罩提前撤掉 | 调大 `idleTimeoutMs`（默认 60000，上限 180000） |
| 页面一直不出内容，遮罩一直挂着 | 这是**对的**行为，等 idle 超时（60s 无网络活动）或用户自行刷新 |

注意桌面端**拿不到设置页**（见 C1），所以这些值要在打补丁时写进快照。

**判据**：加载完成后 `#__bl` 从 DOM 消失，且页面里的侧栏、会话列表是完整的
（不是只有一个空壳）。

### B1. 设置页的替代方案（建议）

配置页走的是客户端 slot `plugins.bundle.config`，桌面端不加载客户端 bundle，
所以**桌面端没有设置页**。可选做法：

1. **改快照**（最省事）：在 web 端调好配置 → 重新抓 index → 重新打补丁。
   插件的 `configure()` 会把快照里的值当作初始值。
2. **写进 HTML**：手工改注入的 `<style>` 里 `--bl-tint` 等变量。
3. **自建设置页**：改 Electron 提供原生界面，工作量最大。

### B2. 主题跟随（通常自动）

插件靠 `body[data-ds-dark-theme]` 判断深浅色，这是 dsh 前端自己维护的属性，
桌面端用的是同一套前端产物，**通常无需适配**。

需要核对的是：Electron 的系统主题切换是否也会更新这个属性。若不更新，
深色系统下会显示浅色磨砂。

**判据**：系统切到深色后，`document.body.getAttribute('data-ds-dark-theme')` 变成
`""`（属性存在、值为空），且磨砂底色变成 `rgba(12,15,22,.52)` 附近。

### B3. 首帧层的价值（说明，无需动作）

web 端的首帧层（隐藏自带启动屏 + 完整遮罩 + 纯 CSS 波）是为了覆盖「HTML 到了但
bundle 还在路上」那段空窗。桌面端从本地读文件，这段窗口极短，所以首帧层的意义
不大——但也不会造成问题，可以照原样保留。

### C1. 客户端 bundle 分发（做不到，需上游）

这一项**无法在端侧适配**，必须知道原因，否则会一直往错的方向试：

```js
// @deepseek-ai/dsh-client-modules (host 侧)
if (decl === void 0 || decl.platform !== "web") { ...; return null }   // 不分发
```

- 客户端 bundle 是通过 `/plugins/??…` 由 **web host** 动态拼接的
- 桌面端从 `dsh-app://app/` 读打包产物，不经过 web host
- 而且 host 侧的过滤只认 `"web"`，没有 `"desktop"` / `"electron"` 这种值

结论：**设置页、`configForms` 配置桥、`sessions/workspaces` 的 ready 信号，
在桌面端一个都用不上。** 桌面端只能靠快照 + 静态层兜底。

要真正支持，需要上游拆开「平台」这个概念（例如允许 `platform: "desktop"` 并让
Electron 取 bundle），然后插件这边把渲染层做成「有客户端能力时用官方 slot，
没有时退化成注入脚本」的两条路径。

## 3. 路线 A：把注入内容写进打包的 index.html（推荐先试）

不碰 Electron 代码，只改它读的那份 `index.html`。代价是**配置被快照固定**
（设置页在桌面端仍然不可用），升级 dsh Desktop 后要重做。

### 3-1. 定位桌面端产物

```bash
# 常见位置，按命中取第一个
find / -name 'app.asar' -path '*dsh*' 2>/dev/null
find / -name 'index.html' -path '*dsh*app*' 2>/dev/null
ls "$HOME/.config/dsh-desktop" 2>/dev/null
```

拿到 `app.asar` 后解包（`npm i -g @electron/asar` 或 `npx @electron/asar`）：

```bash
npx @electron/asar extract /path/to/app.asar /tmp/dsh-app
# 找到里面装 Web 前端的目录，通常含 assets/index-*.js 与 index.html
find /tmp/dsh-app -name 'index.html' -not -path '*node_modules*'
```

如果 `app.asar` **被签名或完整性校验**拦住（Electron 的
`asar integrity` / `electron-builder` 的 `asarUnpack` + 签名），先看第 4 节
的「放弃条件」。

### 3-2. 从这台机器上跑着的 web 端抓一份快照

改造内容必须来自**同一版本的 dsh + 同一版本的插件**，否则 worker 协议会错配。

```bash
# 取当前 web 端 index（需要已登录的 cookie 或 token）
curl -s -b cookies.txt "$DSH_WEB_URL/" -o /tmp/web-index.html

# 确认快照里确实有注入
grep -c 'id="__bl"' /tmp/web-index.html   # 必须 ≥1
```

如果没有正在运行的 web 实例：临时起一个

```bash
dsh web    # 另一个终端；它会打印带 token 的 URL
```

### 3-3. 打补丁

```bash
# 只预览会插入什么
node scripts/patch-desktop-index.mjs --snapshot /tmp/web-index.html --print

# 就地写回桌面端产物
node scripts/patch-desktop-index.mjs \
  --snapshot /tmp/web-index.html \
  --target   /tmp/dsh-app/<…>/index.html \
  --out      /tmp/dsh-app/<…>/index.html
```

脚本做的事：

- 从快照里抠出四段（样式 / worker 源码 / 遮罩结构 / 主线程脚本）
- 用 `<!-- betterloading:head -->` 与 `<!-- betterloading:body -->` 注释包住，
  插到 `<head>` / `<body>` 之后（顺序与 web 端一致，**worker 必须在主脚本之前**）
- **幂等**：反复执行结果逐字节一致，已存在的手工注入也会被清掉

### 3-4. 重新打包并启动

```bash
npx @electron/asar pack /tmp/dsh-app /path/to/app.asar
# 恢复签名（若原包有签名），然后启动桌面端
```

### 3-5. 验证（缺一不可）

打开桌面端，在开发者工具控制台里：

```js
document.getElementById('__bl')                      // 遮罩节点在 → 注入生效
typeof window.__betterloading                        // "object" → 主线程脚本跑了
!!document.getElementById('__bl_wsrc')               // true → worker 源码在
typeof window.__blDiag                               // "object" → 波动在算
```

然后看加载过程：水面随资源/会话推进上升；加载完成后 `#__bl` 应被移除、
页面露出完整侧栏与会话列表。若 `#__bl` 一直在，见第 5 节排错。

也可以离线先验一遍 HTML 结构：

```bash
grep -c 'id="__bl"'                 <patched-index.html>   # 1
grep -c 'id="__bl_wsrc"'            <patched-index.html>   # 1
grep -c '#__bl{position:fixed'      <patched-index.html>   # 1
```

---

## 4. 路线 B：让 Electron 消费 `index-inject`（配置可变，但要改代码）

如果用户希望**设置页改完立刻生效**、或者不想每次升级都重做，就得让 Electron
在返回 index 时调用 web 端同一个入口。

### 4-1. 找到桌面端的 index 供给点

在解包后的 `app.asar` 里搜：

```bash
grep -rn "dsh-app" /tmp/dsh-app --include=*.js -l | head
grep -rn "protocol.handle\|registerFileProtocol\|registerBufferProtocol" /tmp/dsh-app --include=*.js
grep -rn "index.html" /tmp/dsh-app --include=*.js | grep -v node_modules | head
```

你要找的是那个**读出 `dist/index.html` 文本并交给协议响应**的函数。

### 4-2. 在它返回前插入一次 `renderIndex`

改造的语义等价于 web 端的这一行（`dsh-host-frontend-static`）：

```js
// 读文件 → 过一遍 WebServer 的注入管线 → 返回
const html = await ctx.webServer.renderIndex(rawIndexHtml);
```

桌面端里 `ctx.webServer` 是否存在，取决于它是否真的挂着
`@deepseek-ai/dsh-host-webserver`。先确认：

```bash
grep -rn "dsh-host-webserver" /tmp/dsh-app --include=package.json | head
```

- **存在**：在主进程里拿到那个 `ctx`（同进程直接引用，或经由已有 IPC 通道），
  在响应前调用 `ctx.webServer.renderIndex(html)`。建议加开关
  （环境变量或设置项），避免影响其他用户。
- **不存在**：改为在主进程里**直接消费同一个事件表**。`renderIndexInjections`
  是纯函数，可从 `@deepseek-ai/dsh-host-webserver` 引入：

  ```js
  import { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver'

  const rows = []
  someCtx.emit('webserver/index-inject', rows)   // 需要能拿到 Cordis ctx
  const html = renderIndexInjections(rawIndexHtml, rows)
  ```

  若拿不到 `ctx`（Electron 主进程与 harness 分处不同进程），就必须
  走 IPC 让 harness 侧算好再回传，或者退回路线 A。

### 4-3. 验证

同 3-5。额外确认**动态生效**：

```bash
# 改一个配置（例如 glowColor），不改 index，重启桌面端后应看到新颜色
```

---

## 5. 什么时候该停下来

出现以下任一情况，**如实告诉用户做不到**，不要硬改：

| 情况 | 判据 | 原因 |
|---|---|---|
| asar 有完整性校验/代码签名 | `npx @electron/asar extract` 成功但启动报 `Integrity check failed` | 改了会被拒载，除非同时重签（多数用户没有证书） |
| 桌面端不加载 dist 里的 `index.html` | 打包产物里搜不到 `index.html`，或页面由运行时拼字符串生成 | 没有稳定的注入点 |
| 桌面端与 harness 跨进程且无 IPC 通道 | 4-2 里 `ctx` 拿不到，且没有现成 IPC | 无法在渲染前拿到注入行 |
| 用户不接受升级后重做 | — | 路线 A 的快照会随 dsh/插件升级失效（worker 协议可能变） |

另外两种情况请**明确告知**，它们不是缺陷：

- **设置页在桌面端不可用。** 设置页走的是 web 客户端 bundle
  （`plugins.bundle.config` slot），而 `dsh.client.platform` 只接受 `"web"`。
  桌面端只能用快照里的那份配置。
- **升级即失效。** dsh Desktop 升级会替换整个 `app.asar`，路线 A 的改动随之消失；
  路线 B 也会被覆盖，需要重打补丁。

---

## 6. 排错

按现象对号入座。

**页面里没有 `#__bl`**
- `grep -c 'id="__bl"' index.html`：0 说明补丁没写进去（检查 `--out` 路径是否被 asar 缓存）
- 写进去了但页面没有：Electron 加载的是另一份 index（缓存 / 另一处 dist）。
  用开发者工具看 `document.baseURI`，据此反查真实文件。

**有 `#__bl` 但不动**
- `typeof window.__betterloading` 不是 `"object"` → 主线程脚本没执行：
  多半是被 CSP 拦了（`script-src`），看控制台的 CSP 报错。
- `#__bl_wsrc` 不存在 → worker 段没插进去，或插在了主脚本**之后**（顺序错了。
  脚本用 `getElementById('__bl_wsrc').textContent` 取源码，必须先有它）。

**水面在涨但遮罩不消失**
- 桌面端拿不到 `sessions` / `workspaces` 的 ready 边沿时，靠 12s 兜底退出；
  若 12s 后仍在，说明主脚本的定时器没跑（同上，查 CSP / 异常）。
- 控制台若报 `ReferenceError`，把报错原文带回给插件维护者——这类问题通常
  是 dsh 版本变化导致注入脚本引用了不存在的接口。

**两层水面同时出现**
- `#__bl` 缺 `__bl_live` 这个 class。正常流程是 worker 画出第一帧后挂上它，
  纯 CSS 假波随之淡出。若一直缺失，说明 worker 没启动（先查上一条）。

**升级 dsh Desktop 之后失效**
- 预期行为。重做路线 3-1 到 3-4，并**重新抓快照**（插件若有版本变化，
  旧快照的 worker 协议可能不匹配）。

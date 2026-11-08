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

## 2. 路线 A：把注入内容写进打包的 index.html（推荐先试）

不碰 Electron 代码，只改它读的那份 `index.html`。代价是**配置被快照固定**
（设置页在桌面端仍然不可用），升级 dsh Desktop 后要重做。

### A-1. 定位桌面端产物

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

### A-2. 从这台机器上跑着的 web 端抓一份快照

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

### A-3. 打补丁

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

### A-4. 重新打包并启动

```bash
npx @electron/asar pack /tmp/dsh-app /path/to/app.asar
# 恢复签名（若原包有签名），然后启动桌面端
```

### A-5. 验证（缺一不可）

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

## 3. 路线 B：让 Electron 消费 `index-inject`（配置可变，但要改代码）

如果用户希望**设置页改完立刻生效**、或者不想每次升级都重做，就得让 Electron
在返回 index 时调用 web 端同一个入口。

### B-1. 找到桌面端的 index 供给点

在解包后的 `app.asar` 里搜：

```bash
grep -rn "dsh-app" /tmp/dsh-app --include=*.js -l | head
grep -rn "protocol.handle\|registerFileProtocol\|registerBufferProtocol" /tmp/dsh-app --include=*.js
grep -rn "index.html" /tmp/dsh-app --include=*.js | grep -v node_modules | head
```

你要找的是那个**读出 `dist/index.html` 文本并交给协议响应**的函数。

### B-2. 在它返回前插入一次 `renderIndex`

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

### B-3. 验证

同 A-5。额外确认**动态生效**：

```bash
# 改一个配置（例如 glowColor），不改 index，重启桌面端后应看到新颜色
```

---

## 4. 什么时候该停下来

出现以下任一情况，**如实告诉用户做不到**，不要硬改：

| 情况 | 判据 | 原因 |
|---|---|---|
| asar 有完整性校验/代码签名 | `npx @electron/asar extract` 成功但启动报 `Integrity check failed` | 改了会被拒载，除非同时重签（多数用户没有证书） |
| 桌面端不加载 dist 里的 `index.html` | 打包产物里搜不到 `index.html`，或页面由运行时拼字符串生成 | 没有稳定的注入点 |
| 桌面端与 harness 跨进程且无 IPC 通道 | B-2 里 `ctx` 拿不到，且没有现成 IPC | 无法在渲染前拿到注入行 |
| 用户不接受升级后重做 | — | 路线 A 的快照会随 dsh/插件升级失效（worker 协议可能变） |

另外两种情况请**明确告知**，它们不是缺陷：

- **设置页在桌面端不可用。** 设置页走的是 web 客户端 bundle
  （`plugins.bundle.config` slot），而 `dsh.client.platform` 只接受 `"web"`。
  桌面端只能用快照里的那份配置。
- **升级即失效。** dsh Desktop 升级会替换整个 `app.asar`，路线 A 的改动随之消失；
  路线 B 也会被覆盖，需要重打补丁。

---

## 5. 排错

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
- 预期行为。重做路线 A-1 到 A-4，并**重新抓快照**（插件若有版本变化，
  旧快照的 worker 协议可能不匹配）。

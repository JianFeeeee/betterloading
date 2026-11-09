# 桌面端（DeepSeek Harness Desktop）

**这份文档写给替用户排查/适配的 agent。** 结论先行：

> **桌面端不需要改 Electron，也不需要改打包产物。**
> 它本身就是一个 Electron 壳，内嵌一个 `dsh web`，然后 `loadURL` 那个
> web server —— 所以 `webserver/index-inject` 这条路本来就走得通。
> 要适配的只有插件内部的两个 API 差异：注入用旧签名、`configForms` 不能
> 写进必需的 `inject`。

本文档记录的是**实测**结果（runtime 0.1.0-rc.6 + 桌面端 v0.5.0），不是推测。

---

## 1. 桌面端到底是什么

从 `deepseek-harness-desktop@0.4.1`（启动器）+ GitHub Releases 的 AppImage 解包得到：

```
squashfs-root/
  deepseek-harness-desktop          Electron 主程序
  resources/app.asar                主进程代码（main/main.js 637 行）
```

`main/main.js` 的关键两处：

```js
// 531 行附近：启动内嵌服务端
args: [...runtime.prefixArgs, 'web', '--host', DSH_HOST, '--port', String(port)]

// 427 行：窗口加载的就是那个 web server
mainWindow.loadURL(serverUrl)
```

`webPreferences` 是 `nodeIntegration: false, contextIsolation: true, sandbox: true`
—— 就是一个普通浏览器窗口。

**所以不存在 `dsh-app://` 协议，也没有「Electron 只读打包产物」这回事。**
（本仓库早期版本的 README 曾按上游 `docs/subsystems/web-server` 的描述写过
「Desktop 从 `dsh-app://app/` 加载」——那是另一个部署形态，不适用于这个桌面壳。）

### 它用哪个 runtime（重要）

`runtime-manager.js` 的优先级：

```js
// Priority: DSH_BIN -> machine dsh -> verified managed cache -> download
if (env.DSH_BIN)      → 用它
findInstalledDsh()    → PATH / nvm / ~/.local/bin 里的 dsh
verified cache        → 之前下载过的
download              → dsh-runtime-<钉死版本>.tar.gz
```

**但这台机器上的实测结果是**：用机器里装的 0.2.1-rc.2 时，桌面端**打不开**：

```
dsh web authentication required; reopen the URL printed by dsh web.
（HTTP 401）
```

原因在桌面壳自己：它只按 `http://host:port` 探测就绪（`waitForServer` 要求
200 + `text/html`），而 dsh ≥ 0.2 的 web server 会打印一条**带 token** 的 URL，
未授权时对 `/` 返回 401。桌面端没去取那个 token，所以永远等不到 200。

所以实际可用矩阵是：

| 组合 | 结果 |
|---|---|
| 桌面端 + 它钉死的 runtime（实测 0.1.0-rc.6） | ✅ 可用（注入、动效、收工全部验证过） |
| 桌面端 + 机器里装的 dsh 0.2.1-rc.2 | ❌ 401，窗口白屏 |

想让桌面端用新版 dsh（从而拿到设置页），必须补上 token：见 §6。

### 版本矩阵（重要）

| | 本机 web 部署 | 桌面端内嵌 runtime |
|---|---|---|
| dsh 版本 | 0.2.1-rc.2 | **0.1.0-rc.6** |
| `webserver/index-inject` 事件 | 有 | **没有** |
| `webServer.tapIndex(fn)` | 有 | **有** |
| `Config.volatile()` / `settings.configure` | 有 | **没有** |
| `plugins.bundle.config`（设置页 slot） | 有 | **没有**（连 plugin-manager 客户端包都没有） |
| `configForms` 客户端服务 | 有 | **没有** |

桌面端的 runtime 由 AppImage 的 `package.json` 钉死：

```json
{ "deepseekHarness": { "runtimeVersion": "0.1.0-rc.6" } }
```

它跟随桌面端发版，不跟随本机 `npm i -g dsh` 的版本。

---

## 2. 需要适配的两个点

### 2.1 注入 API：`tapIndex` 而不是事件表

旧版只有字符串变换：

```js
// @deepseek-ai/dsh-host-webserver (0.1.0-rc.6)
tapIndex(transform) {          // transform: html => html
  this.indexTaps.push(transform)
  return () => { /* 移除 */ }
}
```

新版才有事件表。插件里现在按能力分支（`index.js`）：

```js
const server = webCtx.webServer || webCtx;
if (typeof server.tapIndex === "function") {
  return server.tapIndex((html) => injectRows(html, rows));   // 旧版
}
return webCtx.on("webserver/index-inject", (table) => {        // 新版
  for (const row of rows) table.push(row);
});
```

`injectRows()` 必须对齐新版 `renderIndexInjections` 的语义，否则注入位置会错：

| 行 kind | 落点 |
|---|---|
| `style` | **强制 `head`**（不看 `row.placement`） |
| `html` | `row.placement`（本插件是 `body`） |
| `script` | `row.placement`（本插件是 `body`） |
| — | body 行之后追加 `__DSH_BOOT_READY__` 的 resolve 尾部脚本 |

**顺序**：worker 源码 → 遮罩结构 → 主线程脚本。主脚本靠
`getElementById('__bl_wsrc').textContent` 取 worker 源码，顺序错了 worker 起不来。

### 2.2 `configForms` 不能写进必需的 `inject`

```js
// ✗ 错：旧版没有这个服务 → 整个客户端插件永远 pending
exports.inject = ["slots", "locale", "configForms"];

// ✓ 对：只声明一定存在的，其余按需注入
exports.inject = ["slots", "locale"];
ctx.inject(["configForms"], (formsCtx) => { /* 设置页、配置桥 */ });
```

写错的症状（实测截图里就是这条）：

```
web boot: 1 entry did not activate dsh-betterloading:
pending (waiting for service: configForms)
```

页面顶部还会出现 `Failed to load plugins` 横幅。**遮罩本身仍然工作**
（注入是 host 侧的事），但客户端那一半整个不激活。

---

## 3. 怎么验证（不需要真的开桌面端）

桌面端的 runtime 可以单独跑，等价于它内嵌的那个服务端：

```bash
# 1) 拿 AppImage 并解包（不需要 FUSE）
curl -L -o app.AppImage \
  "https://github.com/hzhe0083-source/deepseek-harness-desktop/releases/download/v0.5.0/DeepSeek-Harness-Desktop-0.5.0-linux-x86_64.AppImage"
chmod +x app.AppImage && ./app.AppImage --appimage-extract

# 2) 拿它钉死的那个 runtime
curl -L -o rt.tar.gz \
  "https://github.com/hzhe0083-source/deepseek-harness-desktop/releases/download/v0.5.0/dsh-runtime-0.1.0-rc.6-linux-x64.tar.gz"
mkdir rt && tar xzf rt.tar.gz -C rt
node rt/dsh/lib/bin.js --version        # 0.1.0-rc.6

# 3) 用一个独立的 DSH_HOME 装插件（别污染用户的 ~/.dsh）
export DSH_HOME=/tmp/desk-test-home
node rt/dsh/lib/bin.js plugin --profile web add /path/to/betterloading

# 4) 起服务端（等价于桌面端内嵌的那个）
node rt/dsh/lib/bin.js web --host 127.0.0.1 --port 3099
```

**验收判据**（四条全中才算通）：

```bash
# a) 注入行到了文档里
curl -s http://127.0.0.1:3099/ > idx.html
grep -c 'id="__bl"' idx.html            # 1
grep -c 'id="__bl_wsrc"' idx.html       # 1
grep -c '#__bl{position:fixed' idx.html # 1

# b) style 在 head 里，worker 在 body 开头
python3 - <<'PY'
s = open('idx.html').read()
assert s.find('#__bl{') < s.find('</head>'), 'style 没进 head'
assert s.find('<body') < s.find('__bl_wsrc') < s.find('<div id="__bl"'), '顺序错'
PY
```

```js
// c) 浏览器里（或 devtools console）
typeof window.__betterloading        // "object"
document.getElementById('__bl').className   // 含 "__bl_live"（worker 画了第一帧）
window.__blDiag.level()              // 0..1，随加载上涨
```

**d) 服务端日志里不能有** `did not activate ... waiting for service`。

实测结果（runtime 0.1.0-rc.6）：

```
overlay: True     api: object     live: __bl_live __done
status : Ready    diag: level=82.5    （收工前）
```

页面侧栏正常渲染、无 `Failed to load plugins` 横幅、遮罩按预期收工移除。

---

## 4. 桌面端上**没有**的能力（不是缺陷）

| 能力 | 桌面端 | 原因 |
|---|---|---|
| 设置页 | ✗ | 走客户端 slot `plugins.bundle.config`，需要 `dsh-client-ui-plugin-manager`，旧 runtime 没有这个包 |
| 配置热更新 | ✗ | 依赖 `configForms` 客户端服务；旧版没有 |
| 按设置页改配置 | ✗ | 只能改插件目录里的 schema 默认值，或改 profile 的 `cordis.patch.yml` |

配置的替代做法（按成本排序）：

1. 改 `/path/to/betterloading/index.js` 里 schema 的 `.default(...)`
2. 在 profile 的 `cordis.patch.yml` 里给这一行加配置（旧版 loader 也认 `export const Config`）
3. 等桌面端把 runtime 升到 0.2.x

---

## 5. 什么时候会失效

| 触发 | 结果 | 处理 |
|---|---|---|
| 桌面端升级，runtime 换了版本 | 可能新 API 全都有 / 或又变 | 重跑第 3 节，看四条判据 |
| dsh 把 `tapIndex` 删掉 | 注入失效（`#__bl` 不出现） | 改成只用事件表 |
| 插件把 `configForms` 写回必需 `inject` | 客户端插件 pending、页面顶部报错 | 见 2.2 |
| 用户在桌面端里又装了别的会改 index 的插件 | 注入顺序可能互相影响 | 各自独立 `tapIndex`，后注册的在外层 |

**排查顺序**（省时间）：

1. `curl` 服务端 index，`grep __bl` —— 没有就是注入没生效（看 2.1）
2. 有 `#__bl` 但不动 —— 看控制台有没有 `Refused to create a worker from 'blob:'`，或 `window.__betterloading` 是不是 `undefined`
3. 有 `__bl_live` 但页面顶部报 `did not activate` —— 看 2.2
4. 一切正常但收工太早/太晚 —— 调 `idleTimeoutMs`（旧版没有设置页，见第 4 节）

## 6. 可选：让桌面端用新版 dsh（换取设置页）

新版 dsh 需要 token，而桌面壳不取。补丁很小，改 `app/main/main.js`：

```js
// 1) 抓子进程 stdout 里那条带 token 的 URL
proc.stdout.on('data', (chunk) => {
  appendLog(chunk)
  const found = /dsh web: (http:\/\/[^\s"'`]+?\?token=[A-Za-z0-9_-]+)/.exec(String(chunk))
  if (found) authorizedUrl = found[1]
})

// 2) 探测与加载都用它
if (authorizedUrl) serverUrl = authorizedUrl
await waitForServer(serverUrl, timeoutMs)
mainWindow.loadURL(serverUrl)
```

**状态：这段补丁我写了，但没能在当前执行环境里跑通验证** —— 后台常驻的
Electron 进程会被这个环境的工具回收（`exit 137`），窗口起不来。所以：

- 补丁思路基于 `e2.log` 里实测到的 401 与 dsh 的启动横幅，逻辑上是成立的
- 但「改完之后窗口真的能打开」这一步**没有验证过**，不要当成已验证结论

如果要做，建议：在本机手动跑一次 `dsh web`，确认横幅里确实有
`?token=...`，再照上面两行改，然后看窗口是否落在 200 上。

# 桌面端（DeepSeek Harness Desktop）

**这份文档写给替用户排查/适配的 agent。** 结论先行：

> **官方桌面端不需要任何适配。**
> 它是一个 Electron 壳，内嵌一个 Host（跑 `dsh` 的 profile runner），
> 而 Host 会把 `webserver/index-inject` 的注入表**通过 Node IPC** 交给
> Electron，由 `dsh-app://app/` 的引导页应用。插件订阅的是同一个事件，
> 所以在桌面端和在浏览器里走的是同一条路。
>
> **只有第三方壳需要适配**（它们往往钉死一个很旧的 dsh，连
> `webserver/index-inject` 都没有）。区别见 §3。

---

## 1. 官方桌面端是什么

仓库里的 `apps/desktop`（`@deepseek-ai/dsh-desktop`）+ `apps/desktop-host`。
官方 `apps/desktop/README.md` 的原话：

> The desktop application is an Electron shell around the complete dsh Web
> application. An Electron RunAsNode child starts the shared profile runner, and
> Electron immediately loads the packaged Web entry at `dsh-app://app/`. Its
> shared loading page waits for **Host boot injections**, then starts the client
> without navigating to another document. Electron forwards application HTTP
> requests to the authenticated Web Host… **Node IPC carries boot injections,
> readiness, and shutdown.**

对应的实现（`apps/desktop-host/src/index.ts`）：

```js
process.send?.({
  type: 'ready',
  url,
  injections: ctx.webServer.collectIndexInjections(ctx.connection.browserPeer),
})
```

`collectIndexInjections()` 就是 `emit('webserver/index-inject')` 并收集行。
Electron 侧在 `host-process.ts` 收到 `{url, injections}`，交给引导页。

### 版本跟随

官方桌面端的 `package.json` 是全 `workspace:*` 依赖，版本 `0.2.2-rc.1`，
与核心 monorepo 同步发布：

```json
{ "name": "@deepseek-ai/dsh-desktop", "version": "0.2.2-rc.1",
  "dependencies": { "@deepseek-ai/dsh-api-gateway": "workspace:*", … } }
```

所以它**总是带着当前核心的 API 集合**：`webserver/index-inject`、
`configForms`、`plugins.bundle.config` 全都在 —— 插件的设置页在官方桌面端
同样可用。

### 下载

官网 `https://www.deepseek.com/download/`，资产只有两个（没有 Linux）：

```
https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe
https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg
```

**官方桌面端不需要打补丁、不需要改 index、不需要改 CSP。** 装好、装插件、
重启即可。

---

## 2. 在插件这一侧要保证什么

官方桌面端零适配 ≠ 插件可以乱写。有三条是**跨平台通用**的硬约束，桌面端上
同样是它们先出问题：

| 约束 | 原因 | 症状 |
|---|---|---|
| `Config` 字段全部 `.volatile()` | 设置页表单只投影 volatile 字段 | 设置页空白 |
| `configForms` 不进必需 `inject` | 旧部署没有这个服务会让插件 pending | `did not activate … waiting for service` |
| 注入行顺序：worker → 遮罩 → 主脚本 | 主脚本靠 `getElementById('__bl_wsrc').textContent` 取 worker 源码 | 遮罩在但水面不动 |

前两条与桌面端无关，是版本兼容；第三条在两个平台都成立。

---

## 3. 第三方壳：需要适配，且是另一套问题

社区壳（例如 `deepseek-harness-desktop`，GitHub `hzhe0083-source/…`）不走 IPC，
而是**在本地起一个 `dsh web` 然后 `loadURL` 它**：

```js
args: [...runtime.prefixArgs, 'web', '--host', DSH_HOST, '--port', String(port)]
mainWindow.loadURL(serverUrl)
```

看起来更简单，但它有两个坑，实测（v0.5.0）如下。

### 3.1 它钉死一个很旧的 runtime

`package.json` 里 `deepseekHarness.runtimeVersion: "0.1.0-rc.6"`，Release 资产里
只有 `dsh-runtime-0.1.0-rc.6-*.tar.gz`。那个版本：

| API | 0.1.0-rc.6 | 说明 |
|---|---|---|
| `webserver/index-inject` 事件 | ✗ | 只有 `webServer.tapIndex(html => html)` |
| `Config.volatile()` / `settings.configure` | ✗ | 无设置页机制 |
| `configForms` 客户端服务 | ✗ | 客户端插件若声明它为必需 → 永远 pending |
| `plugins.bundle.config` | ✗ | 连 `dsh-client-ui-plugin-manager` 都没有 |

插件的 `index.js` 已经按能力分支处理注入：

```js
const server = webCtx.webServer || webCtx;
if (typeof server.tapIndex === "function") {
  return server.tapIndex((html) => injectRows(html, rows));   // 旧版
}
return webCtx.on("webserver/index-inject", (table) => {        // 官方/新版
  for (const row of rows) table.push(row);
});
```

`injectRows()` 对齐新版 `renderIndexInjections`：`style` **强制进 head**、
body 行按序、末尾补 `__DSH_BOOT_READY__`。

### 3.2 它优先用机器上的 dsh，但用不了新版

优先级是 `DSH_BIN → 机器里的 dsh → 缓存 → 下载`。而 dsh ≥ 0.2 的 web server
会打印一条**带 token** 的 URL，并对未授权的 `/` 返回 401；壳只按
`http://host:port` 探测 200 + `text/html`，于是永远等不到就绪：

```
dsh web authentication required; reopen the URL printed by dsh web.
（HTTP 401，窗口白屏，日志里没有 "dsh ready on"）
```

实测矩阵：

| 组合 | 结果 |
|---|---|
| 第三方壳 + 它钉死的 0.1.0-rc.6 | ✅ 可用（注入、动效、收工都验过） |
| 第三方壳 + 机器里的 0.2.1-rc.2 | ❌ 401，打不开 |

想让第三方壳用新版 dsh，得自己改它的 `app.asar`：抓子进程 stdout 里的
`dsh web: http://…?token=…`，用它做就绪探测和 `loadURL`。**这条路我只写到这里，
没有验证成功**（本环境会在工具调用返回时回收常驻 Electron 进程，窗口起不来），
不要当成已验证结论。

**注意**：这是第三方壳自己的缺陷。官方桌面端用 IPC 拿注入、Host 侧自带鉴权，
不存在这些问题。

---

## 4. 怎么验证

### 官方桌面端

装好后只看三件事（devtools console，或页面上肉眼看）：

```js
typeof window.__betterloading        // "object"
document.getElementById('__bl')      // 加载期间存在
window.__blDiag.level()              // 0..1，随加载上涨
```

如果 `__bl` 不存在，先确认插件真的装进了桌面端的 profile（桌面端有自己的
数据目录，不是 `~/.dsh`），再确认运行时版本：

```bash
# 桌面端日志里会写它选的 runtime
grep -E "runtime selected|dsh ready on" <desktop log>
```

### 第三方壳 / 无 GUI 的等价验证

它的内嵌服务端可以单独跑，等价于桌面端内嵌的那个：

```bash
export DSH_HOME=/tmp/desk-test-home
node <runtime>/dsh/lib/bin.js plugin --profile web add /path/to/betterloading
node <runtime>/dsh/lib/bin.js web --host 127.0.0.1 --port 3099
```

```bash
curl -s http://127.0.0.1:3099/ > idx.html
grep -c 'id="__bl"' idx.html            # 1
grep -c 'id="__bl_wsrc"' idx.html       # 1
grep -c '#__bl{position:fixed' idx.html # 1
python3 - <<'PY'
s = open('idx.html').read()
assert s.find('#__bl{') < s.find('</head>'), 'style 没进 head'
assert s.find('<body') < s.find('__bl_wsrc') < s.find('<div id="__bl"'), '顺序错'
PY
```

实测（第三方壳 0.1.0-rc.6 上）：注入到位、`__bl_live` 出现、水位涨到 82.5%、
收工移除、侧栏正常、日志无 `did not activate`。

---

## 5. 排错顺序

1. **页面里有没有 `#__bl`**
   - 官方桌面端没有 → 插件没装进桌面端 profile，或运行时不是官方版本
   - 第三方壳没有 → 注入 API 不匹配（看 §3.1）
2. **有 `#__bl` 但水面不动**
   - `typeof window.__betterloading` 不是 `"object"` → 主脚本被 CSP 拦了
   - 控制台有 `Refused to create a worker from 'blob:'` → 同上，放行 `worker-src blob:`
3. **页面顶部报 `did not activate … waiting for service`**
   - 某个服务写进了必需 `inject` 但该运行时没有 → 改成 `ctx.inject` 按需
4. **收工太早/太晚**
   - 调 `idleTimeoutMs`（默认 60000，上限 180000）
   - 官方桌面端可以在设置页改；第三方壳没有设置页，只能改 profile 或 schema 默认值

---

## 6. 结论对照表

| 部署形态 | 注入 | 设置页 | 需要做的事 |
|---|---|---|---|
| 浏览器访问 `dsh web` | ✅ | ✅ | 无 |
| **官方桌面端**（`@deepseek-ai/dsh-desktop`） | ✅ 走 Node IPC | ✅ | **无** |
| 第三方壳（钉死 0.1.0-rc.6） | ✅ 走 `tapIndex`（插件已支持） | ✗ | 装插件即可；没有设置页 |
| 第三方壳 + 强制新版 dsh | ⚠️ | ⚠️ | 需改壳的 asar 处理 token（未验证） |

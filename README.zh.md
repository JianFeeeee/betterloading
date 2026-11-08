# betterloading

[English](README.md) | **简体中文**

给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）Web UI 加一层**毛玻璃灌水式加载层**。

慢链路下最常见的一幕是：基础界面已经渲染出来了，但会话列表、工作区、任务还在路上，页面中间空着一块，看不出是在加载还是卡死了。这个插件用一层磨砂玻璃盖住尚未完成的部分，**水位随真实加载进度上涨，磨砂随水位褪去，页面逐渐变清晰**，最后文字淡出、遮罩移除。

> 它不伪造进度。水位由真实事件驱动：静态资源完成、应用挂载、每一个 `/api` 请求的发起与完成。

## 特性

- **因果物理**：每完成一次加载 = 一团看不见的水从上方**随机横向位置**落下 → 砸出波纹 → 水位按这团水的体积连续上涨（smoothstep，有加速减速）。
- **真实水面**：一维阻尼波动方程实时求解，波会传播、在两端反射、互相干涉。不是平移的贴图。
- **模糊边界就是水面**：磨砂层的裁剪几何每帧由水面曲线生成（`clip-path: path(...)`），不是一条水平直线。
- **两种磨砂模式**（见下）：静态采样（默认，零实时滤镜）或真实模糊。
- **主题自适应**：跟随 dsh 的 `body[data-ds-dark-theme]` 切换明暗配色与铭牌样式。
- **不碰业务请求**：`fetch` 只做计数包装、原样返回；不修改任何 dsh 包文件。
- **绝不永久遮挡**：内容就绪即移除；另有兜底判定与硬超时，任何情况下都会放行。

## 安装

```bash
dsh plugin --profile web add betterloading
```

CLI 会读取 `dsh.bundle` 声明并把它加入 `dsh.profile.bundles`，无需手工编辑 patch。

卸载：

```bash
dsh plugin --profile web remove betterloading
```

## 两种磨砂模式（`mode`）

| | `static` | `realtime`（默认） |
|---|---|---|
| 实现 | 一次性采样页面主色调 + 生成噪点纹理平铺 | 真实 `backdrop-filter: blur()` |
| 观感 | 磨砂贴膜（颗粒质感） | 真玻璃，能看到背景的模糊轮廓 |
| 合成开销 | **零实时滤镜** | 只模糊窄带内的区域 |
| 实测帧率 | 60fps | 约 36fps（加载初期模糊区接近全屏时） |

早期版本里 `realtime` 会掉到 34fps，原因是**全屏 `backdrop-filter` 上方叠着一个每帧重绘的全屏 canvas**，浏览器必须每帧重新模糊整个背景。现在改为分层结构后两者都是 60fps：

```
上方 + 中间 │ 单一模糊层：下边界由 clip-path 跟随水面曲线（每帧重算）
────────────┼──────────────────────────────────────
下方        │ 透明区（什么都不画，页面完全清晰）
```

**只有一个 `backdrop-filter` 元素**是有意为之：两个相邻的模糊层各自会在边缘钳制采样，交界处必然出现一条扎眼的直线；而 `mask` + `backdrop-filter` 在 Chrome 下组合也不可靠（渐隐不生效、底色双重叠加）。单层虽然每帧重算 clip 更贵，但视觉上确定无缝。

想要 60fps、能接受磨砂质感而非真模糊时切到 `static`：

```yaml
- id: betterloading
  config:
    mode: "realtime"
    blur: 12
```

## 配置

覆盖写在你自己的 profile patch 层（`$DSH_HOME/cordis.patch.yml` 或 profile 的 `cordis.patch.yml`，它们在所有 bundle 之后应用）：

```yaml
- id: betterloading
  config:
    mode: "realtime"     # realtime（默认，真模糊） | static（无实时滤镜）
    noise: 13            # static 模式颗粒强度 0-100
    tintLight: "rgba(250,252,255,.55)"
    tintDark: "rgba(14,18,26,.62)"
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `mode` | `"realtime"` | `static` = 静态采样磨砂；`realtime` = 真实背景模糊 |
| `blur` | `10` | `realtime` 模式的模糊半径（px），0-60 |
| `noise` | `13` | `static` 模式的颗粒强度，0-100 |
| `tintLight` | `rgba(250,252,255,.55)` | 浅色主题磨砂底色 |
| `tintDark` | `rgba(14,18,26,.62)` | 深色主题磨砂底色 |
| `maxBlob` | `0.04` | 单团水的最大体积（全屏比例）。决定一次加载最多推进多少 |
| `waveSpeed` | `200` | 波速平方项 c²。越大波传得越快 |
| `damping` | `0.35` | 阻尼。过大波传不到边缘，过小会一直震荡 |
| `amplitude` | `46` | 水面振幅（px） |
| `idleTimeoutMs` | `12000` | 硬超时（ms）。到点必定移除遮罩 |

### 调参提示

- 觉得水位涨得太快/一次就满 → 调小 `maxBlob`
- 觉得波看不到 → 调大 `amplitude`，或调小 `damping`（波传得更远）
- 觉得水在抖 → 调大 `damping`
- 机器弱、想要更省 → 保持 `mode: static`，`noise` 调低

## 工作原理

注入点只有三个，全部通过 dsh 的 `webserver/index-inject`：

1. `<style>` — 遮罩、磨砂层、铭牌的样式
2. `body` 开头的 `<div>` — 遮罩结构
3. `body` 开头的同步 `<script>` — 它早于 `head` 里的 `type="module"` 执行，因此能抢在 dsh 发出第一个 `/api` 之前装好 fetch 包装与 `MutationObserver`

水位状态机：

```
0%      起始
 →0.42  静态资源（每个新资源落一团水）
 →0.10  应用挂载（#root 出现子节点）
 →…     每个 /api 请求的发起/完成各落一小团
 100%   内容就绪 → 文字淡出、水面褪去、节点移除
```

## 已知限制

- 只作用于 dsh 的 **Web UI**，不改变服务端行为。
- 依赖 dsh 的 `webserver/index-inject` 事件与 `#root` 结构。dsh 大版本改动后可能需要跟进。
- 隐藏 dsh 自带 boot 屏用的是**结构选择器**（类名含 `_boot_`），因为它的类名带 hash、会随打包变化。失败提示卡片特意保持可见。
- 内容就绪的判定是启发式的（`#root` 内文本长度 / 交互元素数量），极端布局下可能提前或稍晚收尾；硬超时保证不会永久遮挡。

## License

MIT

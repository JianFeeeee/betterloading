/**
 * betterloading — DeepSeek Harness (dsh) 的「毛玻璃灌水」加载层。
 *
 * 灵感来自一个真实痛点：外网访问慢时，基础 UI 已渲染但会话/工作区内容还在
 * 路上，页面空着一块。这个插件用一层毛玻璃盖住未完成的部分，水位随加载
 * 进度上涨，磨砂随水位褪去，内容逐渐清晰。
 *
 * 因果模型：每完成一次加载（静态资源 / 应用挂载 / 一个 /api 请求），等于有一团
 * 看不见的水从上方随机横向位置落下。触水时：
 *   1) 在落点注入零和冲量 → 波动方程产生向两侧传播、互相干涉的波纹；
 *   2) 体积用 smoothstep 连续注入 → 水位按「这团有多少」平滑上涨。
 * 水位 = 已注完的体积 + 正在注入的体积：由加载量驱动，但不会有阶跃。
 *
 * 实施方式：只通过 `webserver/index-inject` 注入 HTML/CSS/JS，
 * 不修改任何 dsh 包文件；`fetch` 只做计数包装、原样返回，不改变业务请求。
 *
 * @module betterloading
 */
import z from "@deepseek-ai/schemastery";

/** 稳定 Cordis 插件名。 */
export const name = "betterloading";

/** 需要 webServer 来注册 index 注入行。 */
export const inject = ["webServer"];

/**
 * 磨砂层的工作模式。
 *
 * - `static`：一次性采样页面主色调 + 生成噪点纹理平铺，**不用任何实时滤镜**。
 *   合成器不必每帧重算背景模糊，实测与「无覆盖层」同为 60fps。默认值。
 * - `realtime`：真实 `backdrop-filter` 模糊，画面更接近真玻璃，但全屏模糊
 *   叠在每帧重绘的 canvas 之上时，浏览器会每帧重新模糊整个背景
 *   （同一台机器实测 60fps → 34fps）。仅在性能充裕时开启。
 */
const MODE = z.union([z.const("static"), z.const("realtime")]);

export const Config = z.object({
  mode: MODE.default("realtime"),

  /** `realtime` 模式的模糊半径（px）。半径越大越贵。 */
  blur: z.natural().min(0).max(60).default(8),

  /** `static` 模式的颗粒强度（0 = 无颗粒，100 = 很重）。 */
  noise: z.natural().min(0).max(100).default(13),

  /** 浅色主题下的磨砂底色。 */
  tintLight: z.string().default("rgba(250,252,255,.55)"),

  /** 深色主题下的磨砂底色。 */
  tintDark: z.string().default("rgba(14,18,26,.62)"),

  /** 界面语言：auto 跟随浏览器，zh / en 强制指定。 */
  locale: z.union([z.const("auto"), z.const("zh"), z.const("en")]).default("auto"),

  /**
   * 覆盖任意文案。键见 README 的文案表；值里的 `{n}` 会替换成数字。
   * 未提供的键回落到所选语言的内置文案。
   */
  texts: z.dict(z.string()).default({}),

  /**
   * 铭牌图标：`whale`（默认，dsh 自己的鲸鱼）、`none`、一段内联 `<svg>`，
   * 或一个图片 URL。
   */
  icon: z.string().default("whale"),

  /** 图标边长（px）。 */
  iconSize: z.natural().min(0).max(96).default(30),

  /** 加载高亮框的颜色（任意合法 CSS 颜色，#rrggbb 最方便）。 */
  glowColor: z.string().default("#6EAAFF"),

  /** 同时可存在的加载高亮框数量上限。 */
  glowMax: z.natural().min(1).max(12).default(6),

  /** 单团水的最大体积（占全屏比例）。决定「一次加载」最多推进多少。 */
  maxBlob: z.number().min(0.005).max(0.2).default(0.04),

  /** 波速平方项（c²）。越大波传播越快。 */
  waveSpeed: z.natural().min(40).max(400).default(200),

  /** 阻尼系数。太大则波传不到边缘，太小会持续震荡。 */
  damping: z.number().min(0.05).max(3).default(0.35),

  /** 水面振幅（px）。 */
  amplitude: z.natural().min(6).max(80).default(46),

  /** 硬超时（ms）。到点无论如何都移除遮罩，绝不把用户永久挡在外面。 */
  idleTimeoutMs: z.natural().min(2000).max(60000).default(30000),
});

/**
 * 把配置里的颜色化成 "r,g,b" 供 CSS 的 rgba(var(--x),alpha) 使用。
 * 支持 #rgb / #rrggbb / rgb() / rgba()；解析不了就回退到默认蓝。
 * @param value - 任意合法 CSS 颜色字符串。
 * @returns "r,g,b"。
 */
function parseRgb(value) {
  const raw = String(value ?? "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(raw);
  if (m) {
    const h = m[1];
    return [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
      .map((x) => parseInt(x, 16))
      .join(",");
  }
  m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m) {
    const h = m[1];
    return [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)]
      .map((x) => parseInt(x, 16))
      .join(",");
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  return "110,170,255";
}

/** dsh 自己的鲸鱼图标（单路径，currentColor 跟随主题明暗）。 */
const WHALE_ICON = `<svg viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z" fill="currentColor"/></svg>`;

/** 内置文案。键在 README 里公开，用户可用 `texts` 逐条覆盖。 */
const TEXTS = {
  zh: {
    title: "DeepSeek Harness",
    connecting: "正在连接…",
    prep: "准备资源",
    waiting: "等待数据",
    resources: "资源",
    requests: "请求",
    downloading: "正在下载界面资源…",
    resourcesReady: "资源就绪，正在启动…",
    uiReady: "界面已就绪，正在载入内容…",
    loadingTopic: "正在载入{topic}…",
    contentLoading: "内容载入中…",
    contentReady: "内容已就绪",
    done: "已就绪",
    totalRequests: "共 {n} 个请求",
    timeout: "已超时，直接进入",
    tSession: "会话",
    tWorkspace: "工作区",
    tSettings: "设置",
    tJob: "任务",
    tAccount: "账号",
    tTerminal: "终端",
    tAttachment: "附件",
    tContent: "内容",
  },
  en: {
    title: "DeepSeek Harness",
    connecting: "Connecting…",
    prep: "Preparing",
    waiting: "Waiting for data",
    resources: "Assets",
    requests: "Requests",
    downloading: "Downloading UI assets…",
    resourcesReady: "Assets ready, starting…",
    uiReady: "Shell ready, loading content…",
    loadingTopic: "Loading {topic}…",
    contentLoading: "Loading content…",
    contentReady: "Content ready",
    done: "Ready",
    totalRequests: "{n} requests",
    timeout: "Timed out, continuing",
    tSession: "sessions",
    tWorkspace: "workspaces",
    tSettings: "settings",
    tJob: "jobs",
    tAccount: "account",
    tTerminal: "terminal",
    tAttachment: "attachments",
    tContent: "content",
  },
};

/** 转义 JSON 用于内联进 <script>（防止提前闭合标签）。 */
function js(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * 生成注入的样式表。
 * @param cfg - 已校验的配置。
 * @returns 一段 CSS 文本。
 */
function buildStyle(cfg) {
  // realtime 模式才带真实滤镜；static 模式用噪点纹理（由脚本生成）表现磨砂。
  const frostFilter =
    cfg.mode === "realtime"
      ? `-webkit-backdrop-filter:blur(${String(cfg.blur)}px) saturate(1.15);` +
        `backdrop-filter:blur(${String(cfg.blur)}px) saturate(1.15);`
      : "";

  return `
#__bl{position:fixed;inset:0;z-index:2147483647;overflow:hidden;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  color:#15181f;pointer-events:none;
  --bl-glass:linear-gradient(150deg,rgba(255,255,255,.86),rgba(255,255,255,.70) 55%,rgba(255,255,255,.80));
  --bl-edge:rgba(24,30,42,.20);
  --bl-shadow:0 8px 30px rgba(20,28,45,.20),inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(20,28,45,.05);
  --bl-glow:linear-gradient(160deg,rgba(255,255,255,.55),transparent 42%);
  --bl-textshadow:0 1px 8px rgba(255,255,255,.5);
  --bl-tint:${cfg.tintLight}}
body[data-ds-dark-theme] #__bl{
  color:#eef2fb;
  --bl-glass:linear-gradient(150deg,rgba(38,45,60,.88),rgba(28,34,47,.72) 55%,rgba(34,41,55,.82));
  --bl-edge:rgba(255,255,255,.22);
  --bl-shadow:0 8px 32px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(255,255,255,.06);
  --bl-glow:linear-gradient(160deg,rgba(255,255,255,.10),transparent 42%);
  --bl-textshadow:0 1px 10px rgba(0,0,0,.35);
  --bl-tint:${cfg.tintDark}}

/* 加载高亮框颜色（配置项 glowColor 换算成 r,g,b） */
#__bl{--bl-glow-rgb:${parseRgb(cfg.glowColor)}}

/* 加载高亮框颜色（配置项 glowColor 换算成 r,g,b） */
#__bl{--bl-glow-rgb:${parseRgb(cfg.glowColor)}}

/* 唯一模糊层：覆盖 [0, 窄带底]，下边界由 clip-path 跟随水面曲线。
   只用一个 backdrop-filter 元素 —— 两个相邻元素必然出现边缘钳制缝，
   而 mask+backdrop-filter 在 Chrome 下组合不可靠（渐隐不生效、tint 双重叠加）。 */
#__bl_frost{position:absolute;left:0;top:0;width:100%;height:0;
  ${frostFilter}
  background-color:var(--bl-tint);
  background-repeat:repeat;background-size:96px 96px;
  transition:opacity .5s ease}



/* dsh 自带的 boot 屏：类名带 hash、随升级变化，故用结构匹配。
   只隐藏 spinner/wordmark/hint，失败提示必须保持可见。 */
div[class*="_boot_"] > div[class*="_card_"] > div[class*="_spinner_"],
div[class*="_boot_"] > div[class*="_card_"] > div[class*="_wordmark_"],
div[class*="_boot_"] > div[class*="_card_"] > div[class*="_hint_"]{display:none !important}
div[class*="_boot_"] > div[class*="_card_"]:not(:has(div[class*="_failed_"])){display:none !important}
div[class*="_boot_"]:not(:has(div[class*="_failed_"])){background:transparent !important}

/* 水面画布：高度/位置由脚本设为「以水面线为中心、上下各 band px」的窄带。
   每帧只重绘这条带，其余区域不参与重绘与重合成。 */
#__bl_wave{position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;
  opacity:1;transition:opacity .45s ease}
#__bl.__done #__bl_wave{opacity:0}
#__bl.__done #__bl_frost{opacity:0}
#__bl.__done #__bl_text{opacity:0 !important;transform:translateX(-50%) translateY(-6px);
  transition:opacity .55s ease,transform .55s ease}

/* 加载高亮框：每个并发加载各自一个框（JS 池化），
   颜色由 --bl-glow-rgb 控制（配置项 glowColor 换算而来）。 */
/* 性能要点：发光框面积很大（可达上千像素宽），
   - 不用 box-shadow：28px 半径的外阴影会重绘整块区域；
   - 不改 width/height/left/top 做动画：那些是布局属性。
   改为：位置用 translate3d，动画只动 opacity（纯合成），
   光晕用多层渐变背景代替阴影。 */
.bl-glow{position:absolute;left:0;top:0;pointer-events:none;border-radius:14px;
  box-sizing:border-box;
  border:1.5px solid rgba(var(--bl-glow-rgb),.85);
  background:
    radial-gradient(ellipse 60% 55% at center,
      rgba(var(--bl-glow-rgb),.22),rgba(var(--bl-glow-rgb),.06) 62%,transparent 82%),
    linear-gradient(180deg,rgba(var(--bl-glow-rgb),.05),rgba(var(--bl-glow-rgb),.02));
  opacity:0;will-change:opacity;contain:layout paint;
  transition:opacity .18s ease-out}
.bl-glow.__lit{opacity:1}
@media (prefers-reduced-motion:reduce){.bl-glow{transition:none}}

/* 铭牌里的加载清单 */
#__bl_list{margin-top:14px;padding-top:12px;border-top:1px solid var(--bl-edge);
  text-align:left;font-size:11.5px;line-height:1.75;min-height:0}
.__bl_row{display:flex;align-items:center;gap:7px;opacity:.72;
  transition:opacity .25s ease,transform .25s ease;white-space:nowrap;overflow:hidden;
  animation:__bl_rowin .26s cubic-bezier(.22,.7,.25,1) both}
@keyframes __bl_rowin{from{opacity:0;transform:translateY(-4px)}to{opacity:.72;transform:none}}
.__bl_row:first-child{animation-name:__bl_rowin}
.__bl_row:first-child{opacity:1}
.__bl_row.__done{opacity:.4}
.__bl_dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#5f9dff;
  box-shadow:0 0 6px rgba(95,157,255,.9)}
.__bl_row.__done .__bl_dot{background:currentColor;opacity:.45;box-shadow:none}
.__bl_name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.__bl_ms{flex:0 0 auto;opacity:.6;font-variant-numeric:tabular-nums}

/* 玻璃铭牌（静态玻璃，不依赖背景滤镜） */
#__bl_text{position:absolute;left:50%;top:34%;transform:translateX(-50%);
  min-width:230px;max-width:86vw;box-sizing:border-box;text-align:center;
  padding:20px 30px 17px;border-radius:16px;
  background:var(--bl-glass);border:1px solid var(--bl-edge);box-shadow:var(--bl-shadow);
  text-shadow:var(--bl-textshadow);overflow:hidden;
  /* 隐式高度变化也做过渡：清单行数变化时框不再瞬间跳大跳小。
     height 由脚本显式设置（auto 无法参与过渡）。 */
  transition:opacity .6s ease,height .26s cubic-bezier(.22,.7,.25,1),
             padding .26s cubic-bezier(.22,.7,.25,1)}
#__bl_text::before{content:"";position:absolute;inset:1px;border-radius:15px;
  pointer-events:none;background:var(--bl-glow)}
/* 失败态：铭牌转红并列出失败项 */
#__bl_text.__fail{border-color:#e5484d;box-shadow:0 0 0 1px #e5484d,var(--bl-shadow)}
#__bl.__fail #__bl_frost{background-color:rgba(229,72,77,.10)}
#__bl_title.__fail{color:#e5484d}
#__bl_fails{margin-top:12px;padding-top:10px;border-top:1px solid var(--bl-edge);
  text-align:left;font-size:11.5px;line-height:1.7;color:#e5484d;display:none}
#__bl_fails.__on{display:block}
.__bl_fail_row{display:flex;gap:6px;align-items:flex-start;animation:__bl_rowin .26s both}
.__bl_fail_name{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%}
.__bl_fail_reason{flex:1 1 auto;opacity:.8;font-size:11px}

#__bl_title{font-size:16px;font-weight:600;letter-spacing:.1em;opacity:.95}
#__bl_status{margin-top:9px;font-size:12.5px;letter-spacing:.04em;opacity:.7;min-height:18px}
#__bl_meta{margin-top:20px;font-size:11px;letter-spacing:.14em;opacity:.5;
  font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;gap:.45em}

/* 铭牌图标：默认 dsh 鲸鱼，currentColor 跟随主题 */
#__bl_iconwrap{margin:0 auto 13px;display:flex;align-items:center;justify-content:center;
  opacity:.9}
#__bl_iconwrap svg,#__bl_iconwrap img{display:block;color:currentColor}

/* 里程表式百分比：每位一列 0-9，靠 translateY 滚动 */
#__bl_pct{display:inline-flex;align-items:flex-start;line-height:1;
  font-variant-numeric:tabular-nums;font-weight:600;opacity:.9}
.__bl_d{display:inline-block;position:relative;overflow:hidden;
  height:1.15em;width:.62em}
.__bl_col{display:flex;flex-direction:column;
  transition:transform .34s cubic-bezier(.22,.7,.25,1)}
.__bl_col i{display:block;height:1.15em;line-height:1.15em;font-style:normal;text-align:center}
.__bl_sign{display:inline-block;margin-left:.06em}

/* detail 的「资源 n / m」：两个数字也用里程表，标签切换时淡入 */
#__bl_dnum{display:inline-flex;align-items:flex-start;margin-left:.45em}
#__bl_dnum[hidden]{display:none}
.__bl_sep{display:inline-block;margin:0 .28em;opacity:.55}
#__bl_detail .__bl_d{font-size:inherit;height:1.15em}

/* 内容变化时给铭牌一个轻微弹性，产生「中间帧」而不是硬切 */
@keyframes __bl_bump{0%{transform:translateX(-50%) scale(1)}
  42%{transform:translateX(-50%) scale(1.018)}100%{transform:translateX(-50%) scale(1)}}
#__bl_text.__bump{animation:__bl_bump .34s cubic-bezier(.22,.7,.25,1)}
@media (prefers-reduced-motion:reduce){
  .__bl_col{transition:none}
  #__bl_text.__bump{animation:none}}
`;
}

const HTML = `
<div id="__bl" role="status" aria-live="polite">
  <div id="__bl_frost"></div>
  <canvas id="__bl_wave"></canvas>
  <div id="__bl_glows"></div>
  <div id="__bl_text">
    <div id="__bl_iconwrap"></div>
    <div id="__bl_title"></div>
    <div id="__bl_status">正在连接…</div>
    <div id="__bl_list"></div>
    <div id="__bl_fails"></div>
    <div id="__bl_meta"><span id="__bl_detail"><span id="__bl_dl"></span><span id="__bl_dnum"><span id="__bl_dn"></span><span class="__bl_sep">/</span><span id="__bl_dm"></span></span></span> &nbsp;·&nbsp; <span id="__bl_pct">0%</span></div>
  </div>
</div>
`;

/**
 * 生成注入的启动脚本。
 *
 * 脚本在 body 开头的普通 `<script>` 里同步执行，早于 head 中的
 * `type="module"`（defer 语义），因此能抢在 dsh 发出第一个 `/api` 之前
 * 装好 fetch 包装与 MutationObserver。
 *
 * @param cfg - 已校验的配置。
 * @returns 一段 JS 文本。
 */
/**
 * 生成注入的主线程脚本。
 *
 * 它本身很轻：只负责 DOM（铭牌、清单、泛光、磨砂层的裁剪）、加载事件监听，
 * 以及把"落水"指令转发给 worker。波动方程与 canvas 绘制全在 worker 线程，
 * 所以 dsh 的 JS 与动画不再争同一个事件循环。
 *
 * @param cfg - 已校验的配置。
 * @returns 一段 JS 文本。
 */
function buildScript(cfg) {
  return `
(function(){
  /* 持久标记：告诉客户端 bundle「web 端已由 host 接管」，
     不能靠 DOM 判断 —— host 这套可能在 bundle 执行前就 finish 并移除骨架。 */
  var el=document.getElementById('__bl'); if(!el) return;
  var status=document.getElementById('__bl_status'),
      detail=document.getElementById('__bl_detail'),
      pct=document.getElementById('__bl_pct'),
      frost=document.getElementById('__bl_frost'),
      glowHost=document.getElementById('__bl_glows'),
      listEl=document.getElementById('__bl_list'),
      cv=document.getElementById('__bl_wave'),
      srcEl=document.getElementById('__bl_wsrc');
  var CFG=${js({
    mode: cfg.mode,
    noise: cfg.noise,
    maxBlob: cfg.maxBlob,
    waveSpeed: cfg.waveSpeed,
    damping: cfg.damping,
    amplitude: cfg.amplitude,
    idleTimeoutMs: cfg.idleTimeoutMs,
    glowMax: cfg.glowMax,
    iconSize: cfg.iconSize,
  })};

  /* ===== 文案与图标 ===== */
  var TEXTS_ZH=${js(TEXTS.zh)};
  var TEXTS_EN=${js(TEXTS.en)};
  var USER_TEXTS=${js(cfg.texts || {})};
  var LANG=(function(){
    var want=${js(cfg.locale || "auto")};
    if(want==="zh"||want==="en") return want;
    var nav=(navigator.language||navigator.userLanguage||"en").toLowerCase();
    return nav.indexOf("zh")===0?"zh":"en";
  })();
  var T=(function(){
    var base=(LANG==="zh")?TEXTS_ZH:TEXTS_EN, out={}, k;
    for(k in base) out[k]=base[k];
    for(k in USER_TEXTS) if(USER_TEXTS[k]) out[k]=USER_TEXTS[k];
    return out;
  })();
  function t(key,vars){
    var s=(T[key]!==undefined?T[key]:key);
    if(vars) for(var k in vars) s=s.replace("{"+k+"}",vars[k]);
    return s;
  }

  /* ===== 图标 ===== */
  var iconWrap=document.getElementById('__bl_iconwrap');
  function renderIcon(){
    if(!iconWrap) return;
    var raw=${js(cfg.icon || "whale")};
    var size=Math.max(0,CFG.iconSize||30);
    if(!size||raw==='none'){ iconWrap.innerHTML=''; iconWrap.style.display='none'; return; }
    iconWrap.style.display='';
    var svg=raw;
    if(raw==='whale') svg=${js(WHALE_ICON)};
    if(svg.charAt(0)==='<'){
      iconWrap.innerHTML=svg;
      var el=iconWrap.firstElementChild;
      if(el){ el.setAttribute('width',String(size)); el.setAttribute('height',String(size)); }
    }else{
      var img=document.createElement('img');
      img.src=raw; img.width=size; img.height=size; img.alt='';
      iconWrap.innerHTML=''; iconWrap.appendChild(img);
    }
  }
  renderIcon();
  /* 初始文案 */
  (function initTexts(){
    var ti=document.getElementById('__bl_title');
    if(ti) ti.textContent=t('title');
    var st=document.getElementById('__bl_status');
    if(st) st.textContent=t('connecting');
    var pr=document.getElementById('__bl_dl');
    if(pr) pr.textContent=t('prep');
  })();

  var done=false, removed=false;

  var worker=null, offscreen=false;

  function isDark(){ return !!(document.body&&document.body.hasAttribute('data-ds-dark-theme')); }

  /* ===== 静态磨砂质感（仅 static 模式）：一次性噪点纹理 ===== */
  if(CFG.mode==='static'&&frost){
    try{
      var dark0=isDark();
      var nc=document.createElement('canvas'); nc.width=nc.height=96;
      var nx=nc.getContext('2d');
      var im=nx.createImageData(96,96), d=im.data;
      var a=Math.max(0,Math.min(100,CFG.noise));
      for(var i=0;i<d.length;i+=4){
        var vv=(Math.random()*255)|0;
        d[i]=d[i+1]=d[i+2]=vv; d[i+3]=(Math.random()*a)|0;
      }
      nx.putImageData(im,0,0);
      frost.style.backgroundImage='url('+nc.toDataURL('image/png')+')';
    }catch(e){}
  }

  /* ===== 动画 worker：OffscreenCanvas 交给它，波动与绘制不在主线程 ===== */
  function startWorker(){
    if(worker||!cv||!srcEl) return;
    try{
      var off=cv.transferControlToOffscreen();
      var blob=new Blob([srcEl.textContent],{type:'text/javascript'});
      worker=new Worker(URL.createObjectURL(blob));
      worker.onmessage=function(ev){
        var m=ev.data||{};
        if(m.type!=='state') return;
        /* 主线程只做低频 DOM 写入 */
        if(frost){
          var fh=Math.max(0,Math.min(window.innerHeight,Math.ceil(m.top)+Math.min(220,window.innerHeight)));
          frost.style.height=fh+'px';
          if(m.clip) frost.style.clipPath="path('"+m.clip+"')";
        }
        cv.style.top=m.top+'px';
        cv.style.height=Math.min(220,window.innerHeight)+'px';
        targetPct=m.level*100;
      };
      worker.postMessage({
        type:'init', canvas:off, VW:window.innerWidth, VH:window.innerHeight,
        dpr:Math.min(2,window.devicePixelRatio||1), dark:isDark(), cfg:CFG
      },[off]);
      offscreen=true;
    }catch(e){ worker=null; }
  }
  /* ===== 百分比与框高的平滑 =====
     10Hz 的 state 消息直接写 textContent 是硬切；这里用 rAF 把显示值
     补间到目标值，同时把铭牌 height 显式化以便参与 CSS 过渡。 */
  var shownPct=0, targetPct=0, pctRaf=0;
  /* 里程表工厂：每位一个 0-9 的列，靠 translateY 滚动；位数变化时重建 */
  function createOdo(host, suffix){
    var cols=[], digits=-1;
    function build(str){
      host.innerHTML=''; cols=[];
      for(var i=0;i<str.length;i++){
        var d=document.createElement('span'); d.className='__bl_d';
        var col=document.createElement('span'); col.className='__bl_col';
        for(var k=0;k<10;k++){
          var it=document.createElement('i'); it.textContent=String(k); col.appendChild(it);
        }
        d.appendChild(col); host.appendChild(d); cols.push(col);
      }
      if(suffix){
        var sg=document.createElement('span'); sg.className='__bl_sign'; sg.textContent=suffix;
        host.appendChild(sg);
      }
      digits=str.length;
    }
    build('0');
    return function set(n){
      var str=String(n);
      if(str.length!==digits) build(str);
      for(var i=0;i<str.length&&i<cols.length;i++){
        cols[i].style.transform='translateY('+(-(+str[i])*1.15)+'em)';
      }
    };
  }
  var pctWrap=document.getElementById('__bl_pct');
  var paintOdo=createOdo(pctWrap,'%');

  /* 「资源 n / m」「请求 n / m」：数字里程表 + 标签淡入 */
  var dlEl=document.getElementById('__bl_dl'),
      dnumEl=document.getElementById('__bl_dnum'),
      dnEl=document.getElementById('__bl_dn'),
      dmEl=document.getElementById('__bl_dm');
  var setDn=dnEl?createOdo(dnEl,''):function(){},
      setDm=dmEl?createOdo(dmEl,''):function(){};
  var lastLabel='';
  if(dnumEl) dnumEl.hidden=true;      /* 初始只显示文案，不带数字 */
  function setDetail(kind,a,b){
    if(!dlEl) return;
    if(kind===null||kind===undefined){
      dnumEl.hidden=true;
      var wt=t('waiting');
      if(lastLabel!==wt){ lastLabel=wt; dlEl.textContent=wt; }
      return;
    }
    dnumEl.hidden=false;
    /* 标签只做纯切换：滚轮动画只属于数字，文字不该跟着动 */
    if(lastLabel!==kind){ lastLabel=kind; dlEl.textContent=kind; }
    setDn(a); setDm(b);
  }
  function setDetailText(txt){
    if(!dlEl) return;
    dnumEl.hidden=true;
    lastLabel=txt||'';
    dlEl.textContent=txt||'';
  }
  var textEl=document.getElementById('__bl_text');
  var bumpTimer=0;
  function bumpPlate(){
    if(!textEl) return;
    textEl.classList.remove('__bump');
    void textEl.offsetWidth;                 /* 强制重排以重启动画 */
    textEl.classList.add('__bump');
    clearTimeout(bumpTimer);
    bumpTimer=setTimeout(function(){ if(textEl) textEl.classList.remove('__bump'); },380);
  }
  function tickPct(){
    if(removed) return;
    var d=targetPct-shownPct;
    if(Math.abs(d)>0.02){
      shownPct+=d*0.16;
    } else if(shownPct!==targetPct){
      shownPct=targetPct;
    }
    var n=Math.round(shownPct);
    if(n!==lastPctNum){ lastPctNum=n; paintOdo(n); }
    pctRaf=requestAnimationFrame(tickPct);
  }
  var lastPctNum=-1;
  pctRaf=requestAnimationFrame(tickPct);

  function syncPlateHeight(){
    if(!textEl) return;
    var prev=textEl.offsetHeight;
    textEl.style.height='auto';
    var next=textEl.offsetHeight;
    textEl.style.height=prev+'px';                 /* 从旧高度开始 */
    if(next===prev) return;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ textEl.style.height=next+'px'; });
    });
  }
  startWorker();

  function pour(vol,fall,pos){
    if(done||!worker) return;
    worker.postMessage({type:'pour',vol:vol,fall:fall,pos:pos});
  }

  window.addEventListener('resize',function(){
    if(worker) worker.postMessage({type:'resize',VW:window.innerWidth,VH:window.innerHeight,
      dpr:Math.min(2,window.devicePixelRatio||1)});
  });
  try{
    new MutationObserver(function(){
      if(worker) worker.postMessage({type:'theme',dark:isDark()});
    }).observe(document.body,{attributes:true,attributeFilter:['data-ds-dark-theme']});
  }catch(e){}

  /* ===== 加载高亮框池 ===== */
  var GLOW_MAX=CFG.glowMax||6, glowPool=[], glowBusy=[];
  function addGlow(){
    if(!glowHost) return null;
    var g=document.createElement('div');
    g.className='bl-glow';
    glowHost.appendChild(g);
    return g;
  }
  (function buildPool(){ for(var i=0;i<GLOW_MAX;i++){ var g=addGlow(); if(g) glowPool.push(g); } })();
  function regionRect(url){
    var W=window.innerWidth, H=window.innerHeight, p='';
    try{ p=new URL(url,location.href).pathname; }catch(e){}
    if(/^\\/api\\/(session|workspace|attachment)/.test(p)) return {x:0,y:H*0.10,w:W*0.22,h:H*0.82};
    if(/^\\/api\\/(settings|account)/.test(p)) return {x:W*0.28,y:H*0.20,w:W*0.44,h:H*0.54};
    if(/^\\/api\\/(terminal|job)/.test(p)) return {x:W*0.22,y:H*0.10,w:W*0.56,h:H*0.82};
    return {x:W*0.22,y:H*0.10,w:W*0.78,h:H*0.82};
  }
  function lightGlow(item){
    item.el.classList.add('__lit');
    clearTimeout(item.t);
    item.t=setTimeout(function(){
      item.el.classList.remove('__lit');
      var at=glowBusy.indexOf(item);
      if(at>=0) glowBusy.splice(at,1);
      glowPool.push(item.el);
    },340);
  }
  function flashGlow(url){
    if(window.__blDiag) window.__blDiag.flashCalls++;
    if(!glowPool.length&&!glowBusy.length) return;
    if(done) return;
    var r=regionRect(url), i;
    for(i=0;i<glowBusy.length;i++){
      var b=glowBusy[i];
      if(Math.abs(b.x-r.x)<2&&Math.abs(b.y-r.y)<2&&Math.abs(b.w-r.w)<2){ lightGlow(b); return; }
    }
    var el=glowPool.shift();
    if(!el){
      if(glowBusy.length>=12) return;
      el=addGlow();
      if(!el) return;
    }
    el.style.width=r.w+'px'; el.style.height=r.h+'px';
    el.style.transform='translate3d('+r.x+'px,'+r.y+'px,0)';
    var item={el:el,x:r.x,y:r.y,w:r.w};
    glowBusy.push(item);
    lightGlow(item);
    if(window.__blDiag){ window.__blDiag.lit++; window.__blDiag.peak=Math.max(window.__blDiag.peak||0,glowBusy.length); }
  }

  /* ===== 铭牌清单 ===== */
  var rows=[], seq=0;
  function shortName(url){
    var s=String(url||'');
    try{ if(s.indexOf('://')>0) s=new URL(s).pathname; }catch(e){}
    var q=s.indexOf('?'); if(q>0) s=s.slice(0,q);
    var seg=s.split('/').filter(function(x){return x;});
    var n=seg.length?seg[seg.length-1]:s;
    if(seg.length>1) n=seg[seg.length-2]+'/'+n;
    if(n.length>24) n='…'+n.slice(-23);
    return n;
  }
  function renderList(){
    if(!listEl) return;
    var html='';
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      html+='<div class="__bl_row'+(r.done?' __done':'')+'">'+
            '<span class="__bl_dot"></span>'+
            '<span class="__bl_name">'+r.name+'</span>'+
            '<span class="__bl_ms">'+(r.done?(r.ms+'ms'):'—')+'</span></div>';
    }
    listEl.innerHTML=html;
    syncPlateHeight();
    bumpPlate();
  }
  function pushRow(name){
    var id=++seq;
    rows.unshift({id:id,name:name,done:false,ms:0,t0:performance.now()});
    if(rows.length>3) rows=rows.slice(0,3);
    renderList(); return id;
  }
  function finishRow(id){
    for(var i=0;i<rows.length;i++){
      if(rows[i].id===id){
        rows[i].done=true;
        rows[i].ms=Math.max(0,Math.round(performance.now()-rows[i].t0));
        renderList(); return;
      }
    }
  }

  function label(url){
    try{
      var p=new URL(url,location.href).pathname;
      if(p.indexOf('/api/session')===0) return 'tSession';
      if(p.indexOf('/api/workspace')===0) return 'tWorkspace';
      if(p.indexOf('/api/settings')===0) return 'tSettings';
      if(p.indexOf('/api/job')===0) return 'tJob';
      if(p.indexOf('/api/account')===0) return 'tAccount';
      if(p.indexOf('/api/terminal')===0) return 'tTerminal';
      if(p.indexOf('/api/attachment')===0) return 'tAttachment';
      return 'tContent';
    }catch(e){ return 'tContent'; }
  }

  /* ===== 加载事件 → 落一团水 ===== */

  /* 挂载点必须延迟查找：所有注入行都插在 <body> 开头，脚本执行时
     index.html 自己的 <div id="root"> 还没被解析，直接 getElementById 拿到 null，


  /* ===== 「历史已加载」的准确信号 =====
     dsh 前端首屏用 session.list 拉会话历史（客户端源码：
     this.remote.session.list({})），另有 job.list。它们完成 = 历史真的加载好了，
     比「#root 里有几个字」这种启发式可靠得多。
     状态：undefined=还没出现 / 'pending' / 'done' */
  var historySignal, jobSignal, historySeenAt=0;
  function critOf(url){
    var pth='';
    try{ pth=new URL(url,location.href).pathname; }catch(e){ return null; }
    if(pth.indexOf('/api/session/list')===0||pth.indexOf('/api/session.list')===0) return 'session';
    if(pth.indexOf('/api/job/list')===0||pth.indexOf('/api/job.list')===0) return 'job';
    return null;
  }

  /* ============================================================
   * 静态层职责：只要「不难看、不白屏、有动画」。
   *
   * 刻意不在这里判断加载是否完成、也不包装 fetch —— 那是动态层的事：
   * 能拿到官方事件的插件（客户端 bundle 注入 sessions，订阅
   * api-session/added|error|status）用下面暴露的接口接续。
   * 静态层在无人接续时也能独立成立：定时波浪 + 缓慢上升，永不停在空屏。
   * ========================================================== */

  var visualTimer=null;
  function startIdleWave(){
    if(visualTimer) return;
    visualTimer=setInterval(function(){
      if(done) return;
      pour(0.010+Math.random()*0.010, 150+Math.random()*140);
    },430);
  }
  /* ---- 资源阶段：用标准 Performance API 采信息（清单 / 泛光 / 水位）----
     这不是判定「是否加载完成」，只是把浏览器看得到的资源进度显示出来；
     完成与失败的判定仍留给动态层的官方事件。 */
  var expected=(function(){
    var els=document.querySelectorAll('script[src],link[rel=stylesheet],link[rel=modulepreload]');
    var c=0;
    for(var i=0;i<els.length;i++){
      var u=els[i].src||els[i].href||'';
      if(u.indexOf('/plugins')>=0||u.indexOf('/api')>=0) continue;
      c++;
    }
    return c||3;
  })();
  var seen={};
  function checkResources(){
    var list=[]; try{ list=performance.getEntriesByType('resource')||[]; }catch(e){}
    var n=0,fresh=0,i;
    for(i=0;i<list.length;i++){
      var e=list[i], nm=e.name||'';
      /* 排除两类噪音：
         - /plugins/??a,b,c 是客户端插件的合并 bundle（十几 MB，一个条目，
           会把清单占满、让 n/m 立刻到顶）
         - /api/* 是 RPC，由动态层负责，不算静态资源 */
      if(nm.indexOf('/plugins')>=0||nm.indexOf('/api')>=0) continue;
      var looksLikeFile=/[.](js|css|svg|woff2?|png|jpg)([?]|$)/.test(nm);
      if(!looksLikeFile&&e.initiatorType!=='script'&&e.initiatorType!=='link'&&e.initiatorType!=='css') continue;
      n++;
      if(!seen[nm]){ seen[nm]=1; fresh++; }
    }
    /* 每个新出现的资源都落一团水 + 一个泛光框（后半段的 chunk、字体、
       图片也会走到这里）。框按资源所在区域映射，不再固定成「主区域」。 */
    for(i=0;i<list.length;i++){
      var r0=list[i], nm0=r0&&r0.name||'';
      if(!fresh) break;
      if(!seen['flashed:'+nm0]&&nm0.indexOf('/plugins')<0&&nm0.indexOf('/api')<0){
        seen['flashed:'+nm0]=1;
        pour(0.014,150+Math.random()*90);
        var rid0=pushRow(t('resources')+' · '+shortName(nm0));
        /* 资源已经加载完才会出现在 entries 里，所以立刻标记完成，
           耗时取该条目自己的 duration（不是 push 到现在的时间）。 */
        for(var ri=0;ri<rows.length;ri++){
          if(rows[ri].id===rid0){
            rows[ri].done=true;
            rows[ri].ms=Math.max(0,Math.round(r0.duration||0));
            renderList();
            break;
          }
        }
        flashGlow(nm0);
        if(window.__blDiag) window.__blDiag.resourceGlow++;
        if(--fresh<=0) break;
      }
    }
    setDetail(t('resources'),Math.min(n,expected),expected);
    status.textContent=n<expected?t('downloading'):t('resourcesReady');
  }
  var resTimer=setInterval(checkResources,140); checkResources();
  try{ new PerformanceObserver(function(){ checkResources(); }).observe({type:'resource',buffered:true}); }catch(e){}

  /* ---- 挂载信号：只用来更新文案与补一团水，不做完成判定 ---- */
  var mo=null, mountFired=false;
  function watchRoot(){
    if(mountFired) return true;
    var root=document.getElementById('root');
    if(!root) return false;
    if(root.childNodes.length>0){
      mountFired=true;
      pour(0.025,180);
      status.textContent=t('uiReady');
      setDetail(null);
      if(mo){ mo.disconnect(); mo=null; }
      return true;
    }
    if(!mo){
      mo=new MutationObserver(function(){
        var r=document.getElementById('root');
        if(r&&r.childNodes.length>0) watchRoot();
      });
      mo.observe(root,{childList:true,subtree:true});
    }
    return false;
  }
  watchRoot();
  var mountTimer=setInterval(function(){ if(watchRoot()) clearInterval(mountTimer); },100);

  pour(0.03,120,0.5);
  startIdleWave();

  /* ---- 失败态 ---- */
  var fails=[], FAIL_MAX=3, failShown=false;
  function esc(v){
    return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function renderFails(){
    var box=document.getElementById('__bl_fails');
    var plate=document.getElementById('__bl_text');
    if(!box) return;
    var on=fails.length>0;
    box.classList.toggle('__on',on);
    if(plate) plate.classList.toggle('__fail',on);
    if(el) el.classList.toggle('__fail',on);
    var titleEl=document.getElementById('__bl_title');
    if(titleEl) titleEl.classList.toggle('__fail',on);
    if(!on){ box.innerHTML=''; if(titleEl) titleEl.textContent=t('title'); failShown=false; return; }
    if(!failShown){ failShown=true; if(titleEl) titleEl.textContent=t('failedTitle'); }
    var html='';
    for(var i=0;i<fails.length&&i<FAIL_MAX;i++){
      html+='<div class="__bl_fail_row"><span class="__bl_fail_name">'+esc(fails[i].name)+
            '</span><span class="__bl_fail_reason">'+esc(fails[i].reason)+'</span></div>';
    }
    if(fails.length>FAIL_MAX){
      html+='<div class="__bl_fail_row"><span class="__bl_fail_reason">'+
            t('failedMore',{n:fails.length-FAIL_MAX})+'</span></div>';
    }
    box.innerHTML=html;
    if(typeof syncPlateHeight==='function') syncPlateHeight();
  }
  function noteFailure(name,reason){
    if(done||removed) return;
    if(fails.length>=24) return;
    fails.push({name:name||'?',reason:reason||'unknown'});
    renderFails();
  }

  /* ============================================================
   * 对外接口：动态层（官方事件）用它驱动这层视觉。
   * 没有动态层接续时，定时波浪也能独立跑完整段加载。
   * ========================================================== */
  /* ---- 收工 ---- */
  var finishRetry=0;
  function finish(reason){
    if(done) return;
    /* 守卫：事件说「好了」但页面还没挂内容时，延后再收工，
       避免出现「遮罩消失但页面是空的」。最多重试 6 次（约 3s）。 */
    var rootEl=document.getElementById('root');
    var painted=!!(rootEl&&rootEl.childNodes.length>0);
    if(!painted&&finishRetry<6){
      finishRetry++;
      setTimeout(function(){ finish(reason); },500);
      return;
    }
    done=true;
    if(visualTimer){ clearInterval(visualTimer); visualTimer=null; }
    if(resTimer){ clearInterval(resTimer); resTimer=null; }
    if(worker) worker.postMessage({type:'finish'});
    var st=document.getElementById('__bl_status');
    if(st) st.textContent=t('done');
    setDetailText(reason||'');
    try{
      var rr=document.getElementById('root');
      window.__betterloadingDone={
        reason:reason||'',
        failed:(typeof fails!=='undefined')?fails.length:0,
        rootText:rr?(rr.innerText||'').length:-1,
        atMs:Math.round(performance.now())
      };
    }catch(e){}
    if(el) el.classList.add('__done');
    setTimeout(function(){
      removed=true;
      if(worker){ worker.terminate(); worker=null; }
      if(el&&el.parentNode) el.parentNode.removeChild(el);
    },1500);
  }

  /* ---- 退出 ----
     正常退出由动态层驱动：客户端 bundle 订阅官方 sessions 事件
     （api-session/added 的静默期 = 历史填充完毕），然后调本接口 finish()。
     这里只保留硬超时，保证「动态层没接续」时也不会永久遮挡 ——
     不再用「#root 里有几个字」这种启发式判断。 */
  setTimeout(function(){ if(!done) finish(t('timeout')); },CFG.idleTimeoutMs);

  window.__blDiag={flashCalls:0,lit:0,peak:0,domGlow:0,resourceGlow:0};

  /* ---- DOM 元素级泛光 ----
     后半段的元素多是 React 渲染出来的，没有网络资源条目，只能观察 DOM。
     小元素自己画框看不出来，所以取「新增节点所在的可见块」：
     优先用尺寸足够大的父容器区域，其次才是元素本身。 ---- */
  (function watchDomGlow(){
    if(typeof MutationObserver!=='function') return;
    var pending=[];
    try{
      new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          var added=muts[i].addedNodes;
          for(var j=0;j<added.length;j++){
            var n=added[j];
            if(!n||n.nodeType!==1) continue;
            if(n.id&&n.id.indexOf('__bl')===0) continue;
            pending.push(n);
            if(pending.length>200) pending.splice(0,100);
          }
        }
      }).observe(document.body,{childList:true,subtree:true});
    }catch(e){ return; }

    function areaFor(node){
      /* 向上找第一个「够大」的祖先作为高亮区域；找不到就用自己 */
      var cur=node, best=null;
      for(var d=0;d<5&&cur;d++){
        var r=cur.getBoundingClientRect();
        if(r.width>=120&&r.height>=40&&r.bottom>0&&r.top<window.innerHeight){
          best={r:r,area:r.width*r.height};
          break;
        }
        cur=cur.parentElement;
      }
      if(best) return best.r;
      var r0=node.getBoundingClientRect();
      if(r0.width<8||r0.height<8) return null;
      if(r0.bottom<0||r0.top>window.innerHeight) return null;
      return r0;
    }

    setInterval(function(){
      if(done||!pending.length) return;
      var batch=pending; pending=[];
      var shown=0;
      for(var i=0;i<batch.length&&shown<4;i++){
        var n=batch[i];
        if(!n.isConnected) continue;
        var r=areaFor(n);
        if(!r) continue;
        flashGlowRect(r);
        shown++;
      }
    },220);
  })();

  function flashGlowRect(r){
    if(done) return;
    if(!glowPool.length&&glowBusy.length>=12) return;
    var g=glowPool.shift();
    if(!g){ g=addGlow(); if(!g) return; }
    var pad=4;
    g.style.width=Math.max(28,r.width+pad*2)+'px';
    g.style.height=Math.max(16,r.height+pad*2)+'px';
    g.style.transform='translate3d('+Math.max(0,r.left-pad)+'px,'+Math.max(0,r.top-pad)+'px,0)';
    var item={el:g,x:r.left,y:r.top,w:r.width};
    glowBusy.push(item);
    lightGlow(item);
  }

  window.__betterloading={
    version:1,
    pour:function(v,f,p){ pour(v,f,p); },
    finish:function(reason){ finish(reason); },
    fail:function(name,reason){ noteFailure(name,reason); },
    status:function(txt){ var st=document.getElementById('__bl_status'); if(st) st.textContent=txt; },
    row:function(name){ return pushRow(name); },
    rowDone:function(id){ finishRow(id); },
    detail:function(a,b,c){ if(b===undefined) setDetailText(a); else setDetail(a,b,c); },
    glow:function(url){ flashGlow(url); },
    get done(){ return done; }
  };
  /* 让动态层知道静态层已经就位 */
  window.__BETTERLOADING_HOST__=true;
})();
`;
}

/**
 * worker 源码（以 `text/js-worker` 内联在页面里，主线程用 Blob 加载）。
 * 用内联而不是拼接字符串，避免模板字面量转义把正则/反斜杠吃掉。
 */
const WORKER_SRC = `
/* betterloading 动画 worker：波动方程 + OffscreenCanvas 绘制全部在这里，
   与 dsh 的 JS 不在同一个事件循环，主线程只剩低频 DOM 更新。 */
var VW=0,VH=0,dpr=1,dark=false,CFG=null,cx=null,cv=null,ready=false;
var N=96,u=new Float32Array(N),v=new Float32Array(N),acc=new Float32Array(N);
var C2=200,DAMP=0.35,amp=1.0,simLast=0,BAND=110;
var blobs=[],queue=[],committed=0,settled=0,MAX_BLOB=0.04,done=false,finishing=false;
var curLevel=0,prevLevel=0,lastEmit=0,lastFrame=0,nextStir=0;
var JW=[];

(function(){
  var sum=0,d,i;
  for(d=-5;d<=5;d++){ var w=Math.exp(-d*d/4.0); JW.push(w); sum+=w; }
  var avg=sum/JW.length;
  for(i=0;i<JW.length;i++) JW[i]=(JW[i]-avg)/0.72;
})();

function now(){ return (self.performance&&performance.now)?performance.now():Date.now(); }
function smooth(x){ x=x<0?0:(x>1?1:x); return x*x*(3-2*x); }

function makeBlob(vol,fall,pos){
  return {t0:now(),fall:fall||(170+Math.random()*180),
    dur:480+Math.random()*420+vol*1200,vol:vol,pos:pos,landed:false};
}
function pourImpl(vol,fallMs,pos){
  if(done) return;
  vol=Math.max(0,Math.min(vol,MAX_BLOB,0.9999-committed));
  if(vol<=0.0005) return;
  var px=(pos===undefined)?(0.18+0.64*Math.random()):pos;
  if(blobs.length>=8||queue.length>0){
    if(queue.length<64){ committed+=vol; queue.push({vol:vol,fall:fallMs,pos:px}); }
    return;
  }
  committed+=vol; blobs.push(makeBlob(vol,fallMs,px));
}
function drainQueue(){
  while(queue.length>0&&blobs.length<8){ var x=queue.shift(); blobs.push(makeBlob(x.vol,x.fall,x.pos)); }
}
function levelAt(t){
  drainQueue();
  var lv=settled;
  for(var i=blobs.length-1;i>=0;i--){
    var b=blobs[i];
    if(t-b.t0<b.fall) continue;
    var p=(t-b.t0-b.fall)/b.dur;
    if(p>=1){ settled+=b.vol; blobs.splice(i,1); continue; }
    lv+=b.vol*smooth(p);
  }
  return Math.max(0,Math.min(1,lv));
}
function jolt(pos,force){
  var k=Math.max(5,Math.min(N-6,Math.round(pos*N)));
  for(var d=-5;d<=5;d++) v[k+d]-=force*JW[d+5];
}
function activeBlobs(t){
  var a=0,w=0;
  for(var i=0;i<blobs.length;i++){
    var b=blobs[i],dt=t-b.t0-b.fall;
    if(dt<0||dt>b.dur) continue;
    a++; if(b.vol>w) w=b.vol;
  }
  return {count:a,vol:w};
}
function consumeLanded(t){
  for(var i=0;i<blobs.length;i++){
    var b=blobs[i];
    if(!b.landed&&t-b.t0>=b.fall){ b.landed=true; jolt(b.pos,3.2+b.vol*16.0); }
  }
}
function removeMean(){
  var mu=0,mv=0,i;
  for(i=0;i<N;i++){ mu+=u[i]; mv+=v[i]; }
  mu/=N; mv/=N;
  if(Math.abs(mu)>1e-6) for(i=0;i<N;i++) u[i]-=mu;
  if(Math.abs(mv)>1e-6) for(i=0;i<N;i++) v[i]-=mv*0.55;
}
function stepSim(t){
  var dt=Math.min(0.033,(t-simLast)/1000); simLast=t;
  consumeLanded(t);
  var act=activeBlobs(t);
  if(!done&&act.count>0&&t>=nextStir){
    nextStir=t+70+Math.random()*150;
    jolt(0.15+0.70*Math.random(),(Math.random()<0.5?1:-1)*(0.9+act.vol*5.5));
  }
  if(done) amp*=Math.pow(0.955,dt*60);
  var h=1/60,steps=Math.min(2,Math.max(1,Math.round(dt/h)));
  for(var sp=0;sp<steps;sp++){
    for(var i=1;i<N-1;i++) acc[i]=C2*(u[i-1]+u[i+1]-2*u[i])-DAMP*v[i];
    acc[0]=C2*(u[1]-u[0])-DAMP*v[0];
    acc[N-1]=C2*(u[N-2]-u[N-1])-DAMP*v[N-1];
    for(var j=0;j<N;j++){ v[j]+=acc[j]*h; u[j]+=v[j]*h; }
  }
  removeMean();
}
function baseYFor(lv){
  var b=VH*(1-lv);
  var lt=Math.min(1,lv/0.12); lt=lt*lt*(3-2*lt);
  return b-(1-lt)*26;
}
function trace(ys,off){
  cx.beginPath(); cx.moveTo(0,ys[0]+off);
  for(var i=0;i<N-1;i++){
    var x0=i/(N-1)*VW, x1=(i+1)/(N-1)*VW;
    cx.quadraticCurveTo(x0,ys[i]+off,(x0+x1)/2,(ys[i]+ys[i+1])/2+off);
  }
  cx.lineTo(VW,ys[N-1]+off);
}
function frame(){
  if(!ready||done&&curLevel>0.999){ return; }
  var t=now();
  if(t-lastFrame<30){ setTimeout(frame,10); return; }   /* ~30Hz 绘制 */
  lastFrame=t;
  curLevel=levelAt(t);
  if(curLevel<prevLevel) curLevel=prevLevel; else prevLevel=curLevel;
  stepSim(t);
  /* 绘制窄带：水面在画布内的 y */
  var base=baseYFor(curLevel);
  var top=Math.max(0,Math.min(VH-BAND*2,Math.round(base-BAND)));
  var h=Math.min(BAND*2,VH);
  cx.setTransform(dpr,0,0,dpr,0,0);
  cx.clearRect(0,0,VW,h);
  var ly=base-top, ys=new Float32Array(N), i;
  for(i=0;i<N;i++) ys[i]=ly+34*Math.tanh(u[i]*CFG.amplitude*amp/34);
  var g=cx.createLinearGradient(0,ly,0,Math.min(h,ly+70));
  g.addColorStop(0,dark?'rgba(150,195,255,.14)':'rgba(120,160,225,.12)');
  g.addColorStop(1,'rgba(120,160,225,0)');
  trace(ys,0); cx.lineTo(VW,Math.min(h,ly+70)); cx.lineTo(0,Math.min(h,ly+70)); cx.closePath();
  cx.fillStyle=g; cx.fill();
  trace(ys,-1.6);
  cx.strokeStyle=dark?'rgba(0,0,0,.5)':'rgba(60,84,130,.42)'; cx.lineWidth=2; cx.stroke();
  trace(ys,1.1);
  cx.strokeStyle=dark?'rgba(205,230,255,.9)':'rgba(255,255,255,.98)'; cx.lineWidth=2; cx.stroke();
  /* 每 100ms 把水位 + 裁剪路径交给主线程（DOM 只能在那边改） */
  if(t-lastEmit>=100){
    lastEmit=t;
    var d='M 0 0 H '+VW.toFixed(0)+' V '+(ys[N-1]+top).toFixed(1);
    for(var k=N-1;k>=0;k-=3) d+=' L '+(k/(N-1)*VW).toFixed(1)+' '+(ys[k]+top).toFixed(1);
    d+=' L 0 '+(ys[0]+top).toFixed(1)+' Z';
    self.postMessage({type:'state',level:curLevel,top:top,clip:d});
  }
  setTimeout(frame,10);
}

self.onmessage=function(e){
  var m=e.data||{};
  if(m.type==='init'){
    cv=m.canvas; cx=cv.getContext('2d',{alpha:true});
    VW=m.VW; VH=m.VH; dpr=m.dpr; dark=m.dark;
    CFG=m.cfg; C2=CFG.waveSpeed||200; DAMP=CFG.damping||0.35; MAX_BLOB=CFG.maxBlob||0.04;
    cv.width=Math.round(VW*dpr); cv.height=Math.round(Math.min(BAND*2,VH)*dpr);
    ready=true; simLast=now(); prevLevel=0; curLevel=0;
    setTimeout(frame,0);
  } else if(m.type==='resize'){
    VW=m.VW; VH=m.VH; dpr=m.dpr;
    if(cv){ cv.width=Math.round(VW*dpr); cv.height=Math.round(Math.min(BAND*2,VH)*dpr); }
  } else if(m.type==='theme'){
    dark=m.dark;
  } else if(m.type==='pour'){
    pourImpl(m.vol,m.fall,m.pos);
  } else if(m.type==='finish'){
    if(done) return;
    var need=0.9999-committed,z=0;
    while(z<24&&need>0){ pourImpl(Math.min(MAX_BLOB,need),120+z*55); need-=MAX_BLOB; z++; }
    done=true;
  }
};
`;

/**
 * 注册 index 注入行。
 * @param ctx - Cordis 上下文。
 * @param config - 已校验的 {@link Config}。
 */
export function apply(ctx, config) {
  const cfg = config ?? {};
  const style = buildStyle(cfg);
  const script = buildScript(cfg);
  ctx.inject(["webServer"], (webCtx) => {
    return webCtx.on("webserver/index-inject", (table) => {
      table.push({ kind: "style", text: style });
      /* 顺序很重要：注入行按 table 顺序插到 <body> 开头，主线程脚本必须先能读到
         worker 源码，否则拿到的 __bl_wsrc 是 null，worker 不会启动。 */
      table.push({ kind: "html", placement: "body",
        html: `<script type="text/js-worker" id="__bl_wsrc">${WORKER_SRC}</script>` });
      table.push({ kind: "html", placement: "body", html: HTML });
      table.push({ kind: "script", placement: "body", text: script });
    });
  });
}

/** 内部构造器，仅供自检脚本使用（不参与运行时契约）。 */
export const internals = { buildStyle, buildScript, WORKER_SRC };

export default { name, inject, Config, apply };

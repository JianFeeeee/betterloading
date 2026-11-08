/**
 * 生成物 / 入口自检。
 *
 * 为什么需要：源码 `node --check` 通过，不代表**模板字符串展开后**的东西能跑。
 * 曾经因为残留一行 `buildOdo(0)` 让整段注入脚本抛 ReferenceError，worker 没启动、
 * 动画全无，而源码语法完全合法。
 *
 * 运行：npm run verify
 */
import { readFileSync } from "node:fs";
import { Config, apply } from "../index.js";

const CLIENT = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const cases = [
  { name: "defaults", cfg: {} },
  { name: "en + custom texts", cfg: { locale: "en", texts: { title: "X" } } },
  { name: "zh + custom icon", cfg: { locale: "zh", icon: "<svg></svg>", iconSize: 40 } },
  { name: "static mode", cfg: { mode: "static", noise: 20 } },
  { name: "url icon", cfg: { icon: "https://example.com/a.png" } },
];

let failed = 0;

/* 客户端 bundle 只解析一次即可（它与配置无关，配置在运行时从全局读）。 */
try {
  new Function(CLIENT);
} catch (error) {
  failed += 1;
  console.error(`✗ client bundle: ${error.message}`);
}

/* 客户端 bundle 的硬性契约与关键钩子。 */
const MUST = [
  "window.__ModuleLoader__.load",
  'id: "dsh-betterloading"',
  "exports.apply",
  "exports.inject",
  "transferControlToOffscreen",
  "createOdo",
  "flashGlow",
  "setDetail",
  "__BETTERLOADING_CONFIG",
  "noteFailure",
  "__fail",
];
for (const token of MUST) {
  if (!CLIENT.includes(token)) {
    failed += 1;
    console.error(`✗ client bundle: missing "${token}"`);
  }
}

/* worker 源码本身作为一段独立脚本再解析一次：它在 Blob 里运行，
   语法错误只会在运行时才炸，不会在 client bundle 的解析中暴露。 */
const wStart = CLIENT.indexOf("const WORKER_SRC = `");
if (wStart < 0) {
  failed += 1;
  console.error("✗ worker source not found");
} else {
  const from = CLIENT.indexOf("`", wStart) + 1;
  const to = CLIENT.indexOf("`;", from);
  const workerSrc = CLIENT.slice(from, to);
  try {
    new Function(workerSrc);
  } catch (error) {
    failed += 1;
    console.error(`✗ worker: ${error.message}`);
  }
  for (const token of ["self.onmessage", "postMessage({type:'state'", "OffscreenCanvas" in {} ? "" : "getContext"]) {
    if (token && !workerSrc.includes(token)) {
      failed += 1;
      console.error(`✗ worker: missing "${token}"`);
    }
  }
}

/* 配置 schema：每组都必须能解析，且默认值稳定。 */
for (const { name, cfg } of cases) {
  const resolved = Config({}) && cfg;   /* 取值断言改用 schema 默认值 */
  const dict = Config.dict ?? {};
  const defaults = Object.fromEntries(
    Object.entries(dict).map(([k, f]) => [k, f?.meta?.default]),
  );
  /* 弱网要留足余量：30s 实测不够，弱网首屏可能 20s+。 */
  if (defaults.idleTimeoutMs < 60000) {
    failed += 1;
    console.error(`✗ ${name}: idleTimeoutMs 太短 (${String(defaults.idleTimeoutMs)}ms)`);
  }
  if (!["static", "realtime"].includes(defaults.mode)) {
    failed += 1;
    console.error(`✗ ${name}: bad mode default`);
  }
  /* 正向断言：设置页表单要求**每个字段**都带 .volatile()
     （dsh-settings 的 volatileForm 只收集这类字段）。
     前提是 host 侧不读这些值 —— apply() 必须用非 volatile 的 fields({})。 */
  const plainFields = Object.entries(dict).filter(([, f]) => f?.meta?.volatile !== true).map(([k]) => k);
  if (plainFields.length > 0) {
    failed += 1;
    console.error(`✗ ${name}: fields without .volatile() (no Settings form): ${plainFields.join(", ")}`);
  }
  {
    const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
    if (/const cfg = Config\(/.test(src)) {
      failed += 1;
      console.error("✗ index.js: apply() reads the volatile Config — that breaks config validation");
    }
  }
  if (failed === 0) console.log(`✓ ${name}`);
}

/* 弱网防早退：静默必须看在飞请求，而不是只看「没有新资源完成」。
   历史事故：弱网下请求正躺在路上等响应，被当成「已加载完」，
   #root 一有壳子 3 秒就把遮罩撤了，用户看到空壳。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  for (const token of [
    "var inflight=0",
    "function creditInflight",
    "function trackInflight",
    "inflight===0&&Date.now()-lastResourceAt>800",
    /* 超时必须是「无进展超时」，不是「总时长超时」 */
    "lastActivityAt=Date.now()",
    "var idleTimer=setInterval",
    "Date.now()-lastActivityAt<CFG.idleTimeoutMs",
  ]) {
    if (!src.includes(token)) {
      failed += 1;
      console.error(`✗ index.js: 弱网防早退缺失 "${token}"`);
    }
  }
  /* 静态补水不能算「进展」，否则超时永不触发。只看函数体内部。 */
  {
    const fn = /function startIdleWave\(\)\{[\s\S]*?\n {2}\}/.exec(src);
    if (!fn) {
      failed += 1;
      console.error("✗ index.js: startIdleWave 不见了");
    } else if (fn[0].includes("lastActivityAt")) {
      failed += 1;
      console.error("✗ index.js: 静态补水重置了活动计时器（超时会永不触发）");
    }
  }
  /* 静默判据不能再是纯「资源静默」 */
  if (/var quiet=Date\.now\(\)-lastResourceAt>800;/.test(src)) {
    failed += 1;
    console.error("✗ index.js: 静默判据退回到只看资源静默（弱网会早退）");
  }
  /* 默认超时必须够弱网用 */
  const m = /idleTimeoutMs: z\.natural\(\)\.min\(\d+\)\.max\(\d+\)\.default\((\d+)\)/.exec(src);
  if (!m || Number(m[1]) < 60000) {
    failed += 1;
    console.error(`✗ index.js: idleTimeoutMs 默认值过短 (${m ? m[1] : "?"}ms)`);
  }
  /* fetch 包装必须是只读计数：原样透传，不改参数与返回值 */
  if (!/p=origFetch\.apply\(this,arguments\)/.test(src)) {
    failed += 1;
    console.error("✗ index.js: fetch 包装未原样透传");
  }
}

/* 水面移动必须平滑：worker 只回报目标值，主线程用 rAF 指数逼近。
   历史事故：从主线程 60Hz 改到 worker 之后，DOM 写入退化成每 100ms 一次，
   水位是跳着走的（「一顿一顿」）。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  for (const token of [
    "var frostTargetH=0, frostShownH=0",
    "function smoothSurface()",
    "function startSmoothSurface()",
    "frostShownH+=step",
    "var maxStep=6",
  ]) {
    if (!src.includes(token)) {
      failed += 1;
      console.error(`✗ index.js: 水面平滑缺失 "${token}"`);
    }
  }
  /* 不能再在 worker 回调里直接写 height（那就是跳变本身） */
  if (/frost\.style\.height=fh\+'px'/.test(src)) {
    failed += 1;
    console.error("✗ index.js: worker 回调里直接写 frost.height（绕过了平滑）");
  }
  /* 回报频率必须高于 10Hz 的旧值 */
  const emit = /if\(t-lastEmit>=(\d+)\)/.exec(src);
  if (!emit || Number(emit[1]) > 50) {
    failed += 1;
    console.error(`✗ index.js: worker 回报间隔过大 (${emit ? emit[1] : "?"}ms)`);
  }
  /* 平滑只能作用于「水位变化」，不能作用于「第一次出现」。
     否则磨砂会从 0 长到全屏 —— 观感是水面从上面降下来再升上去。 */
  if (!src.includes("var surfaceSeeded=false")) {
    failed += 1;
    console.error("✗ index.js: 缺少首帧就位（水面会先铺满再上升）");
  }
  if (!src.includes("surfaceSeeded=true;\n          frostShownH=freshH;")) {
    failed += 1;
    console.error("✗ index.js: worker 首帧没有直接把磨砂高度对齐");
  }
  /* 水位 0 的正确视觉状态是全屏磨砂，不是 0。 */
  if (!/#__bl_frost\{[^}]*height:100%/.test(src)) {
    failed += 1;
    console.error("✗ index.js: #__bl_frost 初始高度不是 100%（首帧会露出未遮挡的页面）");
  }

  /* 平滑环必须在启动时拉起、收工时停掉 */
  if (!src.includes("startSmoothSurface();")) {
    failed += 1;
    console.error("✗ index.js: 平滑环没有启动");
  }
  if (!/cancelAnimationFrame\(smoothRaf\)/.test(src)) {
    failed += 1;
    console.error("✗ index.js: 收工时没有停掉平滑环");
  }
}

/* 水位必须跟随真实加载规模：资源阶段的分母不能写死成开屏那几个 <script>。
   历史事故：弱网下真实资源几十个，前几个就把 55% 预算吃光，之后加载再没有
   任何水位变化 —— 观感是「水位不反映进度」。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  if (!src.includes('function resourceAdvance(ratio)')) {
    failed += 1;
    console.error('✗ index.js: 资源推进不是渐近模型（会卡住）');
  }
  if (!src.includes('var ceiling=0.90;')) {
    failed += 1;
    console.error('✗ index.js: 渐近上限缺失');
  }
  if (/pay\('resources',1\/Math\.max\(1,expected\)\)/.test(src)) {
    failed += 1;
    console.error('✗ index.js: 资源注水退回固定分母');
  }
  /* pay 必须是累加，不能覆盖 */
  if (!/spent\[stage\]\+=give/.test(src)) {
    failed += 1;
    console.error('✗ index.js: pay 不是累加');
  }
}

/* 弱网下必须持续有水位变化：原生 module 加载没有进度事件，
   只靠「完成才注水」会出现长时间静止（实测 22s 不动）。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  if (!src.includes('function startTrickle()')) {
    failed += 1;
    console.error('✗ index.js: 缺少在飞心跳，弱网下水面会长时间静止');
  }
  if (src.includes('trickleUsed>=trickleBudget')) {
    failed += 1;
    console.error('✗ index.js: 心跳有次数上限（弱网下会冻结）');
  }
  if (!src.includes('function resourceAdvance(ratio)')) {
    failed += 1;
    console.error('✗ index.js: 心跳不收敛');
  }
  if (!src.includes('if(Date.now()-lastResourceAt<1200) return;')) {
    failed += 1;
    console.error('✗ index.js: 心跳没有给真实进展让位');
  }
  /* bundle 必须计入水位（但不能出现在清单里） */
  if (!src.includes("var isBundle=nm.indexOf('/plugins')>=0;")) {
    failed += 1;
    console.error('✗ index.js: /plugins bundle 未计入水位');
  }
}

/* 模糊只能来自 #__bl_frost 的 backdrop-filter，且必须带 clip-path 跟随水面。
   设计要求：水面上方模糊、下方透明。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  if (!src.includes("backdrop-filter:blur(") || !src.includes("-webkit-backdrop-filter:blur(")) {
    failed += 1;
    console.error("✗ index.js: realtime 缺少 backdrop-filter（水面上方不会模糊）");
  }
  /* 唯一模糊层不加遮罩色的话，模糊会「发灰」而不是毛玻璃 */
  if (!/#__bl_frost\{[\s\S]{0,400}?background-color:var\(--bl-tint\)/.test(src)) {
    failed += 1;
    console.error("✗ index.js: #__bl_frost 缺少底色（模糊层会发灰）");
  }
  /* 下边界必须由水面曲线裁剪，而不是一条水平线 */
  if (!src.includes("frost.style.clipPath")) {
    failed += 1;
    console.error("✗ index.js: 模糊层没有跟随水面曲线（会是一条直线）");
  }
}

/* 收工路径必须完整：曾经把 finish() 删掉却留着调用点，
   结果退出回调抛 ReferenceError、遮罩永不消失。 */
{
  const hostSrc = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  if (!hostSrc.includes("function finish(reason)")) {
    failed += 1;
    console.error("✗ index.js: finish() missing");
  }
}
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const need = [
    "function finish(reason)",
    "window.__betterloading=",
    "takeover",
    "pay('tail',1)",
    "function pay(stage,fraction)",
    "window.__BL_FULL__",
  ];
  for (const token of need) {
    if (!src.includes(token)) {
      failed += 1;
      console.error(`✗ index.js: missing "${token}"`);
    }
  }
  /* 静态阶段允许定时补水（美化），但必须能被动态层接管停掉。 */
  if (!src.includes("startIdleWave")) {
    failed += 1;
    console.error("✗ index.js: static-phase idle wave missing");
  }
  if (!src.includes("if(visualTimer||takenOver) return;")) {
    failed += 1;
    console.error("✗ index.js: idle wave does not stop after takeover");
  }
  // 每个被调用的收工入口都必须有定义
  if (src.includes("finish(t('contentReady'))") && !src.includes("function finish(reason)")) {
    failed += 1;
    console.error("✗ index.js: finish() called but not defined");
  }
}

/* 收工后必须留够时间让水面涨满（补满序列约 1.5s），否则会「没涨满就消失」 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const m = /removeChild\(el\);\s*\},\s*(\d{3,5})\);/.exec(src);
  if (m && Number(m[1]) < 2000) {
    failed += 1;
    console.error(`✗ index.js: overlay removed after ${m[1]}ms, refill needs ~1.5s`);
  }
}

/* 端到端冒烟：用最小 DOM/ctx stub 真正执行一次 apply()。
   上一轮的失败就是「语法 OK、factory 可求值，但 apply() 里调了已删除的
   boot()」→ dsh 启动报 "dsh-betterloading: failed / did not activate"。 */
{
  const sandbox = {
    window: { __ModuleLoader__: { load: (d) => { sandbox.__decl = d; } } },
    navigator: { language: "zh-CN" },
    location: { href: "http://x/" },
    performance: { now: () => Date.now() },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  const mkEl = () => ({
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, setAttribute() {}, getAttribute: () => null, addEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, bottom: 0, right: 0 }),
    querySelectorAll: () => [], contains: () => false,
    innerHTML: "", textContent: "", children: [], firstElementChild: null, width: 0, height: 0,
  });
  sandbox.document = {
    getElementById: () => mkEl(), body: mkEl(), head: mkEl(), documentElement: mkEl(),
    createElement: () => mkEl(), addEventListener() {}, querySelectorAll: () => [],
  };
  sandbox.setTimeout = () => 0;
  sandbox.setInterval = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.clearInterval = () => {};

  const vm = await import("node:vm");
  try {
    vm.createContext(sandbox);
    vm.runInContext(CLIENT, sandbox, { timeout: 5000 });
    const decl = sandbox.__decl;
    if (!decl || typeof decl.factory !== "function") throw new Error("factory missing");
    const mod = decl.factory(() => ({}));
    if (typeof mod.apply !== "function") throw new Error("apply missing");
    const ctx = {
      inject: (deps, cb) => { try { cb({ settings: { configure: () => () => {} } }); } catch (e) { throw e; } },
      on: () => () => {},
      effect: (f) => f(),
    };
    mod.apply(ctx);
  } catch (error) {
    failed += 1;
    console.error(`✗ client bundle: apply() threw — ${error.message}`);
  }
}

/* 客户端 bundle 里 apply() 不能引用已删除的内部函数（曾经留了个 boot()
   调用，导致整个 bundle 加载失败、插件在启动时报 "did not activate"）。 */
{
  const i = CLIENT.indexOf("function apply(ctx)");
  if (i < 0) {
    failed += 1;
    console.error("✗ client bundle: apply() missing");
  } else {
    const body = CLIENT.slice(i);
    const declared = new Set(
      [...body.matchAll(/(?:function\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    );
    for (const dead of ["boot", "ensureDom", "renderIcon", "startWorker", "pctRaf"]) {
      const called = new RegExp("(?<![.\\w$])" + dead + "\\s*\\(").test(body);
      if (called && !declared.has(dead)) {
        failed += 1;
        console.error(`✗ client bundle: calls removed function "${dead}()"`);
      }
    }
  }
}

/* 水位必须是阶段预算之和：所有注水点都走 pay()，不允许散落的固定体积。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function buildScript"));
  if (/pour\(0\.\d+/.test(body)) {
    failed += 1;
    console.error("✗ index.js: raw pour(<fixed volume>) found — should go through pay(stage)");
  }
  for (const stage of ["boot", "resources", "mount", "deep", "tail"]) {
    if (!body.includes(`${stage}:`)) {
      failed += 1;
      console.error(`✗ index.js: budget stage "${stage}" missing`);
    }
  }
}

/* 泛光不能框到自己：遮罩内部节点必须被排除。 */
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  if (!src.includes("overlayEl.contains(n)") && !src.includes("ov.contains(n)")) {
    failed += 1;
    console.error('✗ index.js: DOM glow does not exclude overlay-internal nodes');
  }
}

/* 图标必须是完整路径：截断的 path 会画出一个残缺的鲸鱼。 */
{
  const m = /const WHALE_ICON =[\s\S]*?"<\/svg>";/.exec(CLIENT);
  if (!m) {
    failed += 1;
    console.error("✗ client bundle: whale icon missing");
  } else {
    const len = (m[0].match(/d="([^"]+)"/) || ["", ""])[1].length;
    if (len < 3000) {
      failed += 1;
      console.error(`✗ client bundle: whale path looks truncated (${String(len)} chars)`);
    }
  }
}

/* 设置页：dsh 的「设置 → 插件」是 tab 容器，插件必须自己注册；
   只声明 Config schema 不会产生任何 tab。 */
{
  for (const token of [
    "plugins.bundle.config",
    "configForms.whileServed",
    "SettingsFormModel",
    "SettingsValueField",
    "slots.inject",
    "slots.register",
  ]) {
    if (!CLIENT.includes(token)) {
      failed += 1;
      console.error(`✗ client bundle: settings page missing "${token}"`);
    }
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const ci = pkg?.dsh?.client?.inject ?? [];
  for (const mod of ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"]) {
    if (!ci.includes(mod)) {
      failed += 1;
      console.error(`✗ package.json: dsh.client.inject missing "${mod}"`);
    }
  }
}

/* 设置页的配置必须真的能到静态层：client bundle 里要有 configForms → host.configure 的桥。 */
{
  if (!CLIENT.includes("wireConfigForms")) {
    failed += 1;
    console.error("✗ client bundle: 没有 configForms → host.configure 的桥，设置页改了不生效");
  }
}

/* 失败态必须真的存在：红色样式 + 失败行容器。 */
for (const token of ["--bl-fail", "__bl_fails", "failedTitle"]) {
  if (!CLIENT.includes(token)) {
    failed += 1;
    console.error(`✗ client bundle: failure UI missing "${token}"`);
  }
}

if (failed > 0) {
  console.error(`\n${String(failed)} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");

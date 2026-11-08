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
import { Config } from "../index.js";

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
  const resolved = Config(cfg);
  if (resolved.idleTimeoutMs !== 30000) {
    failed += 1;
    console.error(`✗ ${name}: idleTimeoutMs default drifted (${resolved.idleTimeoutMs})`);
  }
  if (!["static", "realtime"].includes(resolved.mode)) {
    failed += 1;
    console.error(`✗ ${name}: bad mode`);
  }
  if (failed === 0) console.log(`✓ ${name}`);
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

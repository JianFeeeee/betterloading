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
if (!CLIENT.includes("function finish(reason)")) {
  failed += 1;
  console.error("✗ client bundle: finish() missing");
}
{
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const need = ["function finish(reason)", "window.__betterloading=", "startIdleWave", "if(!done) finish(t('timeout'))"];
  for (const token of need) {
    if (!src.includes(token)) {
      failed += 1;
      console.error(`✗ index.js: missing "${token}"`);
    }
  }
  // 每个被调用的收工入口都必须有定义
  if (src.includes("finish(t('contentReady'))") && !src.includes("function finish(reason)")) {
    failed += 1;
    console.error("✗ index.js: finish() called but not defined");
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

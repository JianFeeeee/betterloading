/**
 * 生成物自检：把注入用的 CSS/JS 真正生成一遍，再用 new Function 做语法检查。
 *
 * 为什么需要它：源码 `node --check` 通过，不代表**模板字符串展开后**的注入脚本
 * 能运行 —— 曾经因为残留一行 `buildOdo(0)` 让整段脚本抛 ReferenceError，
 * 结果 worker 没启动、动画全无，而源码语法完全合法。
 *
 * 运行：npm run verify
 */
import { Config, internals } from "../index.js";

const cases = [
  { name: "defaults", cfg: {} },
  { name: "en + custom texts", cfg: { locale: "en", texts: { title: "X" } } },
  { name: "zh + custom icon", cfg: { locale: "zh", icon: "<svg></svg>", iconSize: 40 } },
  { name: "static mode", cfg: { mode: "static", noise: 20 } },
  { name: "url icon", cfg: { icon: "https://example.com/a.png" } },
];

let failed = 0;

for (const { name, cfg } of cases) {
  const resolved = Config(cfg);
  const script = internals.buildScript(resolved);
  const worker = internals.WORKER_SRC;
  const style = internals.buildStyle(resolved);

  for (const [label, source] of [["main", script], ["worker", worker]]) {
    try {
      // 只做语法解析，不执行
      new Function(source);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${name} / ${label}: ${error.message}`);
      const line = String(error.stack || "").split("\n").find((l) => l.includes("<anonymous>"));
      if (line) console.error(`  ${line.trim()}`);
    }
  }

  // 生成的 CSS 不能被模板残留打断：粗查花括号配平与关键选择器
  let depth = 0;
  for (const ch of style) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  if (depth !== 0) {
    failed += 1;
    console.error(`✗ ${name} / style: brace imbalance (${String(depth)})`);
  }
  if (resolved.iconSize > 0 && !style.includes("__bl_iconwrap")) {
    failed += 1;
    console.error(`✗ ${name} / style: missing icon rule`);
  }

  // 关键行为标记存在性（防止改模板时静默丢功能）
  const must = ["transferControlToOffscreen", "createOdo", "flashGlow", "setDetail"];
  for (const token of must) {
    if (!script.includes(token)) {
      failed += 1;
      console.error(`✗ ${name} / main: missing "${token}"`);
    }
  }
  if (!worker.includes("postMessage({type:'state'")) {
    failed += 1;
    console.error(`✗ ${name} / worker: missing state emission`);
  }

  /* 未声明标识符检测：语法合法但运行时会 ReferenceError 的调用
     （例如模板改造后残留的 buildOdo(0) 曾让整段脚本中断、worker 没启动）。
     只认「不在 . 之后」的裸标识符调用，避免把方法调用算进来。 */
  const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "function", "return", "typeof",
    "new", "do", "else", "in", "of", "delete", "void", "yield", "await",
    "instanceof", "case", "throw", "super", "import", "export",
  ]);
  const BINOPS = new Set(["document", "window", "self", "globalThis", "Math", "JSON",
    "Object", "Array", "String", "Number", "Boolean", "Date", "Set", "Map",
    "Float32Array", "Uint8Array", "Promise", "Error", "RegExp", "parseInt",
    "parseFloat", "isNaN", "isFinite", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
    "encodeURIComponent", "decodeURIComponent", "URL", "Blob", "Worker",
    "MutationObserver", "PerformanceObserver", "getComputedStyle", "alert"]);

  /* 先剥掉字符串字面量，否则 CSS 值里的 translateY( / path( 会被当成调用 */
  const code = script
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  const declared = new Set();
  for (const m of code.matchAll(/(?:function\s+([A-Za-z_$][\w$]*))|(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1] || m[2]);
  }
  /* 多变量声明：var a=1, b=2, c; —— 补上逗号后面的名字 */
  for (const stmt of code.matchAll(/(?:var|let|const)\s+([^;]*);/g)) {
    for (const part of stmt[1].split(",")) {
      const nm = part.trim().match(/^([A-Za-z_$][\w$]*)\s*(=|$)/);
      if (nm) declared.add(nm[1]);
    }
  }
  for (const m of code.matchAll(/function[^(]*\(([^)]*)\)/g)) {
    for (const part of m[1].split(",")) {
      const nm = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (nm) declared.add(nm[1]);
    }
  }
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

  const missing = new Set();
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const nm = m[1];
    if (KEYWORDS.has(nm) || BINOPS.has(nm) || declared.has(nm)) continue;
    missing.add(nm);
  }
  if (missing.size > 0) {
    failed += 1;
    console.error(`✗ ${name} / main: possibly undeclared call(s): ${[...missing].join(", ")}`);
  }

  if (failed === 0) console.log(`✓ ${name}`);
}

if (failed > 0) {
  console.error(`\n${String(failed)} check(s) failed`);
  process.exit(1);
}
console.log("\nall generated artifacts parse and carry the required hooks");

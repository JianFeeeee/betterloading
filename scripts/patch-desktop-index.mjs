#!/usr/bin/env node
/**
 * 把 betterloading 的注入内容移植到一份「桌面端 index.html」里。
 *
 * 为什么需要这一步：web 端的遮罩由 `webserver/index-inject` 的注入行进页面，
 * 而桌面端（Electron）从 `dsh-app://app/` 读打包产物，`renderIndex` 不被调用，
 * 注入行永远到不了文档。这个脚本把运行中的 web 端 index 里那几段「已经渲染好
 * 的注入内容」抠出来，写进桌面端的 index.html。
 *
 * 用法：
 *   node scripts/patch-desktop-index.mjs \
 *     --snapshot web-index.html \
 *     --target   app/dist/index.html \
 *     --out      app/dist/index.html
 *
 *   # 只看会插入什么，不改文件
 *   node scripts/patch-desktop-index.mjs --snapshot web-index.html --print
 *
 * `--snapshot` 是「装了本插件、正在运行的 dsh web」返回的 index.html 原文，
 * 取法见 docs/desktop.md。
 *
 * 幂等：target 里已有的注入会被移除后再插入，可以反复执行。
 */
import { readFileSync, writeFileSync } from "node:fs";

/** 写入 target 时包住注入内容的注释标记，清除时按它整块删，保证幂等。 */
const WRAP = {
  head: ["<!-- betterloading:head -->", "<!-- /betterloading:head -->"],
  body: ["<!-- betterloading:body -->", "<!-- /betterloading:body -->"],
};

/** 注入段的标记，用来在 snapshot 里定位、在 target 里清除。 */
const MARK = {
  style: "#__bl{position:fixed",
  worker: 'id="__bl_wsrc"',
  overlay: 'id="__bl"',
  script: "window.__betterloading",
};

/**
 * 从 `start` 起找到第一个匹配的闭合标签（含嵌套计数）。
 *
 * @param {string} html - 全文。
 * @param {number} start - 开始位置。
 * @param {string} tag - 标签名，如 `div`。
 * @returns {number} 闭合标签结束后的位置；找不到时返回 -1。
 */
function matchClose(html, start, tag) {
  const open = new RegExp(`<${tag}(?=[\\s>])`, "gi");
  const close = new RegExp(`</${tag}>`, "gi");
  open.lastIndex = start;
  const first = open.exec(html);
  if (first === null) return -1;
  let depth = 0;
  let cursor = first.index;
  for (;;) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(html);
    const c = close.exec(html);
    if (c === null) return -1;
    if (o !== null && o.index < c.index) {
      depth += 1;
      cursor = o.index + o[0].length;
      continue;
    }
    depth -= 1;
    cursor = c.index + c[0].length;
    if (depth === 0) return cursor;
  }
}

/**
 * 从一份已渲染的 index.html 中提取四段注入内容。
 *
 * @param {string} html - web 端的 index.html。
 * @returns {{ head: string, body: string, missing: string[] }} 提取结果。
 */
export function extractInjection(html) {
  const missing = [];

  /* head：包含遮罩样式的那个 <style>。 */
  let head = "";
  const styleAt = html.indexOf(MARK.style);
  if (styleAt < 0) {
    missing.push("style");
  } else {
    const open = html.lastIndexOf("<style", styleAt);
    const close = html.indexOf("</style>", styleAt);
    if (open < 0 || close < 0) missing.push("style");
    else head = html.slice(open, close + "</style>".length);
  }

  /* body：worker 源码 + 遮罩结构 + 主线程脚本，顺序不能变。 */
  let body = "";

  const workerAt = html.indexOf(MARK.worker);
  if (workerAt < 0) {
    missing.push("worker");
  } else {
    const open = html.lastIndexOf("<script", workerAt);
    const close = html.indexOf("</script>", workerAt);
    if (open < 0 || close < 0) missing.push("worker");
    else body += html.slice(open, close + "</script>".length) + "\n";
  }

  const overlayAt = html.indexOf(`<div ${MARK.overlay}`);
  if (overlayAt < 0) {
    missing.push("overlay");
  } else {
    const end = matchClose(html, overlayAt, "div");
    if (end < 0) missing.push("overlay");
    else body += html.slice(overlayAt, end) + "\n";
  }

  const scriptAt = html.indexOf(MARK.script, overlayAt < 0 ? 0 : overlayAt);
  if (scriptAt < 0) {
    missing.push("script");
  } else {
    const open = html.lastIndexOf("<script", scriptAt);
    const close = html.indexOf("</script>", scriptAt);
    if (open < 0 || close < 0) missing.push("script");
    else body += html.slice(open, close + "</script>".length) + "\n";
  }

  return { head, body, missing };
}

/**
 * 把注入内容写进 target index.html。
 *
 * target 里已有的注入先被摘掉，所以这个函数可以反复调用。
 *
 * @param {string} target - 桌面端的 index.html。
 * @param {{head: string, body: string}} injection - `extractInjection` 的结果。
 * @returns {string} 新的 index.html。
 */
export function patchIndex(target, injection) {
  let out = target;

  /* 先整块删掉上一次的注入（按标记），这样反复执行结果完全一致。 */
  for (const [open, close] of [WRAP.head, WRAP.body]) {
    let at = out.indexOf(open);
    while (at >= 0) {
      const end = out.indexOf(close, at);
      const stop = end < 0 ? at : end + close.length;
      /* 连注释后面的换行一起去掉，避免每次多留一个空行。 */
      const tail = out[stop] === "\n" ? stop + 1 : stop;
      out = out.slice(0, at) + out.slice(tail);
      at = out.indexOf(open);
    }
  }

  /* 兜底：手工注入过（没有标记）的情况。 */
  {
    let at = out.indexOf(MARK.style);
    while (at >= 0) {
      const open = out.lastIndexOf("<style", at);
      const close = out.indexOf("</style>", at);
      if (open < 0 || close < 0) break;
      out = out.slice(0, open) + out.slice(close + "</style>".length);
      at = out.indexOf(MARK.style);
    }
  }

  for (const [openTag, closeTag, marker] of [
    ["<script", "</script>", MARK.worker],
    ["<script", "</script>", MARK.script],
  ]) {
    let at = out.indexOf(marker);
    while (at >= 0) {
      const open = out.lastIndexOf(openTag, at);
      const close = out.indexOf(closeTag, at);
      if (open < 0 || close < 0) break;
      out = out.slice(0, open) + out.slice(close + closeTag.length);
      at = out.indexOf(marker);
    }
  }
  {
    let at = out.indexOf(`<div ${MARK.overlay}`);
    while (at >= 0) {
      const end = matchClose(out, at, "div");
      if (end < 0) break;
      out = out.slice(0, at) + out.slice(end);
      at = out.indexOf(`<div ${MARK.overlay}`);
    }
  }

  if (injection.head) {
    const block = `${WRAP.head[0]}\n${injection.head}\n${WRAP.head[1]}\n`;
    const headOpen = /<head(?:\s[^>]*)?>/i.exec(out);
    out =
      headOpen === null
        ? block + out
        : out.slice(0, headOpen.index + headOpen[0].length) +
          block +
          out.slice(headOpen.index + headOpen[0].length);
  }

  if (injection.body) {
    const block = `${WRAP.body[0]}\n${injection.body}${WRAP.body[1]}\n`;
    const bodyOpen = /<body(?:\s[^>]*)?>/i.exec(out);
    out =
      bodyOpen === null
        ? out + block
        : out.slice(0, bodyOpen.index + bodyOpen[0].length) +
          block +
          out.slice(bodyOpen.index + bodyOpen[0].length);
  }

  return out;
}

/**
 * 解析命令行参数。
 *
 * @param {string[]} argv - `process.argv.slice(2)`。
 * @returns {Record<string, string | boolean>} 参数表。
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const isMain = process.argv[1] && process.argv[1].endsWith("patch-desktop-index.mjs");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const usage = `用法:
  node scripts/patch-desktop-index.mjs --snapshot <web-index.html> \\
       (--target <desktop-index.html> --out <file> | --print)

  --snapshot  装了本插件、正在运行的 dsh web 返回的 index.html 原文
  --target    桌面端的 index.html（只读，不改）
  --out       输出路径；与 --target 相同即就地修改
  --print     只打印将要插入的内容，不写文件`;

  if (!args.snapshot || typeof args.snapshot !== "string") {
    console.error(usage);
    process.exit(2);
  }

  const snapshot = readFileSync(args.snapshot, "utf8");
  const injection = extractInjection(snapshot);

  if (injection.missing.length > 0) {
    console.error(
      `✗ 快照里缺少: ${injection.missing.join(", ")}\n` +
        "  说明这份 snapshot 不是装了 betterloading 的 dsh web 返回的 index.html。",
    );
    process.exit(1);
  }

  if (args.print) {
    console.log("<!-- head -->");
    console.log(injection.head);
    console.log("<!-- body -->");
    console.log(injection.body);
    process.exit(0);
  }

  if (!args.target || typeof args.target !== "string" || !args.out || typeof args.out !== "string") {
    console.error(usage);
    process.exit(2);
  }

  const target = readFileSync(args.target, "utf8");
  const patched = patchIndex(target, injection);
  writeFileSync(args.out, patched);
  console.log(
    `✓ 已写入 ${args.out}（head +${injection.head.length} 字节，body +${injection.body.length} 字节）`,
  );
}

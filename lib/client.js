/**
 * betterloading — 客户端 bundle。
 *
 * 为什么走客户端插件而不是 index 注入：
 * `webserver/index-inject` 只影响由 Web Host 渲染的 index；dsh Desktop 是
 * Electron 壳，页面从 `dsh-app://app/` 加载打包产物，renderIndex 不参与，
 * 注入行进不了文档。而客户端 bundle 由 Host 通过 `/plugins` 提供，桌面端
 * 同样请求它 —— 同一份代码在 Web 与 Desktop 都生效。
 *
 * 本 bundle 不依赖任何 dsh 客户端服务（`inject: []`）：它只操作 DOM，
 * 并用一个 Web Worker + OffscreenCanvas 跑水波，主线程只做低频写入。
 */
window.__ModuleLoader__.load({
  id: "dsh-betterloading",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    /* 设置页用到共享基座里的组件；旧版 bundle 从不 require，所以这里必须显式取。 */
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const react = require("react");

    /* ============================================================
     * 内置文案
     * ========================================================== */
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
        failedTitle: "加载失败",
        failedItem: "{name}（{reason}）",
        failedMore: "另有 {n} 项失败",
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
        title: "BetterLoading",
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
        failedTitle: "Load failed",
        failedItem: "{name} ({reason})",
        failedMore: "{n} more failed",
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

    /* dsh 自己的鲸鱼图标（单路径，currentColor 跟随主题）。 */
    const WHALE_ICON =
      '<svg viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z" fill="currentColor"/>' +
      "</svg>";

    /* ============================================================
     * 样式
     * ========================================================== */
    const STYLE = `
#__bl{position:fixed;inset:0;z-index:2147483647;overflow:hidden;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  color:#15181f;pointer-events:none;
  --bl-glass:linear-gradient(150deg,rgba(255,255,255,.86),rgba(255,255,255,.70) 55%,rgba(255,255,255,.80));
  --bl-edge:rgba(24,30,42,.20);
  --bl-shadow:0 8px 30px rgba(20,28,45,.20),inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(20,28,45,.05);
  --bl-textshadow:0 1px 8px rgba(255,255,255,.5);
  --bl-tint:rgba(250,252,255,.55);
  --bl-glow-rgb:110,170,255;
  --bl-fail:#e5484d}
body[data-ds-dark-theme] #__bl{
  color:#eef2fb;
  --bl-glass:linear-gradient(150deg,rgba(38,45,60,.88),rgba(28,34,47,.72) 55%,rgba(34,41,55,.82));
  --bl-edge:rgba(255,255,255,.22);
  --bl-shadow:0 8px 32px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(255,255,255,.06);
  --bl-textshadow:0 1px 10px rgba(0,0,0,.35);
  --bl-tint:rgba(16,20,29,.62)}

#__bl_frost{position:absolute;left:0;top:0;width:100%;height:0;
  background-color:var(--bl-tint);
  transition:opacity .5s ease}
#__bl.__done #__bl_frost{opacity:0}
#__bl_wave{position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;
  opacity:1;transition:opacity .45s ease}
#__bl.__done #__bl_wave{opacity:0}

#__bl_glows{position:absolute;inset:0;pointer-events:none}
.bl-glow{position:absolute;left:0;top:0;pointer-events:none;border-radius:14px;
  box-sizing:border-box;border:1.5px solid rgba(var(--bl-glow-rgb),.85);
  background:
    radial-gradient(ellipse 60% 55% at center,rgba(var(--bl-glow-rgb),.22),rgba(var(--bl-glow-rgb),.06) 62%,transparent 82%),
    linear-gradient(180deg,rgba(var(--bl-glow-rgb),.05),rgba(var(--bl-glow-rgb),.02));
  opacity:0;will-change:opacity;contain:layout paint;
  transition:opacity .18s ease-out}
.bl-glow.__lit{opacity:1}
@media (prefers-reduced-motion:reduce){.bl-glow{transition:none}}

#__bl_text{position:absolute;left:0;right:0;top:34%;margin-left:auto;margin-right:auto;
  width:-moz-fit-content;width:fit-content;
  min-width:230px;max-width:86vw;box-sizing:border-box;text-align:center;
  padding:20px 30px 17px;border-radius:16px;overflow:hidden;
  background:var(--bl-glass);border:1px solid var(--bl-edge);box-shadow:var(--bl-shadow);
  text-shadow:var(--bl-textshadow);
  transition:opacity .6s ease,height .26s cubic-bezier(.22,.7,.25,1),
             padding .26s cubic-bezier(.22,.7,.25,1),border-color .3s ease}
#__bl_text::before{content:"";position:absolute;inset:1px;border-radius:15px;
  pointer-events:none;background:linear-gradient(160deg,rgba(255,255,255,.55),transparent 42%)}
#__bl.__done #__bl_text{opacity:0 !important;transform:translateY(-6px);
  transition:opacity .55s ease,transform .55s ease}

/* 失败态：铭牌转红并列出失败项 */
#__bl_text.__fail{border-color:var(--bl-fail);box-shadow:0 0 0 1px var(--bl-fail),var(--bl-shadow)}
#__bl.__fail #__bl_frost{background-color:rgba(229,72,77,.10)}
#__bl_title.__fail{color:var(--bl-fail)}
#__bl_fails{margin-top:12px;padding-top:10px;border-top:1px solid var(--bl-edge);
  text-align:left;font-size:11.5px;line-height:1.7;color:var(--bl-fail);display:none}
#__bl_fails.__on{display:block}
.__bl_fail_row{display:flex;gap:6px;align-items:flex-start;animation:__bl_rowin .26s both}
.__bl_fail_name{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%}
.__bl_fail_reason{flex:1 1 auto;opacity:.8;font-size:11px}

#__bl_iconwrap{margin:0 auto 13px;display:flex;align-items:center;justify-content:center;opacity:.9}
#__bl_iconwrap svg,#__bl_iconwrap img{display:block;color:currentColor}
#__bl_title{font-size:16px;font-weight:600;letter-spacing:.1em;opacity:.95}
#__bl_status{margin-top:9px;font-size:12.5px;letter-spacing:.04em;opacity:.7;min-height:18px}
#__bl_list{margin-top:14px;padding-top:12px;border-top:1px solid var(--bl-edge);
  text-align:left;font-size:11.5px;line-height:1.75}
.__bl_row{display:flex;align-items:center;gap:7px;opacity:.72;
  transition:opacity .25s ease,transform .25s ease;white-space:nowrap;overflow:hidden;
  animation:__bl_rowin .26s cubic-bezier(.22,.7,.25,1) both}
@keyframes __bl_rowin{from{opacity:0;transform:translateY(-4px)}to{opacity:.72;transform:none}}
.__bl_row.__done{opacity:.4}
.__bl_dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#5f9dff;
  box-shadow:0 0 6px rgba(95,157,255,.9)}
.__bl_row.__done .__bl_dot{background:currentColor;opacity:.45;box-shadow:none}
.__bl_name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.__bl_ms{flex:0 0 auto;opacity:.6;font-variant-numeric:tabular-nums}
#__bl_meta{margin-top:20px;font-size:11px;letter-spacing:.14em;opacity:.5;
  font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;gap:.45em}

#__bl_pct{display:inline-flex;align-items:flex-start;line-height:1;
  font-variant-numeric:tabular-nums;font-weight:600;opacity:.9}
.__bl_d{display:inline-block;position:relative;overflow:hidden;height:1.15em;width:.62em}
.__bl_col{display:flex;flex-direction:column;
  transition:transform .34s cubic-bezier(.22,.7,.25,1)}
.__bl_col i{display:block;height:1.15em;line-height:1.15em;font-style:normal;text-align:center}
.__bl_sign{display:inline-block;margin-left:.06em}
#__bl_dnum{display:inline-flex;align-items:flex-start;margin-left:.45em}
#__bl_dnum[hidden]{display:none}
.__bl_sep{display:inline-block;margin:0 .28em;opacity:.55}
#__bl_detail .__bl_d{height:1.15em}
@keyframes __bl_bump{0%{transform:scale(1)}
  42%{transform:scale(1.018)}100%{transform:scale(1)}}
#__bl_text.__bump{animation:__bl_bump .34s cubic-bezier(.22,.7,.25,1)}
@media (prefers-reduced-motion:reduce){
  .__bl_col{transition:none}
  #__bl_text.__bump{animation:none}}

/* 窄屏：收窄铭牌、缩小字号、上移一点避免和底部输入框挤在一起 */
@media (max-width:520px){
  #__bl_text{min-width:0;width:min(88vw,320px);padding:15px 16px 13px;top:26%}
  #__bl_iconwrap{margin-bottom:10px}
  #__bl_title{font-size:14px;letter-spacing:.06em}
  #__bl_status{font-size:11.5px;margin-top:7px}
  #__bl_list{margin-top:11px;padding-top:9px;font-size:10.5px;line-height:1.6}
  #__bl_fails{margin-top:9px;padding-top:8px;font-size:10.5px}
  .__bl_fail_name{max-width:44%}
  .__bl_fail_reason{font-size:10px}
  #__bl_meta{margin-top:15px;font-size:10px;letter-spacing:.08em;gap:.35em}
  .__bl_d{width:.58em}
}
@media (max-width:360px){
  #__bl_text{width:92vw;padding:13px 13px 11px}
  #__bl_title{font-size:13px}
  #__bl_list,#__bl_fails{font-size:10px}
  #__bl_meta{font-size:9.5px}
}
/* 矮屏（横屏手机、分屏）：改为垂直居中，避免 26%~34% 使铭牌贴边溢出 */
@media (max-height:560px){
  #__bl_text{top:50%;transform:translateY(-50%)}
  #__bl.__done #__bl_text{transform:translateY(calc(-50% - 6px))}
}
/* 极矮（键盘弹起）：再收一档，并允许内部滚动 */
@media (max-height:420px){
  #__bl_text{max-height:86vh;overflow:auto;padding:12px 14px 10px}
  #__bl_iconwrap{display:none}
  #__bl_list{margin-top:8px;padding-top:7px}
}

/* dsh 自带 boot 屏：结构匹配隐藏，失败提示保留可见 */
div[class*="_boot_"] > div[class*="_card_"] > div[class*="_spinner_"],
div[class*="_boot_"] > div[class*="_card_"] > div[class*="_wordmark_"],
div[class*="_boot_"] > div[class*="_card_"] > div[class*="_hint_"]{display:none !important}
div[class*="_boot_"] > div[class*="_card_"]:not(:has(div[class*="_failed_"])){display:none !important}
div[class*="_boot_"]:not(:has(div[class*="_failed_"])){background:transparent !important}
`;

    const HTML = `
<div id="__bl" role="status" aria-live="polite">
  <div id="__bl_frost"></div>
  <canvas id="__bl_wave"></canvas>
  <div id="__bl_glows"></div>
  <div id="__bl_text">
    <div id="__bl_iconwrap"></div>
    <div id="__bl_title"></div>
    <div id="__bl_status"></div>
    <div id="__bl_list"></div>
    <div id="__bl_fails"></div>
    <div id="__bl_meta">
      <span id="__bl_detail"><span id="__bl_dl"></span><span id="__bl_dnum"><span id="__bl_dn"></span><span class="__bl_sep">/</span><span id="__bl_dm"></span></span></span>
      &nbsp;·&nbsp; <span id="__bl_pct"></span>
    </div>
  </div>
</div>`;

    /* ============================================================
     * 水波动画 worker（离线跑，主线程只收 10Hz 状态）
     * ========================================================== */
    const WORKER_SRC = `
var VW=0,VH=0,dpr=1,dark=false,CFG=null,cx=null,cv=null,ready=false;
var N=96,u=new Float32Array(N),v=new Float32Array(N),acc=new Float32Array(N);
var C2=200,DAMP=0.35,amp=1.0,simLast=0,BAND=110;
var blobs=[],queue=[],committed=0,settled=0,MAX_BLOB=0.04,done=false;
var curLevel=0,prevLevel=0,lastEmit=0,lastFrame=0,nextStir=0,miss=0;
var JW=[];
(function(){var sum=0,d,i;
  for(d=-5;d<=5;d++){var w=Math.exp(-d*d/4.0);JW.push(w);sum+=w;}
  var avg=sum/JW.length;
  for(i=0;i<JW.length;i++)JW[i]=(JW[i]-avg)/0.72;})();
function now(){return (self.performance&&performance.now)?performance.now():Date.now();}
function smooth(x){x=x<0?0:(x>1?1:x);return x*x*(3-2*x);}
function makeBlob(vol,fall,pos){return {t0:now(),fall:fall||(170+Math.random()*180),
  dur:480+Math.random()*420+vol*1200,vol:vol,pos:pos,landed:false};}
function pourImpl(vol,fallMs,pos){
  if(done)return;
  vol=Math.max(0,Math.min(vol,MAX_BLOB,0.9999-committed));
  if(vol<=0.0005)return;
  var px=(pos===undefined)?(0.18+0.64*Math.random()):pos;
  if(blobs.length>=8||queue.length>0){ if(queue.length<64){committed+=vol;queue.push({vol:vol,fall:fallMs,pos:px});} return; }
  committed+=vol; blobs.push(makeBlob(vol,fallMs,px));
}
function drainQueue(){while(queue.length>0&&blobs.length<8){var x=queue.shift();blobs.push(makeBlob(x.vol,x.fall,x.pos));}}
function levelAt(t){
  drainQueue();
  var lv=settled;
  for(var i=blobs.length-1;i>=0;i--){
    var b=blobs[i];
    if(t-b.t0<b.fall)continue;
    var p=(t-b.t0-b.fall)/b.dur;
    if(p>=1){settled+=b.vol;blobs.splice(i,1);continue;}
    lv+=b.vol*smooth(p);
  }
  return Math.max(0,Math.min(1,lv));
}
function jolt(pos,force){
  var k=Math.max(5,Math.min(N-6,Math.round(pos*N)));
  for(var d=-5;d<=5;d++)v[k+d]-=force*JW[d+5];
}
function activeBlobs(t){
  var a=0,w=0;
  for(var i=0;i<blobs.length;i++){
    var b=blobs[i],dt=t-b.t0-b.fall;
    if(dt<0||dt>b.dur)continue;
    a++; if(b.vol>w)w=b.vol;
  }
  return {count:a,vol:w};
}
function consumeLanded(t){
  for(var i=0;i<blobs.length;i++){
    var b=blobs[i];
    if(!b.landed&&t-b.t0>=b.fall){b.landed=true;jolt(b.pos,3.2+b.vol*16.0);}
  }
}
function removeMean(){
  var mu=0,mv=0,i;
  for(i=0;i<N;i++){mu+=u[i];mv+=v[i];}
  mu/=N;mv/=N;
  if(Math.abs(mu)>1e-6)for(i=0;i<N;i++)u[i]-=mu;
  if(Math.abs(mv)>1e-6)for(i=0;i<N;i++)v[i]-=mv*0.55;
}
function stepSim(t){
  var dt=Math.min(0.033,(t-simLast)/1000);simLast=t;
  consumeLanded(t);
  var act=activeBlobs(t);
  if(!done&&act.count>0&&t>=nextStir){
    nextStir=t+70+Math.random()*150;
    jolt(0.15+0.70*Math.random(),(Math.random()<0.5?1:-1)*(0.9+act.vol*5.5));
  }
  if(done)amp*=Math.pow(0.955,dt*60);
  var h=1/60,steps=Math.min(2,Math.max(1,Math.round(dt/h)));
  for(var sp=0;sp<steps;sp++){
    for(var i=1;i<N-1;i++)acc[i]=C2*(u[i-1]+u[i+1]-2*u[i])-DAMP*v[i];
    acc[0]=C2*(u[1]-u[0])-DAMP*v[0];
    acc[N-1]=C2*(u[N-2]-u[N-1])-DAMP*v[N-1];
    for(var j=0;j<N;j++){v[j]+=acc[j]*h;u[j]+=v[j]*h;}
  }
  removeMean();
}
function baseYFor(lv){
  var b=VH*(1-lv);
  var lt=Math.min(1,lv/0.12);lt=lt*lt*(3-2*lt);
  return b-(1-lt)*26;
}
function trace(ys,off){
  cx.beginPath();cx.moveTo(0,ys[0]+off);
  for(var i=0;i<N-1;i++){
    var x0=i/(N-1)*VW,x1=(i+1)/(N-1)*VW;
    cx.quadraticCurveTo(x0,ys[i]+off,(x0+x1)/2,(ys[i]+ys[i+1])/2+off);
  }
  cx.lineTo(VW,ys[N-1]+off);
}
function frame(){
  if(!ready)return;
  var t=now();
  if(t-lastFrame<30){setTimeout(frame,10);return;}
  lastFrame=t;
  curLevel=levelAt(t);
  if(curLevel<prevLevel)curLevel=prevLevel;else prevLevel=curLevel;
  stepSim(t);
  var base=baseYFor(curLevel);
  var top=Math.max(0,Math.min(Math.max(0,VH-BAND*2),Math.round(base-BAND)));
  var hh=Math.min(BAND*2,VH);
  cx.setTransform(dpr,0,0,dpr,0,0);
  cx.clearRect(0,0,VW,hh);
  var ly=base-top,ys=new Float32Array(N),i;
  for(i=0;i<N;i++)ys[i]=ly+34*Math.tanh(u[i]*CFG.amplitude*amp/34);
  var g=cx.createLinearGradient(0,ly,0,Math.min(hh,ly+70));
  g.addColorStop(0,dark?'rgba(150,195,255,.14)':'rgba(120,160,225,.12)');
  g.addColorStop(1,'rgba(120,160,225,0)');
  trace(ys,0);cx.lineTo(VW,Math.min(hh,ly+70));cx.lineTo(0,Math.min(hh,ly+70));cx.closePath();
  cx.fillStyle=g;cx.fill();
  trace(ys,-1.6);
  cx.strokeStyle=dark?'rgba(0,0,0,.5)':'rgba(60,84,130,.42)';cx.lineWidth=2;cx.stroke();
  trace(ys,1.1);
  cx.strokeStyle=dark?'rgba(205,230,255,.9)':'rgba(255,255,255,.98)';cx.lineWidth=2;cx.stroke();
  if(t-lastEmit>=100){
    lastEmit=t;
    var d='M 0 0 H '+VW.toFixed(0)+' V '+(ys[N-1]+top).toFixed(1);
    for(var k=N-1;k>=0;k-=3)d+=' L '+(k/(N-1)*VW).toFixed(1)+' '+(ys[k]+top).toFixed(1);
    d+=' L 0 '+(ys[0]+top).toFixed(1)+' Z';
    self.postMessage({type:'state',level:curLevel,top:top,clip:d});
  }
  setTimeout(frame,10);
}
self.onmessage=function(e){
  var m=e.data||{};
  if(m.type==='init'){
    cv=m.canvas;cx=cv.getContext('2d',{alpha:true});
    VW=m.VW;VH=m.VH;dpr=m.dpr;dark=m.dark;
    CFG=m.cfg;C2=CFG.waveSpeed||200;DAMP=CFG.damping||0.35;MAX_BLOB=CFG.maxBlob||0.04;
    cv.width=Math.round(VW*dpr);cv.height=Math.round(Math.min(BAND*2,VH)*dpr);
    ready=true;simLast=now();setTimeout(frame,0);
  }else if(m.type==='resize'){
    VW=m.VW;VH=m.VH;dpr=m.dpr;
    if(cv){cv.width=Math.round(VW*dpr);cv.height=Math.round(Math.min(BAND*2,VH)*dpr);}
  }else if(m.type==='theme'){ dark=m.dark;
  }else if(m.type==='pour'){ pourImpl(m.vol,m.fall,m.pos);
  }else if(m.type==='finish'){
    if(done)return;
    var need=0.9999-committed,z=0;
    while(z<24&&need>0){pourImpl(Math.min(MAX_BLOB,need),120+z*55);need-=MAX_BLOB;z++;}
    done=true;
  }
};
`;

  /**
   * betterloading — 客户端设置页。
   *
   * 这不是「注册 schema 就自动出现」的东西：dsh 的「设置 → 插件」页是一个 tab
   * 容器（`dsh-client-ui-settings-plugins` 只持有导航项与 tab 外框，注释原文：
   * "feature-owned tabs registered into `settings.plugins.tab`"），
   * 每个插件的配置页要自己注册一个 tab。这里就是那个 tab。
   *
   * 读写全部走官方通道：
   *   ctx.slots.register({ name: "settings.plugins.tab", ... }, Panel)
   *   ctx.configForms.get(ENTRY_ID)   → getSnapshot / subscribe / mutate
   *   SettingsFormModel + SettingsValueField（@deepseek-ai/dsh-client-ui-primitives）
   *
   * 表单是「暂存 + 保存才写」的模型（SettingsFormModel 的约定）：
   * 输入先进入草稿，点保存才做一次带 revision 围栏的 mutate。
   */

  /** 本包的 package name：`plugins.bundle.config` 的 key。 */
  const PACKAGE_NAME = "dsh-betterloading";
  /** 表单 namespace = 活动 profile 条目 id（cordis.patch.yml 里 insert 行的 id）。 */
  const FORM_NS = "betterloading";
  /** 本插件的文案 namespace。 */
  const TEXT_NS = "settings.betterloading";

  /* ---------------------------------------------------------------- 字段定义 */

  /** 枚举字段：空草稿表示清除（回落到继承值），不在允许集合内则阻止保存。 */
  function enumField(field, allowed) {
    return {
      field,
      format: (value) => (typeof value === "string" ? value : ""),
      parse: (text) => {
        const trimmed = text.trim();
        if (trimmed === "") return { kind: "clear" };
        return allowed.includes(trimmed) ? { kind: "set", value: trimmed } : undefined;
      },
    };
  }

  /** 布尔字段：接受 true/false 文本，空草稿清除。 */
  function boolField(field) {
    return {
      field,
      format: (value) => (typeof value === "boolean" ? String(value) : ""),
      parse: (text) => {
        const trimmed = text.trim().toLowerCase();
        if (trimmed === "") return { kind: "clear" };
        if (trimmed === "true") return { kind: "set", value: true };
        if (trimmed === "false") return { kind: "set", value: false };
        return undefined;
      },
    };
  }

  /** 数值字段（浮点；整数型另用 min/max 提示）。 */
  function numberField(field) {
    return {
      field,
      format: (value) => (typeof value === "number" ? String(value) : ""),
      parse: (text) => {
        const trimmed = text.trim();
        if (trimmed === "") return { kind: "clear" };
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? { kind: "set", value: parsed } : undefined;
      },
    };
  }

  /** 文本字段。 */
  function textField(field) {
    return {
      field,
      format: (value) => (typeof value === "string" ? value : ""),
      parse: (text) => {
        const trimmed = text.trim();
        return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
      },
    };
  }

  /** JSON 对象字段（`texts` 覆盖表）：非法 JSON 阻止保存，而不是静默丢弃。 */
  function jsonObjectField(field) {
    return {
      field,
      format: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? JSON.stringify(value)
          : "",
      parse: (text) => {
        const trimmed = text.trim();
        if (trimmed === "") return { kind: "clear" };
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return undefined;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
        return { kind: "set", value: parsed };
      },
    };
  }

  /**
   * 表单字段表：顺序即渲染顺序。
   * `kind` 只影响控件提示（数字键盘 / 多行），校验一律由 spec 决定。
   */
  const FIELDS = [
    { key: "enabled", spec: boolField("enabled"), numeric: false, multiline: false },
    { key: "mode", spec: enumField("mode", ["realtime", "static"]), numeric: false, multiline: false },
    { key: "blur", spec: numberField("blur"), numeric: true, multiline: false },
    { key: "noise", spec: numberField("noise"), numeric: true, multiline: false },
    { key: "tintLight", spec: textField("tintLight"), numeric: false, multiline: false },
    { key: "tintDark", spec: textField("tintDark"), numeric: false, multiline: false },
    { key: "locale", spec: enumField("locale", ["auto", "zh", "en"]), numeric: false, multiline: false },
    { key: "texts", spec: jsonObjectField("texts"), numeric: false, multiline: true },
    { key: "icon", spec: textField("icon"), numeric: false, multiline: true },
    { key: "iconSize", spec: numberField("iconSize"), numeric: true, multiline: false },
    { key: "glowColor", spec: textField("glowColor"), numeric: false, multiline: false },
    { key: "glowMax", spec: numberField("glowMax"), numeric: true, multiline: false },
    { key: "maxBlob", spec: numberField("maxBlob"), numeric: true, multiline: false },
    { key: "waveSpeed", spec: numberField("waveSpeed"), numeric: true, multiline: false },
    { key: "damping", spec: numberField("damping"), numeric: true, multiline: false },
    { key: "amplitude", spec: numberField("amplitude"), numeric: true, multiline: false },
    { key: "idleTimeoutMs", spec: numberField("idleTimeoutMs"), numeric: true, multiline: false },
  ];

  /** 文案：外框（SettingsForm 需要）+ 每个字段的标签与说明。 */
  const SETTINGS_I18N = {
    zh: {
      title: "BetterLoading",
      description: "外网慢链路下的毛玻璃灌水加载层。",
      unavailable: "当前部署未提供该表单。",
      readOnly: "配置文件为只读，无法保存。",
      saveFailed: "保存未被接受，请重试。",
      save: "保存",
      saving: "保存中…",
      overridden: "已覆盖",
      reset: "恢复默认",
      invalid: "格式不正确",
      enabled: "启用加载层",
      enabledHint: "关闭后不注入任何东西，dsh 自带启动屏也不再隐藏。true / false",
      mode: "磨砂模式",
      modeHint: "realtime = 真实背景模糊；static = 一次性采样的噪点磨砂（更快）。",
      blur: "模糊半径（px）",
      blurHint: "仅 realtime 模式。半径越大越吃性能。",
      noise: "颗粒强度",
      noiseHint: "仅 static 模式，0–100。",
      tintLight: "浅色主题底色",
      tintLightHint: "任意 CSS 颜色，例如 rgba(250,252,255,.55)。",
      tintDark: "深色主题底色",
      tintDarkHint: "任意 CSS 颜色，例如 rgba(14,18,26,.62)。",
      locale: "界面语言",
      localeHint: "auto 跟随浏览器；zh / en 强制指定。",
      texts: "自定义文案（JSON）",
      textsHint: '覆盖任意文案，例如 {"title":"DeepSeek Harness"}。键见 README。',
      icon: "图标",
      iconHint: "whale（dsh 鲸鱼）/ none / 内联 <svg> / 图片 URL。",
      iconSize: "图标边长（px）",
      iconSizeHint: "0 表示不显示图标。",
      glowColor: "高亮框颜色",
      glowColorHint: "任意 CSS 颜色，例如 #6EAAFF。",
      glowMax: "高亮框数量上限",
      glowMaxHint: "同时存在的框，1–12。",
      maxBlob: "单团水体积",
      maxBlobHint: "占全屏比例，0.005–0.35。影响单次加载推进多少。",
      waveSpeed: "波速（c²）",
      waveSpeedHint: "40–400。越大波传得越快。",
      damping: "阻尼",
      dampingHint: "0.05–3。过大波传不到边缘，过小会持续震荡。",
      amplitude: "水面振幅（px）",
      amplitudeHint: "6–80。",
      idleTimeoutMs: "硬超时（ms）",
      idleTimeoutHint: "到点必定移除遮罩，2000–180000。弱网请留足余量（默认 60s）。",
    },
    en: {
      title: "BetterLoading",
      description: "Frosted-glass pouring loader for slow links.",
      unavailable: "This deployment does not serve the form.",
      readOnly: "The configuration document is read-only.",
      saveFailed: "The save was not accepted.",
      save: "Save",
      saving: "Saving…",
      overridden: "Overridden",
      reset: "Reset",
      invalid: "Invalid",
      enabled: "Enable the overlay",
      enabledHint: "When false nothing is injected and dsh's own boot screen is left alone. true / false",
      mode: "Frost mode",
      modeHint: "realtime = real backdrop blur; static = sampled noise frost (cheaper).",
      blur: "Blur radius (px)",
      blurHint: "realtime only. Larger is more expensive.",
      noise: "Grain strength",
      noiseHint: "static only, 0-100.",
      tintLight: "Light-theme tint",
      tintLightHint: "Any CSS colour, e.g. rgba(250,252,255,.55).",
      tintDark: "Dark-theme tint",
      tintDarkHint: "Any CSS colour, e.g. rgba(14,18,26,.62).",
      locale: "Language",
      localeHint: "auto follows the browser; zh / en force one.",
      texts: "Custom copy (JSON)",
      textsHint: 'Override any message, e.g. {"title":"DeepSeek Harness"}. Keys in the README.',
      icon: "Icon",
      iconHint: "whale (dsh mark) / none / inline <svg> / image URL.",
      iconSize: "Icon size (px)",
      iconSizeHint: "0 hides the icon.",
      glowColor: "Highlight colour",
      glowColorHint: "Any CSS colour, e.g. #6EAAFF.",
      glowMax: "Max highlight boxes",
      glowMaxHint: "Concurrent boxes, 1-12.",
      maxBlob: "Blob volume",
      maxBlobHint: "Screen fraction, 0.005-0.35. How much one load advances.",
      waveSpeed: "Wave speed (c²)",
      waveSpeedHint: "40-400. Higher travels faster.",
      damping: "Damping",
      dampingHint: "0.05-3. Too high and waves die before the edges; too low and they ring.",
      amplitude: "Amplitude (px)",
      amplitudeHint: "6-80.",
      idleTimeoutMs: "Hard timeout (ms)",
      idleTimeoutHint: "The overlay is removed regardless, 2000-180000. Leave room on slow links (default 60s).",
    },
  };

  /**
   * 渲染一个字段的控件。
   * @param primitives - 共享基座里的组件表。
   * @param react - 共享基座里的 React。
   * @param props - slot 注入的属性（见 inject 的返回值）。
   * @param field - 字段定义。
   * @param state - 该字段的草稿状态。
   * @param t - 文案函数。
   * @returns 控件元素。
   */
  function renderField(primitives, react, props, field, state, t) {
    return react.createElement(primitives.SettingsValueField, {
      key: field.key,
      id: `betterloading-${field.key}`,
      label: t(field.key),
      hint: t(`${field.key}Hint`),
      text: state.text,
      overridden: state.overridden,
      invalid: state.invalid,
      overriddenLabel: t("overridden"),
      resetLabel: t("reset"),
      invalidLabel: t("invalid"),
      disabled: !props.writable,
      numeric: field.numeric === true,
      onEdit: (text) => props.edit(field.key, text),
      onReset: () => props.resetField(field.key),
    });
  }

  /**
   * 注册插件配置页。
   *
   * 入口不是「设置 → 插件」页的 tab，也不是 `settings.plugins.tab` ——
   * 那是插件管理页自己的 tab 容器。第三方 bundle 的配置走 keyed slot
   * `plugins.bundle.config`，key 就是本包的 package name：
   * owner 在自己的 bundle 页里按这个 key 派发，把表单渲染在
   * 「描述」与「依赖行」之间。
   *
   * 组件只会在 `view: 'page'` 下被要求渲染（该 slot 没有 summary 形态）。
   *
   * @param ctx - 客户端插件上下文。
   */
  function applySettingsPage(ctx) {
    const t = ctx.locale.bind(TEXT_NS);

    /* 按需等待 configForms：服务不存在时什么都不注册（旧版 runtime）。 */
    if (typeof ctx.inject !== "function") return;
    ctx.inject(["configForms"], (formsCtx) => {

    ctx.effect(
      () => ctx.locale.register(TEXT_NS, SETTINGS_I18N),
      "betterloading: settings dictionaries",
    );

    const Panel = function BetterloadingSettingsPanel(props) {
      /* 插件页先渲染一行摘要，展开后才要求 page 形态。 */
      if (props.view === "summary") return props.t("description");
      const state = props.useForm((snapshot) => snapshot);
      const labels = {
        unavailable: props.t("unavailable"),
        readOnly: props.t("readOnly"),
        saveFailed: props.t("saveFailed"),
        save: props.t("save"),
        saving: props.t("saving"),
      };
      return react.createElement(
        primitives.SettingsForm,
        {
          labels,
          state: state.shell,
          onSave: props.save,
          onDiscard: props.discard,
        },
        FIELDS.map((field) => {
          const fieldState =
            state.fields[field.key] || { text: "", overridden: false, invalid: false };
          return react.createElement(primitives.SettingsValueField, {
            key: field.key,
            id: `betterloading-${field.key}`,
            label: props.t(field.key),
            hint: props.t(`${field.key}Hint`),
            text: fieldState.text,
            overridden: fieldState.overridden,
            invalid: fieldState.invalid,
            overriddenLabel: props.t("overridden"),
            resetLabel: props.t("reset"),
            invalidLabel: props.t("invalid"),
            disabled: !state.shell.writable,
            numeric: field.numeric === true,
            onEdit: (text) => props.edit(field.key, text),
            onReset: () => props.resetField(field.key),
          });
        }),
      );
    };

    /**
     * 容错注册：slot 名或 key 若与某个 dsh 版本不匹配，只跳过这个页面，
     * 不连累已经生效的遮罩。旧版 dsh 上曾经因为这里抛错让整个插件不激活。
     */
    function tolerant(run) {
      try {
        return run() || function noop() {};
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[betterloading] settings page skipped — ${message}`);
        return function noop() {};
      }
    }

    ctx.effect(
      () =>
        ctx.configForms.whileServed([FORM_NS], () => {
          try {
          const scope = ctx.configForms.get(FORM_NS);
          const model = new primitives.SettingsFormModel(
            scope,
            FIELDS.map((field) => field.spec),
          );
          const store = model.bind(() => ({
            shell: model.shell(),
            fields: Object.fromEntries(
              FIELDS.map((field) => [field.key, model.field(field.key)]),
            ),
          }));
          const inject = () => ({
            t,
            hooks: { form: store },
            edit: (key, text) => model.actions().edit(key, text),
            resetField: (key) => model.actions().resetField(key),
            save: () => model.actions().save(),
            discard: () => model.actions().discard(),
          });

          /* 入口一：插件页的卡片（list slot，id 自取）。
             与官方设置页同一个 slot，点开就是本插件的表单。 */
          const disposeItem = ctx.slots.inject("plugins.item", () =>
            tolerant(() =>
              ctx.slots.register(
                {
                  name: "plugins.item",
                  id: "betterloading",
                  order: 60,
                  label: () => t("title"),
                  locale: TEXT_NS,
                  inject,
                },
                Panel,
              ),
            ),
          );

          /* 入口二：bundle 页里「描述」与「依赖行」之间（keyed slot，key = 包名）。 */
          const disposeBundle = ctx.slots.inject("plugins.bundle.config", () =>
            tolerant(() =>
              ctx.slots.register(
                {
                  name: "plugins.bundle.config",
                  key: PACKAGE_NAME,
                  locale: TEXT_NS,
                  inject,
                },
                Panel,
              ),
            ),
          );

          return () => {
            disposeItem();
            disposeBundle();
          };
          } catch (error) {
            /* 设置页失败不能连累已经生效的遮罩。 */
            console.warn("[betterloading] settings page unavailable —", error);
            return function noop() {};
          }
        }),
      "betterloading: settings page",
    );
      return undefined;
    });
  }

    /* ============================================================
     * 插件主体
     * ========================================================== */
    function apply(ctx) {
      const CFG = Object.assign(
        {
          mode: "realtime",
          noise: 13,
          maxBlob: 0.04,
          waveSpeed: 200,
          damping: 0.35,
          amplitude: 46,
          idleTimeoutMs: 30000,
          glowColor: "#6EAAFF",
          glowMax: 6,
          icon: "whale",
          iconSize: 30,
          locale: "auto",
          texts: {},
        },
        (typeof globalThis !== "undefined" && globalThis.__BETTERLOADING_CONFIG) || {},
      );

      /* ---- 文案 ---- */
      const want = CFG.locale || "auto";
      const LANG =
        want === "zh" || want === "en"
          ? want
          : (navigator.language || "en").toLowerCase().indexOf("zh") === 0
            ? "zh"
            : "en";
      const T = Object.assign({}, TEXTS[LANG]);
      const USER = CFG.texts || {};
      for (const k of Object.keys(USER)) if (USER[k]) T[k] = USER[k];
      const t = (key, vars) => {
        let s = T[key] === undefined ? key : T[key];
        if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
        return s;
      };

      const isDark = () =>
        !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));

      /* ---- DOM：已有骨架就复用（host 预注入时），否则自建 ---- */
      let styleEl = null;
      const ensureStyle = () => {
        if (styleEl && styleEl.isConnected) return;
        styleEl = document.createElement("style");
        styleEl.setAttribute("data-betterloading", "");
        styleEl.textContent = STYLE;
        (document.head || document.documentElement).appendChild(styleEl);
      };

      let root = document.getElementById("__bl");
      const ensureDom = () => {
        ensureStyle();
        if (root && root.isConnected) return true;
        if (!document.body) return false;
        const holder = document.createElement("div");
        holder.innerHTML = HTML.trim();
        root = holder.firstElementChild;
        document.body.appendChild(root);
        // 颜色
        const rgb = parseRgb(CFG.glowColor);
        root.style.setProperty("--bl-glow-rgb", rgb);
        return true;
      };

      const el = (id) => document.getElementById(id);

      /* ---- 状态 ---- */
      let mounted = false;
      let done = false;
      let removed = false;
      let apiStarted = 0;
      let apiDone = 0;
      let historySignal;
      let jobSignal;
      let worker = null;
      let pctRaf = 0;
      let shownPct = 0;
      let targetPct = 0;
      let lastPctNum = -1;
      let lastLabel = "";
      let rows = [];
      let seq = 0;
      let textEl = null;
      let bumpTimer = 0;
      let pctWrap = null;
      let odoCols = [];
      let odoDigits = -1;
      let setDn = () => {};
      let setDm = () => {};

      /* ---- 失败收集 ---- */
      const fails = []; // {name, reason}
      const FAIL_MAX = 3;
      let failShown = false;
      const reasonOf = (err) => {
        if (!err) return "unknown";
        if (typeof err === "string") return err;
        return err.message || err.name || "unknown";
      };
      const noteFailure = (name, reason) => {
        if (done || removed) return;
        if (fails.length >= 24) return;
        fails.push({ name: name || "?", reason: reason || "unknown" });
        renderFails();
      };
      function renderFails() {
        const box = el("__bl_fails");
        const plate = el("__bl_text");
        const title = el("__bl_title");
        if (!box) return;
        const on = fails.length > 0;
        box.classList.toggle("__on", on);
        if (plate) plate.classList.toggle("__fail", on);
        if (root) root.classList.toggle("__fail", on);
        if (title) title.classList.toggle("__fail", on);
        if (!on) {
          box.innerHTML = "";
          if (title) title.textContent = t("title");
          failShown = false;
          return;
        }
        if (!failShown) {
          failShown = true;
          if (title) title.textContent = t("failedTitle");
        }
        let html = "";
        for (const f of fails.slice(0, FAIL_MAX)) {
          html +=
            '<div class="__bl_fail_row"><span class="__bl_fail_name">' +
            esc(f.name) +
            '</span><span class="__bl_fail_reason">' +
            esc(f.reason) +
            "</span></div>";
        }
        if (fails.length > FAIL_MAX) {
          html +=
            '<div class="__bl_fail_row"><span class="__bl_fail_reason">' +
            t("failedMore", { n: fails.length - FAIL_MAX }) +
            "</span></div>";
        }
        box.innerHTML = html;
        syncPlateHeight();
      }

      /* ---- 里程表 ---- */
      function createOdo(host, suffix) {
        let cols = [];
        let digits = -1;
        const build = (str) => {
          host.innerHTML = "";
          cols = [];
          for (let i = 0; i < str.length; i++) {
            const d = document.createElement("span");
            d.className = "__bl_d";
            const col = document.createElement("span");
            col.className = "__bl_col";
            for (let k = 0; k < 10; k++) {
              const it = document.createElement("i");
              it.textContent = String(k);
              col.appendChild(it);
            }
            d.appendChild(col);
            host.appendChild(d);
            cols.push(col);
          }
          if (suffix) {
            const sg = document.createElement("span");
            sg.className = "__bl_sign";
            sg.textContent = suffix;
            host.appendChild(sg);
          }
          digits = str.length;
        };
        build("0");
        return (n) => {
          const str = String(n);
          if (str.length !== digits) build(str);
          for (let i = 0; i < str.length && i < cols.length; i++) {
            cols[i].style.transform = "translateY(" + -Number(str[i]) * 1.15 + "em)";
          }
        };
      }

      function renderIcon() {
        const wrap = el("__bl_iconwrap");
        if (!wrap) return;
        const raw = CFG.icon || "whale";
        const size = Math.max(0, CFG.iconSize || 0);
        if (!size || raw === "none") {
          wrap.innerHTML = "";
          wrap.style.display = "none";
          return;
        }
        wrap.style.display = "";
        const svg = raw === "whale" ? WHALE_ICON : raw;
        if (svg.charAt(0) === "<") {
          wrap.innerHTML = svg;
          const first = wrap.firstElementChild;
          if (first) {
            first.setAttribute("width", String(size));
            first.setAttribute("height", String(size));
          }
        } else {
          const img = document.createElement("img");
          img.src = String(raw);
          img.width = size;
          img.height = size;
          img.alt = "";
          wrap.innerHTML = "";
          wrap.appendChild(img);
        }
      }

      function shortName(url) {
        let s = String(url || "");
        try {
          if (s.indexOf("://") > 0) s = new URL(s).pathname;
        } catch {}
        const q = s.indexOf("?");
        if (q > 0) s = s.slice(0, q);
        const seg = s.split("/").filter((x) => x);
        let n = seg.length ? seg[seg.length - 1] : s;
        if (seg.length > 1) n = seg[seg.length - 2] + "/" + n;
        if (n.length > 24) n = "…" + n.slice(-23);
        return n;
      }

      function syncPlateHeight() {
        if (!textEl) return;
        const prev = textEl.offsetHeight;
        textEl.style.height = "auto";
        const next = textEl.offsetHeight;
        textEl.style.height = prev + "px";
        if (next === prev) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (textEl) textEl.style.height = next + "px";
          });
        });
      }

      function bumpPlate() {
        if (!textEl) return;
        textEl.classList.remove("__bump");
        void textEl.offsetWidth;
        textEl.classList.add("__bump");
        clearTimeout(bumpTimer);
        bumpTimer = setTimeout(() => {
          if (textEl) textEl.classList.remove("__bump");
        }, 380);
      }

      function renderList() {
        const listEl = el("__bl_list");
        if (!listEl) return;
        let html = "";
        for (const r of rows) {
          html +=
            '<div class="__bl_row' +
            (r.done ? " __done" : "") +
            '"><span class="__bl_dot"></span><span class="__bl_name">' +
            esc(r.name) +
            '</span><span class="__bl_ms">' +
            (r.done ? r.ms + "ms" : "—") +
            "</span></div>";
        }
        listEl.innerHTML = html;
        syncPlateHeight();
        bumpPlate();
      }
      function pushRow(name) {
        const id = ++seq;
        rows.unshift({ id, name, done: false, ms: 0, t0: performance.now() });
        if (rows.length > 3) rows = rows.slice(0, 3);
        renderList();
        return id;
      }
      function finishRow(id) {
        for (const r of rows) {
          if (r.id === id) {
            r.done = true;
            r.ms = Math.max(0, Math.round(performance.now() - r.t0));
            renderList();
            return;
          }
        }
      }

      function setDetail(kind, a, b) {
        const dl = el("__bl_dl");
        const dnum = el("__bl_dnum");
        if (!dl || !dnum) return;
        if (kind == null) {
          dnum.hidden = true;
          if (lastLabel !== t("waiting")) {
            lastLabel = t("waiting");
            dl.textContent = lastLabel;
          }
          return;
        }
        dnum.hidden = false;
        if (lastLabel !== kind) {
          lastLabel = kind;
          dl.textContent = kind;
        }
        setDn(a);
        setDm(b);
      }
      function setDetailText(txt) {
        const dl = el("__bl_dl");
        const dnum = el("__bl_dnum");
        if (!dl || !dnum) return;
        dnum.hidden = true;
        lastLabel = txt || "";
        dl.textContent = lastLabel;
      }

      function label(url) {
        let p = "";
        try {
          p = new URL(url, location.href).pathname;
        } catch {
          return "tContent";
        }
        if (p.indexOf("/api/session") === 0) return "tSession";
        if (p.indexOf("/api/workspace") === 0) return "tWorkspace";
        if (p.indexOf("/api/settings") === 0) return "tSettings";
        if (p.indexOf("/api/job") === 0) return "tJob";
        if (p.indexOf("/api/account") === 0) return "tAccount";
        if (p.indexOf("/api/terminal") === 0) return "tTerminal";
        if (p.indexOf("/api/attachment") === 0) return "tAttachment";
        return "tContent";
      }

      /* ---- 泛光框池 ---- */
      const glowPool = [];
      const glowBusy = [];
      const buildPool = () => {
        const host = el("__bl_glows");
        if (!host) return;
        const max = Math.max(1, Math.min(12, CFG.glowMax || 6));
        for (let i = 0; i < max; i++) {
          const g = document.createElement("div");
          g.className = "bl-glow";
          host.appendChild(g);
          glowPool.push(g);
        }
      };
      function regionRect(url) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        let p = "";
        try {
          p = new URL(url, location.href).pathname;
        } catch {}
        if (/^\/api\/(session|workspace|attachment)/.test(p))
          return { x: 0, y: H * 0.1, w: W * 0.22, h: H * 0.82 };
        if (/^\/api\/(settings|account)/.test(p))
          return { x: W * 0.28, y: H * 0.2, w: W * 0.44, h: H * 0.54 };
        if (/^\/api\/(terminal|job)/.test(p))
          return { x: W * 0.22, y: H * 0.1, w: W * 0.56, h: H * 0.82 };
        return { x: W * 0.22, y: H * 0.1, w: W * 0.78, h: H * 0.82 };
      }
      function lightGlow(item) {
        item.el.classList.add("__lit");
        clearTimeout(item.t);
        item.t = setTimeout(() => {
          item.el.classList.remove("__lit");
          const at = glowBusy.indexOf(item);
          if (at >= 0) glowBusy.splice(at, 1);
          glowPool.push(item.el);
        }, 420);
      }
      function flashGlow(url) {
        if (done || (!glowPool.length && !glowBusy.length)) return;
        const r = regionRect(url);
        for (const b of glowBusy) {
          if (Math.abs(b.x - r.x) < 2 && Math.abs(b.y - r.y) < 2 && Math.abs(b.w - r.w) < 2) {
            lightGlow(b);
            return;
          }
        }
        const g = glowPool.shift();
        if (!g) return;
        g.style.width = r.w + "px";
        g.style.height = r.h + "px";
        g.style.transform = "translate3d(" + r.x + "px," + r.y + "px,0)";
        const item = { el: g, x: r.x, y: r.y, w: r.w };
        glowBusy.push(item);
        lightGlow(item);
      }

      /* ---- worker ---- */
      function startWorker() {
        const cv = el("__bl_wave");
        if (worker || !cv || typeof cv.transferControlToOffscreen !== "function") return;
        try {
          const off = cv.transferControlToOffscreen();
          const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
          worker = new Worker(url);
          worker.onmessage = (ev) => {
            const m = ev.data || {};
            if (m.type !== "state") return;
            const frost = el("__bl_frost");
            if (frost) {
              const vh = window.innerHeight;
              frost.style.height = Math.max(0, Math.min(vh, Math.ceil(m.top) + 220)) + "px";
              if (m.clip) frost.style.clipPath = "path('" + m.clip + "')";
            }
            const c2 = el("__bl_wave");
            if (c2) {
              c2.style.top = m.top + "px";
              c2.style.height = Math.min(220, window.innerHeight) + "px";
            }
            targetPct = m.level * 100;
          };
          worker.onerror = () => {
            worker = null;
          };
          worker.postMessage(
            {
              type: "init",
              canvas: off,
              VW: window.innerWidth,
              VH: window.innerHeight,
              dpr: Math.min(2, window.devicePixelRatio || 1),
              dark: isDark(),
              cfg: CFG,
            },
            [off],
          );
        } catch {
          worker = null;
        }
      }
      const pour = (vol, fall, pos) => {
        if (done || !worker) return;
        worker.postMessage({ type: "pour", vol, fall, pos });
      };

      /* ---- 百分比补间 ---- */
      function tickPct() {
        if (removed) return;
        const d = targetPct - shownPct;
        if (Math.abs(d) > 0.02) shownPct += d * 0.16;
        else if (shownPct !== targetPct) shownPct = targetPct;
        const n = Math.round(shownPct);
        if (n !== lastPctNum && pctWrap) {
          lastPctNum = n;
          if (pctWrap.__set) pctWrap.__set(n);
        }
        pctRaf = requestAnimationFrame(tickPct);
      }

      /* ---- 挂载点 ---- */
      let mo = null;
      function onMount() {
        if (mounted) return;
        mounted = true;
        pour(0.025, 180);
        const st = el("__bl_status");
        if (st) st.textContent = t("uiReady");
        setDetail(null);
        if (mo) {
          mo.disconnect();
          mo = null;
        }
      }
      function watchRoot() {
        if (mounted) return true;
        const r = document.getElementById("root");
        if (!r) return false;
        if (r.childNodes.length > 0) {
          onMount();
          return true;
        }
        if (!mo) {
          mo = new MutationObserver(() => {
            const rr = document.getElementById("root");
            if (rr && rr.childNodes.length > 0) onMount();
          });
          mo.observe(r, { childList: true, subtree: true });
        }
        return false;
      }

      /* ---- 启动 ---- */
      /* ============================================================
       * 接续静态层：只订阅官方事件，不猜、不嗅探。
       * ========================================================== */
      /* ============================================================
       * 接续静态层：只用官方 sessions 事件，不猜、不嗅探。
       *
       * dsh 没有「历史列表加载完成」这个单一事件，最贴近官方语义的是
       * api-session/added 的静默期：每来一条就重置计时，静默 QUIET_MS
       * 即认为历史已填充完毕。
       * ========================================================== */
      /* ============================================================
       * 接续静态层：读 dsh 官方的「列表加载阶段」，不猜静默期。
       *
       * dsh-api-session-controller 的 SessionManager 维护 listPhase：
       *   'pending' 还没拉过 → 'ready' 首次 pull 成功
       * 注释原文："Arrival phase; the pending → ready edge fires on the
       * first successful pull"。服务实例的 .list 是快照 store，
       * getSnapshot() 给出 { ids, byId, phase, ... }，subscribe() 通知变化。
       * 这才是「载入历史成功」的官方信号。
       * ========================================================== */
      /** 从官方 configForms 读用户配置并交给静态层应用。 */
      function wireConfigForms(host) {
        if (typeof host.configure !== "function") return;
        ctx.inject(["configForms"], (formsCtx) => {
          let form;
          try {
            form = formsCtx.configForms.get("betterloading");
          } catch {
            return undefined;
          }
          if (!form || typeof form.getSnapshot !== "function") return undefined;
          const apply = () => {
            try {
              const snap = form.getSnapshot();
              const value = (snap && (snap.value ?? snap.user ?? snap.effective)) || null;
              if (value) host.configure(value);
            } catch {}
          };
          apply();
          const off = typeof form.subscribe === "function" ? form.subscribe(apply) : undefined;
          return () => {
            if (typeof off === "function") off();
          };
        });
      }

      /**
       * 接续静态层。
       *
       * 退出信号必须是**组合**的：只等 `sessions.phase` 会在侧栏/工作区还没
       * 渲染时就把遮罩撤掉，露出一个空壳（实测：撤罩后页面只剩 hero + 输入框）。
       *
       * 所以等两个官方 phase 都 ready：
       *   sessions.list.phase   'pending' → 'ready'（首次 pull 成功）
       *   workspaces.list.phase 同上
       * 再留一点时间给 React 把内容画出来。
       *
       * @param host - 静态层暴露的 API。
       */
      function wireHost(host) {
        if (typeof host.takeover === "function") host.takeover();
        wireConfigForms(host);

        let sessionsReady = false;
        let workspacesReady = false;
        let scheduled = false;
        let finished = false;

        /** 两个信号都到齐后，留一帧多一点的时间再撤罩。 */
        function complete() {
          if (finished || scheduled) return;
          scheduled = true;
          setTimeout(() => {
            if (finished) return;
            finished = true;
            if (typeof host.deep === "function") host.deep(1);
            host.status(t("contentReady"));
            host.finish(t("contentReady"));
          }, 700);
        }

        function maybe() {
          if (sessionsReady && workspacesReady) complete();
        }

        /**
         * 订阅一个「列表快照」服务的 ready 边沿。
         *
         * @param name - 服务名。
         * @param onReady - 就绪回调。
         * @param accept - 判断快照是否算就绪。
         */
        function watchList(name, onReady, accept) {
          let service;
          try {
            service = typeof ctx.get === "function" ? ctx.get(name) : undefined;
          } catch {
            service = undefined;
          }
          const list = service && service.list;
          if (!list || typeof list.getSnapshot !== "function") {
            /* 服务不存在：不能因此永远卡住，直接当作就绪。 */
            onReady();
            return;
          }
          const read = () => {
            try {
              const snap = list.getSnapshot();
              if (snap && accept(snap)) onReady();
            } catch {}
          };
          read();
          if (typeof list.subscribe === "function") list.subscribe(read);
        }

        watchList(
          "sessions",
          () => {
            sessionsReady = true;
            maybe();
          },
          (snap) => {
            /* 清单：把已到达的会话数逐条显示出来（纯视觉，不参与判定）。 */
            const n = (snap.ids && snap.ids.length) || 0;
            if (n > 0) {
              const id = host.row(t("tSession") + " · " + n);
              host.rowDone(id);
            }
            return snap.phase === "ready";
          },
        );

        watchList(
          "workspaces",
          () => {
            workspacesReady = true;
            maybe();
          },
          (snap) => snap.phase === "ready" || snap.state === "idle",
        );

        /* 兜底：两个服务都在、但 12s 内没就绪 —— 继续等也没意义。 */
        setTimeout(() => {
          if (!finished && !scheduled) complete();
        }, 12000);
      }

      /* 设置页 tab：dsh 的「设置 → 插件」页是 tab 容器，必须自己注册。 */
      try {
        applySettingsPage(ctx, require);
      } catch (error) {
        ctx.logger?.warn?.("betterloading: settings page unavailable", error);
      }

      /* 静态层已经建好 DOM 并持有全部逻辑；这里只负责「用官方事件接续」。
         桌面端的自建路径已取消：dsh Desktop 的页面不从 Web Host 取，
         重复实现只会让两边分叉（历史上已因此漏改多次）。 */
      const host = globalThis.__betterloading;
      if (globalThis.__BETTERLOADING_HOST__ === true && host && host.version >= 1) {
        if (!host.__wired) {
          host.__wired = true;
          wireHost(host);
        }
      }

      const esc = (s) =>
        String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");

      const parseRgb = (value) => {
        const raw = String(value == null ? "" : value).trim();
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
        if (m) return m[1] + "," + m[2] + "," + m[3];
        return "110,170,255";
      };

    }

    /* 只声明**一定存在**的服务。
       `configForms` 是 dsh >= 0.2 才有的（设置页 + 配置桥用），
       桌面端内嵌的 0.1.0-rc.x runtime 没有它 —— 写在这里会让整个插件
       永远 pending、一条 "did not activate ... waiting for service" 报错。
       所以它改为按需注入（ctx.inject），缺失时只是没有设置页。 */
    exports.inject = ["slots", "locale"];
    exports.apply = apply;
    return module.exports;
  },
});

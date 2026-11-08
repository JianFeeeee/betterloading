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
      const QUIET_MS = 600;
      function wireHost(host) {
        /* 先接管：停掉静态层按固定节奏的假波浪，水位改由真实事件推进 */
        if (typeof host.takeover === "function") host.takeover();
        let quiet = 0;
        let gotAny = false;
        let failedAny = false;
        /* 只有在「已收到过事件」之后才用短静默期收工；
           还没收到任何会话时给一个更长的起始窗口，否则会在页面
           还没画出来时就退出。 */
        const arm = (delay) => {
          clearTimeout(quiet);
          quiet = setTimeout(() => {
            if (host.done) return;
            host.status(t("contentReady"));
            host.finish(gotAny ? t("contentReady") : "");
          }, delay === undefined ? QUIET_MS : delay);
        };

        ctx.inject(["sessions"], (sessionCtx) => {
          const offs = [];

          offs.push(
            sessionCtx.on("api-session/added", (summary) => {
              gotAny = true;
              const title =
                (summary && (summary.title || summary.name || summary.id)) || "session";
              const id = host.row(t("tSession") + " · " + shortName(title));
              host.rowDone(id);
              host.pour(0.03, 170);
              host.status(t("contentLoading"));
              arm();
            }),
          );

          offs.push(
            sessionCtx.on("api-session/error", (sessionId, message) => {
              failedAny = true;
              host.fail(
                shortName(String(sessionId || "session")),
                reasonOf(message),
              );
              host.status(t("failedTitle"));
              arm();
            }),
          );

          offs.push(
            sessionCtx.on("api-session/removed", () => {
              arm();
            }),
          );

          /* 起始窗口：3s 内没任何会话事件（实例没有历史），再等 3s 收工；
             期间一旦有 added/error 就切回短静默期。 */
          quiet = setTimeout(() => {
            if (host.done || gotAny) return;
            arm(3000);
          }, 3000);

          return () => {
            clearTimeout(quiet);
            for (const off of offs) if (typeof off === "function") off();
          };
        });
      }

      const boot = () => {
        /* Web 端由 host 的 index 注入先建好骨架（无白屏、动画立即开始）；
           那种情况下本 bundle 什么都不做，只把配置交给它。 */
        const host = globalThis.__betterloading;
        if (globalThis.__BETTERLOADING_HOST__ === true && host && host.version >= 1) {
          /* web 端：骨架与动画由 host 注入的静态层负责。
             本 bundle 只做「用官方事件卡点接续」：
             它不建 DOM、不包装 fetch，只把 sessions 服务的真实进度
             交给静态层的接口。 */
          if (host.__wired) return;
          host.__wired = true;
          wireHost(host);
          return;
        }
        if (!ensureDom()) {
          setTimeout(boot, 20);
          return;
        }
        textEl = el("__bl_text");
        pctWrap = el("__bl_pct");
        if (pctWrap) pctWrap.__set = createOdo(pctWrap, "%");
        const dnEl = el("__bl_dn");
        const dmEl = el("__bl_dm");
        if (dnEl) setDn = createOdo(dnEl, "");
        if (dmEl) setDm = createOdo(dmEl, "");
        const dnum = el("__bl_dnum");
        if (dnum) dnum.hidden = true;

        const title = el("__bl_title");
        if (title) title.textContent = t("title");
        const status = el("__bl_status");
        if (status) status.textContent = t("connecting");
        const prep = el("__bl_dl");
        if (prep) prep.textContent = t("prep");

        renderIcon();
        buildPool();
        pctRaf = requestAnimationFrame(tickPct);

        /* 静态磨砂：一次性噪点纹理 */
        if (CFG.mode === "static") {
          const frost = el("__bl_frost");
          if (frost) {
            try {
              const nc = document.createElement("canvas");
              nc.width = nc.height = 96;
              const nx = nc.getContext("2d");
              const im = nx.createImageData(96, 96);
              const d = im.data;
              const a = Math.max(0, Math.min(100, CFG.noise));
              for (let i = 0; i < d.length; i += 4) {
                const v = (Math.random() * 255) | 0;
                d[i] = d[i + 1] = d[i + 2] = v;
                d[i + 3] = (Math.random() * a) | 0;
              }
              nx.putImageData(im, 0, 0);
              frost.style.backgroundImage = "url(" + nc.toDataURL("image/png") + ")";
              frost.style.backgroundRepeat = "repeat";
              frost.style.backgroundSize = "96px 96px";
            } catch {}
          }
        }

        startWorker();
        watchRoot();
        const mountTimer = setInterval(() => {
          if (watchRoot()) clearInterval(mountTimer);
        }, 100);

        window.addEventListener("resize", () => {
          if (worker)
            worker.postMessage({
              type: "resize",
              VW: window.innerWidth,
              VH: window.innerHeight,
              dpr: Math.min(2, window.devicePixelRatio || 1),
            });
        });
        try {
          new MutationObserver(() => {
            if (worker) worker.postMessage({ type: "theme", dark: isDark() });
          }).observe(document.body, {
            attributes: true,
            attributeFilter: ["data-ds-dark-theme"],
          });
        } catch {}

        /* ---- 资源阶段 ---- */
        const expected =
          document.querySelectorAll(
            "script[src],link[rel=stylesheet],link[rel=modulepreload]",
          ).length || 4;
        const seen = {};
        function checkResources() {
          let list = [];
          try {
            list = performance.getEntriesByType("resource") || [];
          } catch {}
          let n = 0;
          let fresh = 0;
          for (const e of list) {
            if (
              !(
                /[.](js|css|svg|woff2?|png|jpg)([?]|$)/.test(e.name) ||
                e.initiatorType === "script" ||
                e.initiatorType === "link"
              )
            )
              continue;
            n++;
            if (!seen[e.name]) {
              seen[e.name] = 1;
              fresh++;
            }
          }
          for (let i = 0; i < fresh && i < expected; i++) {
            pour(0.018, 150 + i * 40);
            pushRow(t("resources") + " · " + shortName(list[i] && list[i].name));
          }
          if (fresh > 0) flashGlow("/api/");
          const detail = el("__bl_dl");
          const status = el("__bl_status");
          if (detail) setDetail(t("resources"), Math.min(n, expected), expected);
          if (status)
            status.textContent = n < expected ? t("downloading") : t("resourcesReady");
        }
        pour(0.02, 120, 0.5);
        const resTimer = setInterval(checkResources, 140);
        checkResources();
        try {
          new PerformanceObserver(() => checkResources()).observe({
            type: "resource",
            buffered: true,
          });
        } catch {}

        /* ---- 资源加载失败（img/script/link 的 error 事件） ---- */
        window.addEventListener(
          "error",
          (e) => {
            const tgt = e && e.target;
            if (!tgt || tgt === window) return;
            const tag = (tgt.tagName || "").toUpperCase();
            /* 只关心「少了它就打不开界面」的资源：脚本、样式、预加载模块。
               图片/favicon 失败要么无关紧要，要么在 dsh 里是正常现象。 */
            const isCode =
              tag === "SCRIPT" ||
              (tag === "LINK" &&
                /(^|\s)(stylesheet|modulepreload|preload)(\s|$)/i.test(tgt.rel || ""));
            if (!isCode) return;
            const src = tgt.src || tgt.href || "";
            if (!src) return;
            noteFailure(shortName(src), t("failedTitle"));
          },
          true,
        );

        /* ---- API ---- */
        const critOf = (url) => {
          let p = "";
          try {
            p = new URL(url, location.href).pathname;
          } catch {
            return null;
          }
          if (p.indexOf("/api/session/list") === 0 || p.indexOf("/api/session.list") === 0)
            return "session";
          if (p.indexOf("/api/job/list") === 0 || p.indexOf("/api/job.list") === 0) return "job";
          return null;
        };

        const origFetch = window.fetch;
        window.fetch = function (input, init) {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          let tracked = false;
          try {
            tracked = new URL(url, location.href).pathname.indexOf("/api") === 0;
          } catch {}
          if (!tracked) return origFetch.apply(this, arguments);
          const crit = critOf(url);
          if (crit === "session") {
            if (historySignal !== "done") historySignal = "pending";
          } else if (crit === "job") {
            if (jobSignal !== "done") jobSignal = "pending";
          }
          apiStarted++;
          const nm = label(url);
          const rid = pushRow(t(nm) + " · " + shortName(url));
          flashGlow(url);
          const status = el("__bl_status");
          if (status) status.textContent = t("loadingTopic", { topic: t(nm) });
          setDetail(t("requests"), apiDone, apiStarted);
          pour(0.008, 110);
          let p;
          try {
            p = origFetch.apply(this, arguments);
          } catch (err) {
            apiDone++;
            finishRow(rid);
            pour(0.012, 130);
            const aborted0 =
              !!err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")));
            if (!aborted0) noteFailure(shortName(url), reasonOf(err));
            if (crit === "session") historySignal = "done";
            else if (crit === "job") jobSignal = "done";
            throw err;
          }
          if (!p || typeof p.then !== "function") return p;
          return p.then(
            (r) => {
              apiDone++;
              finishRow(rid);
              pour(0.012, 130);
              if (crit === "session") historySignal = "done";
              else if (crit === "job") jobSignal = "done";
              /* 只把「真失败」算进去：4xx 在 dsh 里常是探测性请求的正常答复
                 （/git/status 400、task-board/state 403），5xx 才是服务端真出错；
                 关键端点（历史/任务列表）失败时无论状态码都要报。 */
              if (r && r.ok === false) {
                const st = r.status;
                if (crit || st >= 500) noteFailure(shortName(url), "HTTP " + st);
              }
              return r;
            },
            (err) => {
              apiDone++;
              finishRow(rid);
              pour(0.012, 130);
              if (crit === "session") historySignal = "done";
              else if (crit === "job") jobSignal = "done";
              /* 取消（abort）不算失败：dsh 会主动取消过期的探测请求 */
              const aborted =
                !!err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")));
              if (!aborted) noteFailure(shortName(url), reasonOf(err));
              throw err;
            },
          );
        };

        const apiTimer = setInterval(() => {
          if (apiStarted > 0) {
            setDetail(t("requests"), apiDone, apiStarted);
            const st2 = el("__bl_status");
            if (st2 && mounted)
              st2.textContent = apiDone < apiStarted ? t("contentLoading") : t("contentReady");
          }
        }, 180);

        function finish(reason) {
          if (done) return;
          clearInterval(resTimer);
          clearInterval(apiTimer);
          if (worker) worker.postMessage({ type: "finish" });
          done = true;
          const st3 = el("__bl_status");
          if (st3) st3.textContent = t("done");
          setDetailText(reason || "");
          try {
            const rr = document.getElementById("root");
            globalThis.__betterloadingDone = {
              reason: reason || "",
              historySignal: historySignal || "none",
              jobSignal: jobSignal || "none",
              mounted,
              failed: fails.length,
              rootText: rr ? (rr.innerText || "").length : -1,
              rootElems: rr ? rr.querySelectorAll("*").length : -1,
              apiStarted,
              apiDone,
              atMs: Math.round(performance.now()),
            };
          } catch {}
          if (root) root.classList.add("__done");
          setTimeout(() => {
            removed = true;
            cancelAnimationFrame(pctRaf);
            if (worker) {
              worker.terminate();
              worker = null;
            }
            if (root && root.parentNode) root.parentNode.removeChild(root);
            if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
            if (mo) mo.disconnect();
          }, 1500);
          window.fetch = origFetch;
        }

        function contentReady() {
          const r = document.getElementById("root");
          if (!r) return false;
          return (
            (r.innerText || "").length > 60 ||
            r.querySelectorAll("button,[role=button],input").length > 4
          );
        }

        let steady = 0;
        let readySince = 0;
        let historyDoneAt = 0;
        const guardStart = Date.now();
        const guard = setInterval(() => {
          if (done) return;

          /* 主判定：会话历史真的加载完了 */
          const critOk = historySignal !== "pending" && jobSignal !== "pending";
          if (mounted && historySignal === "done" && critOk) {
            if (!historyDoneAt) historyDoneAt = Date.now();
            if (Date.now() - historyDoneAt > 200) {
              clearInterval(guard);
              finish(t("contentReady"));
              return;
            }
          } else {
            historyDoneAt = 0;
          }

          const noHistorySignal =
            historySignal === undefined && Date.now() - guardStart > 3000;
          const ready = mounted && contentReady();
          if (ready && !readySince) readySince = Date.now();
          const noPending = apiStarted - apiDone <= 0;
          if (
            ready &&
            noPending &&
            (noHistorySignal || historySignal === "done") &&
            ++steady >= 2
          ) {
            clearInterval(guard);
            finish(apiStarted ? t("totalRequests", { n: apiStarted }) : "");
            return;
          }
          if (!noPending) steady = 0;
          if (ready && readySince && Date.now() - readySince > 800) {
            clearInterval(guard);
            finish(t("contentReady"));
            return;
          }
        }, 200);

        setTimeout(() => {
          if (!done && mounted && apiStarted === 0) {
            clearInterval(guard);
            finish("");
          }
        }, 3500);
        setTimeout(() => {
          if (!done) {
            clearInterval(guard);
            finish(t("timeout"));
          }
        }, CFG.idleTimeoutMs);
      };

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

      /* 启动（等 body 可用） */
      if (document.body) boot();
      else document.addEventListener("DOMContentLoaded", boot, { once: true });
    }

    exports.inject = [];
    exports.apply = apply;
    return module.exports;
  },
});

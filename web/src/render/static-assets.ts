// document.ts に埋め込むCSS/JS定数。中身は1文字も変えず移動のみ。
export const REPORT_SAVE_BOOT = `
(function(){
  const button=document.getElementById('save-html-button');
  if(!button)return;
  const status=document.getElementById('save-html-status');
  const actions=button.closest('.report-actions');
  button.addEventListener('click',function(){
    const filename=(actions&&actions.getAttribute('data-filename'))||'tetrio_report.html';
    const html='<!doctype html>\\n'+document.documentElement.outerHTML;
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},30000);
    if(status)status.textContent='保存ファイルを作成。';
  });
}());
`;

// モバイルの列優先表で「全列を表示／主要列だけ表示」を切り替える。
export const REPORT_MOBILE_BOOT = `
(function(){
  document.querySelectorAll('.mobile-toggle').forEach(function(btn){
    btn.addEventListener('click',function(){
      var box=btn.closest('.mobile-priority');
      if(!box)return;
      var open=box.classList.toggle('show-all');
      btn.setAttribute('aria-expanded',open?'true':'false');
      btn.textContent=open?'主要列だけ表示':'全列を表示';
    });
  });
}());
`;

// Chart.js 描画ブートストラップ。configs.ts の $pct / $unit / $notes / $pointLabels /
// options.refLines マーカーを解釈する（関数はJSON化できないためここで付与する）。
export const CHART_BOOT = `
Chart.defaults.font.family='"Noto Sans CJK JP","Hiragino Kaku Gothic ProN",system-ui,sans-serif';
Chart.defaults.font.size=11.5;
Chart.defaults.color='#374151';
Chart.register({id:'refLines',afterDatasetsDraw(chart){
  const lines=(chart.options&&chart.options.refLines)||[];const area=chart.chartArea;const ctx=chart.ctx;
  for(const line of lines){
    const scale=chart.scales[line.axis||(line.x!==undefined?'x':'y')];
    if(!scale||!area)continue;
    ctx.save();ctx.strokeStyle=line.color||'#94a3b8';ctx.lineWidth=1;
    ctx.setLineDash(line.dash===undefined?[5,4]:line.dash);ctx.beginPath();
    if(line.x!==undefined){const px=scale.getPixelForValue(line.x);
      if(px>=area.left-1&&px<=area.right+1){ctx.moveTo(px,area.top);ctx.lineTo(px,area.bottom);}}
    else{const py=scale.getPixelForValue(line.y);
      if(py>=area.top-1&&py<=area.bottom+1){ctx.moveTo(area.left,py);ctx.lineTo(area.right,py);}}
    ctx.stroke();ctx.restore();
  }
}});
Chart.register({id:'pointTextLabels',afterDatasetsDraw(chart){
  chart.data.datasets.forEach(function(ds,di){
    const labels=ds.$pointLabels;if(!labels)return;
    const meta=chart.getDatasetMeta(di);if(meta.hidden)return;
    meta.data.forEach(function(el,i){
      const text=labels[i];if(!text||ds.data[i]==null)return;
      const ctx=chart.ctx;ctx.save();
      ctx.font='bold 10px sans-serif';ctx.fillStyle=ds.borderColor||'#111827';
      ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillText(String(text),el.x,el.y-7);ctx.restore();
    });
  });
}});
function radarUnits(labels){const n=labels.length;
  return labels.map(function(_,i){const a=Math.PI/2-(i*2*Math.PI/n);return{x:Math.cos(a),y:Math.sin(a)};});}
function radarRingStep(radialMax){const raw=radialMax/4;
  const pow=Math.pow(10,Math.floor(Math.log10(raw)));const m=raw/pow;
  return (m>=5?5:m>=2.5?2.5:m>=2?2:m>=1?1:0.5)*pow;}
Chart.register({id:'signedRadar',beforeDatasetsDraw(chart,args,opts){
  if(!opts||!opts.labels)return;
  const xs=chart.scales.x,ys=chart.scales.y;if(!xs||!ys)return;
  const radialMax=opts.radialMax||1,ctx=chart.ctx,units=radarUnits(opts.labels);
  const path=function(r){units.forEach(function(u,i){const px=xs.getPixelForValue(u.x*r),py=ys.getPixelForValue(u.y*r);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});ctx.closePath();};
  const step=radarRingStep(radialMax);
  const rings=[];for(let r=step;r<=radialMax*1.001;r+=step)rings.push(r);
  ctx.save();
  ctx.fillStyle='rgba(100,116,139,.055)';
  for(let i=0;i<rings.length;i+=2){ctx.beginPath();path(rings[i]);if(i>0)path(rings[i-1]);ctx.fill('evenodd');}
  rings.forEach(function(r,i){
    ctx.beginPath();path(r);
    const outer=i===rings.length-1;
    ctx.strokeStyle=outer?'#b8bfcc':'#d9dde5';ctx.lineWidth=outer?1.2:.8;ctx.stroke();
  });
  ctx.strokeStyle='#c9cfda';ctx.lineWidth=.8;
  units.forEach(function(u){ctx.beginPath();ctx.moveTo(xs.getPixelForValue(-u.x*radialMax),ys.getPixelForValue(-u.y*radialMax));ctx.lineTo(xs.getPixelForValue(u.x*radialMax),ys.getPixelForValue(u.y*radialMax));ctx.stroke();});
  ctx.font='9.5px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.9)';
  rings.forEach(function(r){
    const text=String(Math.round(r*100)/100);
    const px=xs.getPixelForValue(0)+5,py=ys.getPixelForValue(r);
    ctx.strokeText(text,px,py);ctx.fillStyle='#98a0ad';ctx.fillText(text,px,py);
  });
  ctx.restore();
},afterDatasetsDraw(chart,args,opts){
  if(!opts||!opts.labels)return;
  const xs=chart.scales.x,ys=chart.scales.y;if(!xs||!ys)return;
  const radialMax=opts.radialMax||1,ctx=chart.ctx,units=radarUnits(opts.labels),labelRadius=radialMax*1.08;
  ctx.save();ctx.font='bold 10.5px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.92)';ctx.lineJoin='round';
  opts.labels.forEach(function(label,i){
    const u=units[i],text=String(label);
    const half=ctx.measureText(text).width/2;
    const px=Math.min(Math.max(xs.getPixelForValue(u.x*labelRadius),half+2),chart.width-half-2);
    const py=ys.getPixelForValue(u.y*labelRadius);
    ctx.strokeText(text,px,py);ctx.fillStyle='#334155';ctx.fillText(text,px,py);
  });
  ctx.fillStyle='#94a3b8';ctx.beginPath();ctx.arc(xs.getPixelForValue(0),ys.getPixelForValue(0),2.5,0,Math.PI*2);ctx.fill();ctx.restore();
}});
function fmtVal(v){if(v==null||!isFinite(v))return'—';
  if(Math.abs(v)>=1000)return Math.round(v).toLocaleString();
  return String(Math.round(v*100)/100);}
function hexA(hex,a){const c=hex.replace('#','');
  return'rgba('+parseInt(c.slice(0,2),16)+','+parseInt(c.slice(2,4),16)+','+parseInt(c.slice(4,6),16)+','+a+')';}
function radarFillGradient(chart,color,alpha){
  const xs=chart.scales.x,ys=chart.scales.y;
  const edge=Math.min(1,alpha*1.7),center=alpha*.3;
  if(!xs||!ys||!chart.chartArea)return hexA(color,alpha);
  const sr=(chart.options.plugins&&chart.options.plugins.signedRadar)||{};
  const cx=xs.getPixelForValue(0),cy=ys.getPixelForValue(0);
  const r=Math.max(1,Math.abs(xs.getPixelForValue(sr.radialMax||1)-cx));
  const g=chart.ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,hexA(color,center));g.addColorStop(1,hexA(color,edge));
  return g;}
function enhanceConfig(cfg){
  const o=cfg.options=cfg.options||{};
  const scales=o.scales||{};
  if(o.$signedRadar){cfg.data.datasets.forEach(function(ds){
    if(!ds.$fillColor)return;
    const col=ds.$fillColor,alpha=ds.$fillAlpha||.15;
    ds.backgroundColor=function(c){return radarFillGradient(c.chart,col,alpha);};
  });}
  for(const key of Object.keys(scales)){const s=scales[key];
    if(s&&s.$pct){s.ticks=Object.assign({},s.ticks,{callback:function(v){return v+'%';}});}}
  const horizontal=o.indexAxis==='y';
  o.plugins=o.plugins||{};
  o.plugins.legend=o.plugins.legend||{};
  o.plugins.legend.labels=Object.assign({},o.plugins.legend.labels,{sort:function(a,b){return a.datasetIndex-b.datasetIndex;}});
  o.plugins.tooltip=Object.assign({},o.plugins.tooltip,{callbacks:{
    label:function(c){const ds=c.dataset;const name=ds.label?ds.label+': ':'';
      if(ds.$radarValues){const axis=ds.$radarLabels&&ds.$radarLabels[c.dataIndex]?ds.$radarLabels[c.dataIndex]+': ':'';return name+axis+fmtVal(ds.$radarValues[c.dataIndex]);}
      if(cfg.type==='scatter'){return name+'('+fmtVal(c.parsed.x)+', '+fmtVal(c.parsed.y)+')';}
      if(Array.isArray(c.raw)){return name+fmtVal(c.raw[0])+' 〜 '+fmtVal(c.raw[1])+(ds.$unit||'');}
      const raw=cfg.type==='radar'?c.parsed.r:(horizontal?c.parsed.x:c.parsed.y);
      return name+fmtVal(raw)+(ds.$unit||'');},
    afterLabel:function(c){const notes=c.dataset.$notes;
      return notes&&notes[c.dataIndex]?String(notes[c.dataIndex]):'';}
  }});
}
for(const [id,cfg] of Object.entries(CHART_CONFIGS)){
  const el=document.getElementById(id);
  if(!el)continue;
  enhanceConfig(cfg);
  if(cfg.options&&cfg.options.$signedRadar){const box=el.closest('.chart');if(box)box.classList.add('signed-radar');}
  else if(cfg.type==='radar'||cfg.type==='scatter'||(cfg.options&&cfg.options.$tall)){const box=el.closest('.chart');if(box)box.classList.add('tall');}
  new Chart(el,cfg);
}
`;

// src/report_builder/template/report.css を移植し、canvas 描画用の .fig .chart 規則を追加。
export const REPORT_CSS = `
:root{
--ink:#15161e;--muted:#565d6f;--bg:#fbfbfd;--surface:#fff;--surface-2:#f5f6fb;
--border:#e7e9f2;--border-strong:#d6d9e6;
--primary:#4f46e5;--primary-hover:#4338ca;--primary-tint:#e0e7ff;--accent:#6366f1;
--win:#16a34a;--loss:#dc2626;--amber:#f59e0b;--warn:#b45309;--info:#1d4ed8;
--space-1:8px;--space-2:16px;--space-3:32px;--gap-chap:48px;--gap-part:64px;
--radius-s:8px;--radius-m:12px;--radius-pill:999px;
--shadow-1:0 1px 2px rgba(21,22,30,.05);--shadow-2:0 6px 18px rgba(21,22,30,.14);
--focus-ring:0 0 0 3px rgba(79,70,229,.22);
}
*{box-sizing:border-box}
body{font-family:"Noto Sans CJK JP","Hiragino Kaku Gothic ProN",system-ui,sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.8;font-size:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.wrap{max-width:980px;margin:0 auto;padding:32px 22px 80px;}
header.top{border-bottom:2px solid var(--ink);padding-bottom:20px;margin-bottom:8px;}
header.top h1{font-size:32px;margin:0 0 6px;letter-spacing:.01em;line-height:1.25;}
header.top .sub{color:var(--muted);font-size:14px;}
a{color:var(--primary);}
a:hover{color:var(--primary-hover);}
a:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:2px;}
.report-actions{display:flex;align-items:center;gap:var(--space-1);margin:16px 0 8px;}
.report-actions button{appearance:none;border:1px solid var(--primary);background:var(--primary);color:#fff;border-radius:var(--radius-s);padding:8px 16px;font-weight:800;font-size:13px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease;}
.report-actions button:hover{background:var(--primary-hover);border-color:var(--primary-hover);}
.report-actions button:focus-visible{outline:none;box-shadow:var(--focus-ring);}
.report-actions span{font-size:12.5px;}
h2.part{font-size:13px;font-weight:800;letter-spacing:.06em;color:var(--primary);margin:var(--gap-part) 0 0;display:flex;align-items:center;gap:12px;scroll-margin-top:16px;}
h2.part .pno{background:var(--primary);color:#fff;border-radius:var(--radius-s);padding:4px 12px;font-size:13px;font-weight:800;}
h2.part::after{content:"";flex:1;height:2px;background:var(--accent);opacity:.3;}
h2.part + h2.chap{margin-top:var(--space-2);border-top:none;padding-top:0;}
h2.chap{font-size:24px;margin:var(--gap-chap) 0 4px;padding-top:10px;border-top:1px solid var(--border-strong);display:flex;align-items:baseline;gap:12px;scroll-margin-top:16px;line-height:1.3;}
h2.chap .no{color:var(--primary);font-weight:800;font-size:16px;background:var(--primary-tint);border-radius:var(--radius-s);padding:3px 11px;}
h2.chap .toclink{margin-left:auto;font-size:12px;font-weight:700;color:var(--muted);text-decoration:none;}
h2.chap .toclink:hover{color:var(--primary);}
h2.chap .toclink:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}
h3{font-size:17px;font-weight:700;margin:var(--space-3) 0 6px;color:var(--ink);line-height:1.5;}
.lead{color:var(--muted);font-size:15px;margin:2px 0 14px;line-height:1.7;}
p{margin:10px 0;}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-2);margin:var(--space-3) 0 var(--space-1);}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-m);padding:var(--space-2);}
.kpi .lab{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.02em;}
.kpi .val{font-size:28px;font-weight:800;margin-top:3px;font-variant-numeric:tabular-nums;}
.kpi .note{font-size:12px;color:var(--muted);margin-top:2px;}
.badge{display:inline-block;font-size:12px;font-weight:800;border-radius:var(--radius-pill);padding:1px 8px;margin-right:7px;white-space:nowrap;}
.badge.neutral{background:#dbeafe;color:var(--info);}
.badge.hi{background:var(--primary-tint);color:var(--primary-hover);}
.badge.mid{background:#eef0f4;color:#475569;}
.badge.good{background:#dcfce7;color:#15803d;}
.badge.bad{background:#fee2e2;color:#b91c1c;}
.glossary{font-size:13.5px;}
.glossary dl{display:grid;grid-template-columns:minmax(80px,130px) 1fr;gap:6px 12px;margin:8px 0 4px;}
.glossary dt{font-weight:800;}
.glossary dd{margin:0;color:var(--muted);}
abbr[title]{text-decoration:underline dotted;text-underline-offset:3px;cursor:help;}
.toc{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-m);padding:var(--space-2) var(--space-3);margin:var(--space-3) 0;}
.toc ol{margin:6px 0;padding-left:22px;} .toc li{margin:3px 0;}
.toc .toc-part{font-weight:800;color:var(--primary);font-size:13px;letter-spacing:.03em;margin:12px 0 2px;}
.toc .toc-part:first-of-type{margin-top:6px;}
.toc a{color:var(--ink);text-decoration:none;border-bottom:1px solid transparent;}
.toc a:hover{border-bottom-color:var(--primary);color:var(--primary);}
.toc a:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}
.fig{margin:var(--space-2) 0 var(--space-1);text-align:center;}
.fig .chart{height:330px;border:1px solid var(--border);border-radius:var(--radius-m);background:var(--surface);padding:var(--space-2);box-shadow:var(--shadow-1);}
.fig .chart.tall{height:420px;}
.fig .chart.signed-radar{height:600px;max-width:560px;margin:0 auto;}
.fig .chart canvas{width:100%!important;height:100%!important;}
.block{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:0 var(--radius-m) var(--radius-m) 0;padding:var(--space-2);margin:var(--space-2) 0 var(--space-3);}
.block .tag{display:inline-block;font-size:12px;font-weight:700;color:var(--primary);background:var(--primary-tint);border-radius:var(--radius-s);padding:1px 9px;margin-right:7px;}
.block .tag.warn{color:var(--warn);background:#fef3c7;}
.block p{margin:7px 0;font-size:14px;line-height:1.7;}
.block .caption,.block .headline{color:var(--ink);font-size:14px;font-weight:400;line-height:1.7;}
.block .caption{margin:0 0 7px;}
.block .caveat{margin:9px 0 0;font-size:12.5px;line-height:1.6;}
.caveat-tag{display:inline-block;color:var(--muted);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-pill);padding:1px 9px;margin:2px 6px 2px 0;font-size:12px;font-weight:700;text-decoration:none;}
.caveat-tag:hover{color:var(--primary);border-color:var(--primary);}
.caveat-tag:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}
.notes{margin:var(--gap-chap) 0 0;font-size:13.5px;}
.notes dt{scroll-margin-top:20px;}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:10px 0;}
th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--border);}
th{background:var(--surface-2);color:var(--ink);font-weight:700;border-bottom:2px solid var(--border-strong);}
td{font-variant-numeric:tabular-nums;}
td.l,th.l{text-align:left;}
tbody tr:nth-child(even){background:var(--surface-2);}
.dir{font-size:11px;color:var(--muted);font-weight:700;margin-left:2px;}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
.scroll table{min-width:880px;}
.mobile-toggle{display:none;appearance:none;border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:var(--radius-s);padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:2px 0 6px;}
.mobile-toggle:hover{color:var(--primary);border-color:var(--primary);}
.mobile-toggle:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}
.only-mobile{display:none;}
.rc-list{margin:12px 0;}
.rc-card{border:1px solid var(--border);border-radius:var(--radius-m);background:var(--surface);padding:var(--space-2);margin:9px 0;}
.rc-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap;line-height:1.5;}
.rc-cond{font-weight:700;font-size:13.5px;}
.rc-detail{font-size:12px;color:var(--muted);margin-top:3px;}
.rc-detail:empty{display:none;}
.rc-watch{font-size:12px;margin-top:3px;}
.rc-target{font-size:13px;margin-top:6px;}
.rc-link{margin-top:7px;font-size:13px;font-weight:700;}
details{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-m);padding:6px 16px;margin:14px 0;}
summary{cursor:pointer;font-weight:700;padding:8px 0;font-size:15px;}
summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:4px;}
.backtop{position:fixed;right:16px;bottom:16px;background:var(--ink);color:#fff;text-decoration:none;border-radius:var(--radius-pill);padding:7px 11px;font-size:12px;font-weight:800;box-shadow:var(--shadow-2);}
.backtop:hover{background:#30313d;}
.backtop:focus-visible{outline:2px solid #fff;outline-offset:2px;}
.muted{color:var(--muted);}
.message{padding:48px 0;} .message a{font-weight:700;}
footer{margin-top:var(--gap-part);border-top:1px solid var(--border);padding-top:20px;color:var(--muted);font-size:12.5px;}
.note-box{background:#fffdf5;border:1px solid #f3e6c0;border-radius:var(--radius-m);padding:12px 18px;margin:16px 0;font-size:13.5px;}
@media (max-width:700px){
  .wrap{padding:24px 14px 72px;}
  header.top h1{font-size:26px;}
  h2.chap{font-size:21px;gap:8px;}
  h2.chap .toclink{font-size:11px;}
  .glossary dl{display:block;}
  .glossary dt{margin-top:6px;}
  .fig .chart{height:270px;padding:var(--space-1);}
  .fig .chart.tall{height:340px;}
  .fig .chart.signed-radar{height:400px;max-width:360px;}
  .scroll.mobile-card{overflow:visible;}
  .scroll.mobile-card table,.scroll.mobile-card thead,.scroll.mobile-card tbody,.scroll.mobile-card tr,.scroll.mobile-card th,.scroll.mobile-card td{display:block;width:100%;min-width:0!important;}
  .scroll.mobile-card thead{display:none;}
  .scroll.mobile-card tr{border:1px solid var(--border);border-radius:var(--radius-s);background:var(--surface);margin:10px 0;padding:6px 8px;}
  .scroll.mobile-card td{border:0;border-bottom:1px solid var(--border);text-align:left;padding:6px 2px 6px 42%;position:relative;min-height:28px;}
  .scroll.mobile-card td:last-child{border-bottom:0;}
  .scroll.mobile-card td::before{content:attr(data-label);position:absolute;left:2px;top:6px;width:38%;color:var(--muted);font-weight:700;white-space:normal;}
  .only-desktop{display:none;}
  .only-mobile{display:block;}
  .scroll:not(.mobile-priority) table,.scroll.mobile-priority:not(.show-all) table{min-width:0!important;}
  .scroll.mobile-priority:not(.show-all) .mhide{display:none;}
  .scroll:not(.mobile-card) th,.scroll:not(.mobile-card) td{padding:5px 6px;}
  .mobile-toggle{display:inline-block;}
}
@media print{.kpi,.block,.toc{break-inside:avoid;} body{font-size:12px;} .fig .chart{height:260px;box-shadow:none;} .fig .chart.signed-radar{height:500px;max-width:460px;} .backtop{display:none;}}
`;

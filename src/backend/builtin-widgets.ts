import type { WidgetRegistry } from './widget-registry.js';

/**
 * Built-in plugin widgets registered when the WidgetRegistry is first
 * constructed. Same shape as a third-party plugin — they go through
 * the exact same code path. The advantage of registering them here
 * instead of in src/agent/types.ts as a built-in WidgetKind is that
 * the rendering surface (sandboxed iframe + postMessage prop bridge)
 * is shared with third-party plugins; iterating on the chart UI is
 * a srcdoc edit, not a tldraw shape-util refactor.
 *
 * To add another built-in: append to the array. The descriptor format
 * is the same union backing POST /v1/canvas/widget-kinds — see
 * src/backend/widget-registry.ts for the shape.
 */
export function registerBuiltinWidgets(registry: WidgetRegistry): void {
  registry.register({
    kind: 'chart',
    label: 'Chart',
    description:
      'Render a Vega-Lite spec. Pass {spec} (Vega-Lite v5 JSON) in the props. ' +
      'Useful for line/bar/scatter/heatmap/candlestick — anything Vega-Lite supports.',
    renderer: {
      type: 'iframe',
      sandbox: 'allow-scripts',
      defaultSize: { w: 520, h: 360 },
      srcdoc: CHART_SRCDOC,
    },
  });
}

/**
 * Vega-Lite chart renderer template.
 *
 * Loads vega + vega-lite + vega-embed from a CDN (the only network
 * call inside the sandboxed iframe). Reads the spec from
 * window.opencanvas.props.spec on first render; subsequent prop
 * updates arrive via the 'opencanvas:props' DOM event the plugin
 * shim dispatches.
 *
 * Container fills 100% w/h; embed config sets `actions: false` (no
 * kebab menu) and a transparent background so the card surface
 * shows through. Dark theme baked into config so charts look right
 * against OpenCanvas card surfaces even when the agent's spec
 * doesn't supply its own theme.
 */
const CHART_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#chart{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
.error{color:#fca5a5;font-size:11px;padding:18px;font-family:'JetBrains Mono',ui-monospace,monospace;white-space:pre-wrap;overflow:auto}
</style>
<script src="https://cdn.jsdelivr.net/npm/vega@5.30.0/build/vega.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-lite@5.21.0/build/vega-lite.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-embed@6.26.0/build/vega-embed.min.js"></script>
</head><body>
<div id="chart"></div>
<script>
(function(){
var DARK_CONFIG={
  background:"transparent",
  view:{stroke:"transparent"},
  axis:{labelColor:"#a1a1aa",titleColor:"#d4d4d8",gridColor:"rgba(255,255,255,0.06)",domainColor:"rgba(255,255,255,0.18)",tickColor:"rgba(255,255,255,0.18)"},
  legend:{labelColor:"#d4d4d8",titleColor:"#fafafa"},
  title:{color:"#fafafa",subtitleColor:"#a1a1aa"},
  range:{category:["#a78bfa","#60a5fa","#34d399","#fbbf24","#fb7185","#67e8f9","#f472b6","#84cc16"]}
};
var container=document.getElementById("chart");
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function showEmpty(){
  clear(container);
  var d=document.createElement("div");d.className="empty";
  var t1=document.createTextNode("No spec yet — pass ");
  var code=document.createElement("span");code.className="ck";code.textContent="{spec}";
  var t2=document.createTextNode(" in the widget payload.");
  var br=document.createElement("br");
  var t3=document.createTextNode("Vega-Lite v5 JSON.");
  d.appendChild(t1);d.appendChild(code);d.appendChild(t2);d.appendChild(br);d.appendChild(t3);
  container.appendChild(d);
}
function showError(msg){clear(container);var p=document.createElement("pre");p.className="error";p.textContent=String(msg);container.appendChild(p);}
function render(spec){
  if(!spec){showEmpty();return;}
  var s=Object.assign({width:"container",height:"container",config:DARK_CONFIG},spec);
  if(!s.config){s.config=DARK_CONFIG;}
  try{
    vegaEmbed(container,s,{actions:false,renderer:"canvas"}).catch(function(e){showError(e.message||e);});
  }catch(e){showError(e.message||e);}
}
function readSpec(){var p=window.opencanvas&&window.opencanvas.props;return p&&p.spec;}
render(readSpec());
document.addEventListener("opencanvas:props",function(e){render(e.detail&&e.detail.spec);});
window.addEventListener("resize",function(){render(readSpec());});
})();
</script></body></html>`;

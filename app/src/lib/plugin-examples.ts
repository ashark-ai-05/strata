import type { PluginKindDescriptor } from '../state/plugin-registry-store';

export type ExamplePlugin = {
  descriptor: PluginKindDescriptor;
};

// ---------------------------------------------------------------------------
// Mermaid Diagram
// Loads mermaid@10 from CDN, renders a diagram from window.opencanvas.props.chart
// Note: mermaid.render() returns SVG text which we set via the mermaid API's
// own container — we use a scratch element whose id is managed by mermaid
// itself. The result is then moved into our container via appendChild.
// ---------------------------------------------------------------------------
const MERMAID_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;padding:12px}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
.error{color:#fca5a5;font-size:11px;padding:18px;font-family:'JetBrains Mono',ui-monospace,monospace;white-space:pre-wrap;overflow:auto}
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head><body>
<div id="root"></div>
<script>
(function(){
mermaid.initialize({startOnLoad:false,theme:'dark',themeVariables:{primaryColor:'#a78bfa',primaryTextColor:'#fafafa',primaryBorderColor:'rgba(255,255,255,0.18)',lineColor:'#a1a1aa',background:'transparent',mainBkg:'rgba(255,255,255,0.06)',nodeBorder:'rgba(255,255,255,0.18)',clusterBkg:'rgba(255,255,255,0.03)',titleColor:'#fafafa',edgeLabelBackground:'rgba(10,10,13,0.8)',tertiaryColor:'rgba(255,255,255,0.04)'}});
var container=document.getElementById('root');
var renderCount=0;
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function showEmpty(){
  clear(container);
  var d=document.createElement('div');d.className='empty';
  var t1=document.createTextNode('No chart yet — pass ');
  var code=document.createElement('span');code.className='ck';code.textContent='{chart}';
  var t2=document.createTextNode(' as the widget prop.');
  d.appendChild(t1);d.appendChild(code);d.appendChild(t2);
  container.appendChild(d);
}
function showError(msg){clear(container);var p=document.createElement('pre');p.className='error';p.textContent=String(msg);container.appendChild(p);}
function render(chart){
  if(!chart||!chart.trim()){showEmpty();return;}
  renderCount++;
  var svgId='mermaid-svg-'+renderCount;
  mermaid.render(svgId,chart).then(function(result){
    clear(container);
    var tmp=document.createElement('div');
    tmp.style.cssText='max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center';
    var parser=new DOMParser();
    var doc=parser.parseFromString(result.svg,'image/svg+xml');
    var svgEl=doc.documentElement;
    svgEl.setAttribute('style','max-width:100%;height:auto');
    container.appendChild(tmp);
    tmp.appendChild(document.adoptNode(svgEl));
  }).catch(function(e){showError(e.message||e);});
}
function readChart(){var p=window.opencanvas&&window.opencanvas.props;return p&&p.chart;}
render(readChart());
document.addEventListener('opencanvas:props',function(e){render(e.detail&&e.detail.chart);});
})();
</script></body></html>`;

// ---------------------------------------------------------------------------
// QR Code
// Loads qrcode from CDN, renders a QR code canvas from window.opencanvas.props.data
// ---------------------------------------------------------------------------
const QRCODE_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:transparent;color:#fafafa;font-family:'Inter',system-ui,sans-serif}
#root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:12px}
.empty{color:#a1a1aa;font-size:12px;padding:24px;text-align:center;line-height:1.5}
.empty .ck{background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;color:#ddd6fe;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px}
</style>
<script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
</head><body>
<div id="root"></div>
<script>
(function(){
var container=document.getElementById('root');
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function showEmpty(){
  clear(container);
  var d=document.createElement('div');d.className='empty';
  var t1=document.createTextNode('No data yet — pass ');
  var code=document.createElement('span');code.className='ck';code.textContent='{data}';
  var t2=document.createTextNode(' as the widget prop.');
  d.appendChild(t1);d.appendChild(code);d.appendChild(t2);
  container.appendChild(d);
}
function render(data){
  if(!data||!String(data).trim()){showEmpty();return;}
  var size=Math.min(container.clientWidth||200,container.clientHeight||200,200);
  var canvas=document.createElement('canvas');
  canvas.style.cssText='max-width:100%;max-height:100%;object-fit:contain';
  QRCode.toCanvas(canvas,String(data),{
    width:size,
    margin:1,
    color:{dark:'#fafafa',light:'#00000000'}
  },function(err){
    if(err){
      clear(container);
      var p=document.createElement('pre');
      p.style.cssText='color:#fca5a5;font-size:11px;padding:18px;font-family:monospace;white-space:pre-wrap;overflow:auto';
      p.textContent=String(err);
      container.appendChild(p);
      return;
    }
    clear(container);
    container.appendChild(canvas);
  });
}
function readData(){var p=window.opencanvas&&window.opencanvas.props;return p&&p.data;}
render(readData());
document.addEventListener('opencanvas:props',function(e){render(e.detail&&e.detail.data);});
})();
</script></body></html>`;

export const EXAMPLE_PLUGINS: ExamplePlugin[] = [
  {
    descriptor: {
      kind: 'mermaid',
      label: 'Mermaid Diagram',
      description:
        'Render flowcharts, sequence diagrams, gantt, class, ER, and more from Mermaid syntax. Pass {chart} as the prop.',
      renderer: {
        type: 'iframe',
        srcdoc: MERMAID_SRCDOC,
        sandbox: 'allow-scripts',
        defaultSize: { w: 480, h: 360 },
      },
    },
  },
  {
    descriptor: {
      kind: 'qrcode',
      label: 'QR Code',
      description:
        'Generate a QR code from any text or URL. Pass {data} as the prop. Renders on canvas, scales to widget size.',
      renderer: {
        type: 'iframe',
        srcdoc: QRCODE_SRCDOC,
        sandbox: 'allow-scripts',
        defaultSize: { w: 240, h: 240 },
      },
    },
  },
];

// Active work never changes code underneath an open form.
function compareVersion(a,b){const parse=v=>{const [core,pre]=v.split('-');return{core:core.split('.').map(Number),pre:pre?.split('.')};},x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]-y.core[i];if(!x.pre||!y.pre)return x.pre?-1:y.pre?1:0;for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){if(x.pre[i]===undefined)return-1;if(y.pre[i]===undefined)return 1;if(x.pre[i]!==y.pre[i])return x.pre[i].localeCompare(y.pre[i],'en',{numeric:true});}return 0;}
export function createModuleSwitch(baseline){const active={...baseline},pending={};return{
 offer(key,descriptor){if(!descriptor||descriptor.packageHash===active[key]?.packageHash||baseline[key]&&compareVersion(descriptor.version,baseline[key].version)<0){delete pending[key];return false;}pending[key]=descriptor;return true;},
 adopt(key,{login=false,safe=false}={}){if(!pending[key]||(key==='identity'?!login:!safe))return active[key];active[key]=pending[key];delete pending[key];return active[key];},
 current:key=>active[key],pending:()=>({...pending})};}

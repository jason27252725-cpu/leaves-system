// Active work never changes code underneath an open form.
export function createModuleSwitch(baseline){const active={...baseline},pending={};return{
 offer(key,descriptor){if(!descriptor||descriptor.packageHash===active[key]?.packageHash){delete pending[key];return false;}pending[key]=descriptor;return true;},
 adopt(key,{login=false,safe=false}={}){if(!pending[key]||(key==='identity'?!login:!safe))return active[key];active[key]=pending[key];delete pending[key];return active[key];},
 current:key=>active[key],pending:()=>({...pending})};}

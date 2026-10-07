import { createQuantityWorkspace } from './quantity.workspace.js';
import { runQuantityEngineSelfTest } from './quantity.engine.js';

export async function registerLeavesModule(context){
  const workspace=createQuantityWorkspace(context);let contextDispose=null;
  const ensureContext=()=>{
    if(!contextDispose&&context.chat?.registerContextProvider)contextDispose=context.chat.registerContextProvider(async({text})=>{
      const content=workspace.getAiContext?.(text)||'';if(!content)return null;return{label:'LEAVES SKP Direct Reader',priority:86,content};
    });
  };
  const dispose=()=>{try{contextDispose?.();}catch(_){}contextDispose=null;workspace.dispose?.();context.ui?.markCapabilityReady?.('quantity',false);};
  return Object.freeze({
    async onSessionEnd(){dispose();return{ok:true};},
    async open(){context.ui?.openChat?.();ensureContext();workspace.open();context.ui?.markCapabilityReady?.('quantity',true);return{ok:true,mode:'local-skp-direct-reader',storage:'memory-only',backend:false};},
    async close(){workspace.close();},
    async openFile(file){ensureContext();workspace.open();return workspace.openFile(file);},
    async selfTest(){ensureContext();const ws=workspace.selfTest();const engine=runQuantityEngineSelfTest();const errors=[];if(!context?.coreVersion)errors.push('missing coreVersion');if(!context?.moduleVersion)errors.push('missing moduleVersion');if(!engine.ok)errors.push(...engine.errors);if(!ws.ok)errors.push('workspace browser capabilities unavailable');return{ok:errors.length===0,errors,engine,workspace:ws,core:context.coreVersion,module:context.moduleVersion,localOnly:true};},
    getStatus(){return{key:context.moduleKey,version:context.moduleVersion,...workspace.getStatus(),localOnly:true,backend:false};}
  });
}

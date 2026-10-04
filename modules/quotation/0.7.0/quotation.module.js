import { createQuotationEngine } from './quotation.engine.js';
import { createWorkbookBridge } from './quotation.workbook.js';
import { createCostMasterClient } from './quotation.cost.js';
import { createCostRevisionClient } from './quotation.revision.js';
import { createQuotationWorkspace } from './quotation.workspace.js';
import { mountQuotationCapability, unmountQuotationInspector, unmountCostMasterConsole, disposeQuotationCapability } from './quotation.ui.js';

export async function registerLeavesModule(context) {
  const engine=createQuotationEngine();
  const workbook=createWorkbookBridge();
  const cost=createCostMasterClient(context);
  const revision=createCostRevisionClient(context);
  const workspace=createQuotationWorkspace({context,engine,workbook,cost});
  let uiApi=null,chatDispose=null,contextDispose=null;

  const selfTest=async()=>{
    const errors=[];
    if(!context?.coreVersion)errors.push('missing coreVersion');
    if(!context?.moduleVersion)errors.push('missing moduleVersion');
    if(!context?.getMountRoot?.())errors.push('missing chatDrawer mount root');
    if(!context?.getChatContainer?.())errors.push('missing chatContainer');
    if(!context?.getComposerDock?.())errors.push('missing chat composer');
    if(!context?.getSessionSnapshot?.().authenticated)errors.push('missing authenticated session snapshot');
    if(!engine.health().ok)errors.push('quotation engine unhealthy');
    if(!workbook.health().ok)errors.push('workbook bridge unhealthy');
    if(!cost.health().ok)errors.push('cost master client unhealthy');
    if(!revision.health().ok)errors.push('cost revision client unhealthy');
    const probe=engine.normalizeDraftEnvelope(engine.createDraftEnvelope({name:'probe.xlsx',size:1,lastModified:1,extension:'xlsx'},context.accessRole));
    if(!probe?.draftId||!probe?.sourceFileId)errors.push('draft identity foundation unavailable');
    return {ok:errors.length===0,errors,engine:engine.health(),workbook:workbook.health(),cost:cost.health(),revision:revision.health(),workspace:workspace.getStatus(),dynamicRole:context.accessRole,permissions:{canManageCostMaster:!!context.capabilities?.canManageCostMaster,canPublishCostMaster:!!context.capabilities?.canPublishCostMaster},aiWorkbookContext:!!context.chat?.registerContextProvider};
  };
  const ensureMounted=()=>{
    if(!uiApi)uiApi=mountQuotationCapability({context,engine,workbook,cost,revision,workspace});else uiApi.ensureMounted?.();
    if(!chatDispose&&context.chat?.registerCommandHandler)chatDispose=context.chat.registerCommandHandler(({text})=>uiApi?.handleChatCommand?.(text)||null);
    if(!contextDispose&&context.chat?.registerContextProvider)contextDispose=context.chat.registerContextProvider(async({text})=>{
      const content=workspace.getAiContext?.(text)||'';
      if(!content)return null;
      return {label:'LEAVES Quotation Workbook',priority:90,content};
    });
    context.ui?.markCapabilityReady?.('quote',true);return uiApi;
  };
  const dispose=()=>{try{chatDispose?.();}catch(_){}chatDispose=null;try{contextDispose?.();}catch(_){}contextDispose=null;try{workspace.dispose?.();}catch(_){}disposeQuotationCapability({cost,revision,context});uiApi=null;context.ui?.markCapabilityReady?.('quote',false);};
  return Object.freeze({
    async onSessionEnd(){dispose();return{ok:true};},
    async open(){context.ui?.openChat?.();ensureMounted();context.ui?.setRailActiveByAction?.('chat');return{ok:true,mode:'seamless-capability',workspace:'intelligent-review-workspace',costMasterMode:context.capabilities?.canManageCostMaster?'revision-ui-enabled':'read-only'};},
    async close(){workspace.close?.();unmountQuotationInspector();unmountCostMasterConsole();context.ui?.setRailActiveByAction?.('chat');},
    async selfTest(){ensureMounted();return selfTest();},
    async openCostMaster(){return ensureMounted().openCostConsole?.();},
    async getCurrentCostMaster(){return cost.current();},async listCostItems(options={}){return cost.list(options);},async getCostItem(itemCode,options={}){return cost.item(itemCode,options);},async searchCostItems(query,options={}){return cost.search(query,options);},
    async listCostRevisionDrafts(options={}){return revision.listDrafts(options);},async getCostRevisionDraft(draftId,options={}){return revision.getDraft(draftId,options);},
    getCostStatus(){return cost.health();},getRevisionStatus(){return revision.health();},getStatus(){return{key:context.moduleKey,version:context.moduleVersion,stage:engine.stage,seamless:true,engine:engine.health(),workbook:workbook.health(),cost:cost.health(),revision:revision.health(),workspace:workspace.getStatus(),inspectorOpen:!!uiApi?.isInspectorOpen?.(),costConsoleOpen:!!uiApi?.isCostConsoleOpen?.(),draftCount:Number(uiApi?.getDraftCount?.()||0),activeDraftId:uiApi?.getActiveDraftId?.()||null,accessRole:context.accessRole};}
  });
}

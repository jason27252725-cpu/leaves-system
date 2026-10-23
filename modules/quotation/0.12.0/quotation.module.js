import{createQuotationTools}from './quotation.assistant.js';
import { createQuotationEngine } from './quotation.engine.js';
import { createWorkbookBridge } from './quotation.workbook.js';
import { createCostMasterClient } from './quotation.cost.js';
import { createCostAnalysis } from './quotation.cost-analysis.js';
import { createCostAnalysisUI } from './quotation.cost-ui.js';
import { createCostRevisionClient } from './quotation.revision.js';
import { createQuotationWorkspace } from './quotation.workspace.js';
import { mountQuotationCapability, unmountQuotationInspector, unmountCostMasterConsole, disposeQuotationCapability } from './quotation.ui.js';

export async function registerLeavesModule(context) {
  const engine=createQuotationEngine();
  const workbook=createWorkbookBridge();
  const cost=createCostMasterClient(context);
  const revision=createCostRevisionClient(context);
  const workspace=createQuotationWorkspace({context,engine,workbook,cost});
  const costAnalysis=createCostAnalysis({context,workspace,workbook,cost});
  const costAnalysisUI=createCostAnalysisUI({context,analysis:costAnalysis,workspace});
  workspace.setCostAnalysisOpener?.(()=>costAnalysisUI.open());
  const assistantTools=createQuotationTools({context,workspace,workbook});
  const registeredTools={...assistantTools,resolveIssue:ref=>String(ref).startsWith('leaves-cost-')?costAnalysisUI.resolveRef(ref):assistantTools.resolveIssue(ref),handleIssueAttachments:(refs,extra)=>costAnalysisUI.handleAttachments(refs,extra)};
  const disposeAssistant=context.assistant?.registerTools?.(registeredTools);
  workspace.setIssueHandler?.((index,dragOnly)=>{try{const ref=assistantTools.issueRef(index);if(!dragOnly)context.assistant?.attachIssue?.(ref);return ref;}catch(e){context.ui?.alert?.(e.message,'報價問題');return null;}});
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
    costAnalysisUI.mount();
    if(!chatDispose&&context.chat?.registerCommandHandler)chatDispose=context.chat.registerCommandHandler(({text})=>costAnalysisUI.handleChatCommand(text)||uiApi?.handleChatCommand?.(text)||null);
    if(!contextDispose&&context.chat?.registerContextProvider)contextDispose=context.chat.registerContextProvider(async({text})=>{
      if(!/(?:報價|估價|工作表|儲存格|單價|複價|項次|工程項目|成本|內部|廠商|毛利|利潤|Cost\s*Master|[A-Z]{1,3}\d+)/i.test(text))return null;const content=workspace.getAiContext?.(text)||'';
      if(!content)return null;
      return {label:'LEAVES Quotation Workbook',priority:90,content};
    });
    context.ui?.markCapabilityReady?.('quote',true);return uiApi;
  };
  const dispose=()=>{costAnalysisUI.dispose();costAnalysis.dispose();disposeAssistant?.();try{chatDispose?.();}catch(_){}chatDispose=null;try{contextDispose?.();}catch(_){}contextDispose=null;try{uiApi?.dispose?.();workspace.dispose?.();}catch(_){}disposeQuotationCapability({cost,revision,context});uiApi=null;context.ui?.markCapabilityReady?.('quote',false);};
  return Object.freeze({
    async onSessionEnd(){dispose();return{ok:true};},
    async open(){context.ui?.openChat?.();ensureMounted();context.ui?.setRailActiveByAction?.('chat');return{ok:true,mode:'seamless-capability',workspace:'export-integrity-hotfix',costMasterMode:context.capabilities?.canManageCostMaster?'revision-ui-enabled':'read-only'};},
    async close(){workspace.close?.();unmountQuotationInspector();unmountCostMasterConsole();context.ui?.setRailActiveByAction?.('chat');},
    async selfTest(){ensureMounted();return selfTest();},
    async openCostMaster(){return ensureMounted().openCostConsole?.();},
    async openCostAnalysis(){ensureMounted();return{ok:costAnalysisUI.open()};},
    async getCurrentCostMaster(){return cost.current();},async listCostItems(options={}){return cost.list(options);},async getCostItem(itemCode,options={}){return cost.item(itemCode,options);},async searchCostItems(query,options={}){return cost.search(query,options);},
    inspectLocal(){return assistantTools.inspectLocal();},
    async listCostRevisionDrafts(options={}){return revision.listDrafts(options);},async getCostRevisionDraft(draftId,options={}){return revision.getDraft(draftId,options);},
    getCostStatus(){return cost.health();},getRevisionStatus(){return revision.health();},getStatus(){return{key:context.moduleKey,version:context.moduleVersion,stage:engine.stage,seamless:true,engine:engine.health(),workbook:workbook.health(),cost:cost.health(),revision:revision.health(),workspace:workspace.getStatus(),inspectorOpen:!!uiApi?.isInspectorOpen?.(),costConsoleOpen:!!uiApi?.isCostConsoleOpen?.(),draftCount:Number(uiApi?.getDraftCount?.()||0),activeDraftId:uiApi?.getActiveDraftId?.()||null,accessRole:context.accessRole};}
  });
}


import {el,table} from '../shared/dom.mjs';
export const quotaNote='金鑰數量不等於獨立額度。OpenRouter 官方次數依帳戶／供應商限制計算，各把數字可能共用，不能相加。官方日界為 UTC（台灣 08:00）；網站上限按台灣午夜計算。';
const time=x=>x?new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚無紀錄';
export function quotaText(provider){return provider?.requests?`${provider.requests.used} 已用 / ${provider.requests.limit} 上限 / ${provider.requests.remaining} 剩餘`:'未知（官方未提供免費次數）';}
export function keyUsageRows(data,edit){return data.keys.map(k=>[
 el('div',{},el('strong',{},k.label),el('p',{},k.enabled?(k.primary?'● 主用 · 新請求使用':'備用 · 未參與派送'):'停用'),el('p',{class:'li-note'},k.local.active?`${k.local.active} 筆處理中`:'目前無處理中請求'),el('details',{},el('summary',{},'識別碼'),el('p',{class:'li-note'},k.id))),
 el('div',{},`新站今日 ${k.local.today} / 累計 ${k.local.total}`,el('p',{class:'li-note'},`舊測試 ${k.legacy.sandbox} / 舊正式 ${k.legacy.stable}（分開）`),el('details',{},el('summary',{},'最近派送'),el('p',{class:'li-note'},time(k.local.lastAt)))),
 el('div',{},quotaText(k.provider),el('p',{class:'li-note'},k.provider.status==='invalid-key'?'金鑰驗證失敗':k.provider.status==='unavailable'?'官方查詢暫時失敗':k.provider.status==='disabled'?'停用，不查詢官方':`查詢：${time(k.provider.checkedAt)}`),el('details',{},el('summary',{},'官方金額紀錄（非次數）'),el('p',{class:'li-note'},`今日 USD ${k.provider.creditsUsedToday??'未知'} / 累計 USD ${k.provider.creditsUsed??'未知'}；歷史金額不代表本站啟用了付費模型。`))),edit(k)
]);}
export function quotaCard(data){
 const p=data.keys.find(k=>k.primary),used=data.site.todayAttempts,cap=data.site.dailyLimit;
 return el('section',{class:'li-card'},el('h3',{},'免費請求與網站額度'),el('div',{class:'li-kpis'},
  el('div',{class:'li-kpi'},'網站今日請求（含重試）',el('strong',{},used)),el('div',{class:'li-kpi'},'網站每日上限',el('strong',{},cap)),el('div',{class:'li-kpi'},'網站今日可再受理',el('strong',{},Math.max(0,cap-used)))),
  el('p',{},'目前主金鑰：'+(p?.label||'未設定')),el('p',{},'官方免費次數：'+quotaText(p?.provider)),el('p',{class:'li-note'},quotaNote),
  el('p',{class:'li-note'},'官方資料最多快取 60 秒；不發送 AI 測試問題、不消耗聊天次數。網站可受理次數不是官方剩餘額度。'),
  el('a',{href:'https://openrouter.ai/docs/api/reference/limits',target:'_blank',rel:'noopener noreferrer'},'查看 OpenRouter 官方額度說明'));
}
export function keyUsageTable(data,edit){return table(['金鑰／調度狀態','派送與歷史次數','官方免費次數（UTC 日）','操作'],keyUsageRows(data,edit));}

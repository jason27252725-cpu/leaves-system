const origin='https://jason27252725-cpu.github.io/leaves-identity-sandbox/';
export function foundationLocation(config){
 const env=config?.environment,url=config?.moduleIndexUrl;
 if(!['sandbox','stable'].includes(env)||typeof url!=='string')throw Error('模組環境設定不符');
 if(env==='sandbox'&&url!==origin+'modules/modules-manifest.json')throw Error('模組索引來源不符');
 if(env==='stable'&&!/^https:\/\/jason27252725-cpu\.github\.io\/leaves-identity-sandbox\/site-releases\/stable\/[a-z0-9][a-z0-9.-]{0,63}\/candidates\/modules\/modules-manifest\.json$/.test(url))throw Error('模組索引來源不符');
 if(new URL(url).href!==url)throw Error('模組索引來源不符');
 return{environment:env,indexUrl:url,baseUrl:new URL('./',url).href};
}
export async function publishedFoundation(fetchImpl=fetch,config=globalThis.window?.LEAVES_IDENTITY_CONFIG){
 const location=foundationLocation(config),url=location.indexUrl,r=await fetchImpl(url,{cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('新版索引尚未可讀');const index=await r.json();if(index.schemaVersion!==1)throw Error('模組索引不相容');
 const result={};for(const key of ['identity','workforce']){
  const m=index.modules?.[key],v=m?.[location.environment+'Version'];if(!v)continue;const d=m.versions?.[v];
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(v)||!d||!/^[a-f0-9]{64}$/.test(d.packageHash)||d.manifest!==`${key}/${v}/module-manifest.json`)throw Error('模組版本登錄不完整');
  result[key]={module:key,version:v,packageHash:d.packageHash,environment:location.environment,apiVersion:1,activation:key==='identity'?'next-login':'safe-point',baseUrl:new URL(`${key}/${v}/`,url).href};
 }return result;
}

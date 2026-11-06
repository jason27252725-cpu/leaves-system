const keys=['quantity','quotation','assistant','identity','workforce'],encoder=new TextEncoder(),decoder=new TextDecoder();
const fail=m=>{throw Error(m);};
const safePath=p=>typeof p==='string'&&p.split('/').every(s=>(s==='.leaves-update.json'||/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s))&&s!=='.'&&s!=='..');
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof b==='string'?encoder.encode(b):b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const decode64=s=>{if(typeof s!=='string'||s.length>12*1048576||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))fail('檔案編碼不符');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
const encode64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const json=x=>JSON.stringify(x,null,2)+'\n';
export function assertStableBaseRoute(current,expected){
 if(current?.environment!=='stable'||!expected||!Number.isSafeInteger(expected.revision)||expected.revision<1||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(expected.releaseId||'')||!/^[a-f0-9]{64}$/.test(expected.manifestHash||'')||current.revision!==expected.revision||current.releaseId!==expected.releaseId||current.manifestHash!==expected.manifestHash)fail('網站版本已變更，請保留模組包並重新匯入核對，尚未上傳');
 return{revision:expected.revision,releaseId:expected.releaseId,manifestHash:expected.manifestHash};
}
export async function buildStableModuleBundle(active,payload){
 const site=structuredClone(active?.site),p=payload?.package,key=p?.module;
 if(site?.environment!=='stable'||site.schema!==1||!Array.isArray(site.files)||site.files.length>128||!Array.isArray(active?.siteFiles))fail('需要已核對的正式完整網站基準');
 const baseRoute=active.baseRoute?assertStableBaseRoute({environment:'stable',revision:active.baseRoute.revision,releaseId:site.releaseId,manifestHash:active.baseRoute.manifestHash},active.baseRoute):null;
 if(baseRoute)site.derivedFrom=structuredClone(baseRoute);
 if(!keys.includes(key)||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(p.version||'')||!Array.isArray(p.files)||p.files.length<1||p.files.length>64||!Array.isArray(payload.files)||payload.files.length!==p.files.length||await hash(JSON.stringify(p))!==payload.packageHash)fail('模組包清單不符');
 if(p.contract?.environment&&p.contract.environment!=='stable'||['identity','workforce'].includes(key)&&p.contract?.environment!=='stable')fail('模組包環境不符');
 const files=new Map(),seen=new Set();let total=0;
 for(const f of active.siteFiles){if(!safePath(f.path)||seen.has(f.path.toLowerCase()))fail('網站檔案路徑重複或不安全');seen.add(f.path.toLowerCase());const b=decode64(f.base64);total+=b.length;if(b.length>8*1048576||total>16*1048576)fail('網站檔案超過上限');files.set(f.path,b);}
 for(const f of site.files){const b=files.get(f.path);if(!safePath(f.path)||!b||b.length!==f.bytes||await hash(b)!==f.sha256)fail('網站基準檔案校驗失敗');}
 const read=path=>{const b=files.get(path);if(!b)fail('網站基準缺檔：'+path);return decoder.decode(b);};
 const index=JSON.parse(read('candidates/modules/modules-manifest.json')),oldVersion=index.modules?.[key]?.stableVersion;
 if(!oldVersion)fail('網站基準缺少目前模組版本');
 if(index.modules[key].versions?.[p.version]?.packageHash&&index.modules[key].versions[p.version].packageHash!==payload.packageHash)fail('同版號安裝包內容不同，請提升版本');
 const prefix=`candidates/modules/${key}/${p.version}/`,packageSeen=new Set();let packageBytes=0;
 for(const f of p.files){if(!safePath(f.path)||packageSeen.has(f.path.toLowerCase()))fail('模組檔案路徑不符');packageSeen.add(f.path.toLowerCase());const entries=payload.files.filter(x=>x.path===f.path);if(entries.length!==1)fail('模組缺檔或重複');const b=decode64(entries[0].base64);packageBytes+=b.length;if(b.length!==f.bytes||b.length>8*1048576||packageBytes>12*1048576||await hash(b)!==f.sha256)fail('模組檔案校驗失敗');const old=files.get(prefix+f.path);if(old&&await hash(old)!==f.sha256)fail('同版號檔案已存在且內容不同，請提升版本');files.set(prefix+f.path,b);}
 const manifest=JSON.parse(read(prefix+'module-manifest.json'));if(manifest.key!==key||manifest.version!==p.version)fail('模組資訊與安裝包不符');
 for(const dep of p.dependencies||[]){if(!keys.includes(dep.module)||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(dep.version||'')||![...files.keys()].some(x=>x.startsWith(`candidates/modules/${dep.module}/${dep.version}/`)))fail('網站缺少模組相依版本');}
 const oldReceipt=`candidates/modules/${key}/${oldVersion}/.leaves-update.json`;files.delete(oldReceipt);files.set(prefix+'.leaves-update.json',encoder.encode(json({schemaVersion:1,package:p,packageHash:payload.packageHash})));
 const item=index.modules[key];item.stableVersion=p.version;item.versions={...item.versions,[p.version]:{manifest:`${key}/${p.version}/module-manifest.json`,status:'stable',packageHash:payload.packageHash}};
 files.set('candidates/modules/modules-manifest.json',encoder.encode(json(index)));
 if(['identity','workforce'].includes(key)){
  if(!site.foundationRuntime?.modules?.[key])fail('網站缺少基本模組基準');site.foundationRuntime.modules[key]={version:p.version,packageHash:payload.packageHash};
  const catalog='export const bundledModules=Object.freeze({\n'+['identity','workforce'].map(k=>{const d=site.foundationRuntime.modules[k];return k+':{...'+JSON.stringify({module:k,...d,environment:'stable',apiVersion:1,activation:k==='identity'?'next-login':'safe-point',...(k==='identity'?{handoverVersion:1}:{lifecycleVersion:1})})+",load:()=>"+'im'+"port('../../../candidates/modules/"+k+'/'+d.version+"/entry.mjs')},";}).join('\n')+'\n});\n';files.set('src/modules/runtime/bundled-modules.mjs',encoder.encode(catalog));
 }
 const baseHash=await hash(JSON.stringify({site:active.site,baseRoute}));site.releaseId='mod-'+key+'-'+p.version.toLowerCase().replace(/[^a-z0-9.-]/g,'-').slice(0,18)+'-'+payload.packageHash.slice(0,10)+'-'+baseHash.slice(0,8);
 const raw=read('src/identity-config.js').match(/Object\.freeze\((\{[^\n]+\})\)/)?.[1];let config;try{config=JSON.parse(raw);}catch{fail('正式網站連線設定無法核對');}
 if(config.environment!=='stable'||config.endpoint!=='https://dadlmrmzupmmzthlvrmo.supabase.co/functions/v1/leaves-identity-gateway')fail('正式網站連線環境不符');
 config.moduleIndexUrl='https://jason27252725-cpu.github.io/leaves-system/site-releases/stable/'+site.releaseId+'/candidates/modules/modules-manifest.json';files.set('src/identity-config.js',encoder.encode('window.LEAVES_IDENTITY_CONFIG=Object.freeze('+JSON.stringify(config)+');\n'));
 site.files=[];total=0;for(const[path,b]of [...files].sort(([a],[b])=>a.localeCompare(b))){total+=b.length;if(total>16*1048576)fail('新網站超過檔案總量上限');if(!path.endsWith('/.leaves-update.json'))site.files.push({path,bytes:b.length,sha256:await hash(b)});}if(site.files.length>128)fail('新網站檔案超過上限，請改用完整網站更新包');
 const siteFiles=[...files].map(([path,b])=>({path,base64:encode64(b)})),packages=[];
 for(const k of keys){const v=index.modules?.[k]?.stableVersion,r=JSON.parse(read(`candidates/modules/${k}/${v}/.leaves-update.json`));if(r.packageHash!==index.modules[k].versions?.[v]?.packageHash||await hash(JSON.stringify(r.package))!==r.packageHash)fail('網站其他模組收據不符');packages.push({...r,files:r.package.files.map(f=>({path:f.path,base64:encode64(files.get(`candidates/modules/${k}/${v}/${f.path}`)||fail('網站模組缺檔'))}))});}
 return{site,siteFiles,packages,...(baseRoute?{baseRoute}:{} )};
}

export async function fetchStableBaseline(route,{fetchImpl=fetch}={}){
 if(route?.environment!=='stable'||!Number.isSafeInteger(route.revision)||route.revision<1||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(route.releaseId||'')||route.entry!==`site-releases/stable/${route.releaseId}/candidates/core/index.html`||!/^[a-f0-9]{64}$/.test(route.manifestHash||''))fail('尚無已核對的正式版版本，請先上傳完整網站包');
 const base='https://jason27252725-cpu.github.io/leaves-system/site-releases/stable/'+route.releaseId+'/';let total=0;
 async function get(path,limit=8*1048576){if(!safePath(path))fail('網站基準路徑不符');const r=await fetchImpl(base+path,{cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)fail('網站基準尚未可讀');const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;total+=value.length;if(size>limit||total>16*1048576){await reader.cancel();fail('網站基準超過大小上限');}chunks.push(value);}}finally{reader.releaseLock();}const b=new Uint8Array(size);let at=0;for(const c of chunks){b.set(c,at);at+=c.length;}return b;}
 const m=await get('site-manifest.json',262144);if(await hash(m)!==route.manifestHash)fail('網站基準清單已改變');const site=JSON.parse(decoder.decode(m));if(site.environment!=='stable'||site.releaseId!==route.releaseId||site.entry!=='candidates/core/index.html'||!Array.isArray(site.files)||site.files.length<1||site.files.length>128)fail('網站基準清單不符');
 const files=new Map();let cursor=0;const reads=await Promise.allSettled(Array.from({length:4},async()=>{while(cursor<site.files.length){const f=site.files[cursor++];if(!safePath(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>8*1048576)fail('網站基準檔案不符');const b=await get(f.path,f.bytes);if(b.length!==f.bytes||await hash(b)!==f.sha256)fail('網站基準檔案校驗失敗');if(files.has(f.path))fail('網站基準檔案重複');files.set(f.path,b);}}));for(const r of reads)if(r.status==='rejected')throw r.reason;
 const index=JSON.parse(decoder.decode(files.get('candidates/modules/modules-manifest.json')));for(const key of keys){const v=index.modules?.[key]?.stableVersion;if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(v||''))fail('網站基準模組不符');const path=`candidates/modules/${key}/${v}/.leaves-update.json`;files.set(path,await get(path,262144));}
 return{site,siteFiles:[...files].map(([path,b])=>({path,base64:encode64(b)})),baseRoute:{revision:route.revision,releaseId:route.releaseId,manifestHash:route.manifestHash}};
}

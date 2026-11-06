import {sha256} from './updates.mjs';
import {foundationLocation} from './published-foundation.mjs';
const cache=new Map();
export async function loadFoundation(d,fetchImpl=fetch,importImpl=url=>import(url),config=globalThis.window?.LEAVES_IDENTITY_CONFIG){
 if(d.load)return d.load();
 const location=foundationLocation(config);
 if(!['identity','workforce'].includes(d.module)||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(d.version)||d.environment!==location.environment||d.baseUrl!==new URL(`${d.module}/${d.version}/`,location.baseUrl).href)throw Error('模組來源不符');
 const key=location.environment+':'+d.baseUrl+':'+d.module+':'+d.version+':'+d.packageHash;if(cache.has(key))return cache.get(key);
 const get=async path=>{const r=await fetchImpl(new URL(path,d.baseUrl),{cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('新版模組檔案尚未可讀');return new Uint8Array(await r.arrayBuffer());};
 const receipt=JSON.parse(new TextDecoder().decode(await get('.leaves-update.json'))),p=receipt.package;
 if(receipt.packageHash!==d.packageHash||await sha256(JSON.stringify(p))!==d.packageHash||p.module!==d.module||p.version!==d.version||p.schemaVersion!==2||p.contract?.environment!==location.environment||p.contract.apiVersion!==1||p.contract.activation!==d.activation||p.contract.maxCoreVersion!=='v29.0.0'||p.minCoreVersion!=='v29.0.0'||!Array.isArray(p.files)||!p.files.length||p.files.length>64)throw Error('新版模組內容或相容性不符，保留目前版本');
 let total=0;const seen=new Set();for(const f of p.files){if(!f.path?.split('/').every(s=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s)&&s!=='.'&&s!=='..')||seen.has(f.path)||f.bytes>8*1048576)throw Error('模組檔案清單無效');seen.add(f.path);const bytes=await get(f.path);total+=bytes.length;if(total>12*1048576||bytes.length!==f.bytes||await sha256(bytes)!==f.sha256)throw Error('新版模組檔案校驗失敗');}
 if(!seen.has('entry.mjs'))throw Error('缺少模組入口');const m=await importImpl(new URL('entry.mjs',d.baseUrl).href);if(m.moduleInfo?.version!==d.version||m.moduleInfo.module!==d.module||m.moduleInfo.activation!==d.activation||typeof m.mount!=='function')throw Error('模組接手介面不符');cache.set(key,m);return m;
}

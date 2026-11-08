import {assertStableBaseRoute} from './stable-module-bundle.mjs';
import {inspectPackage} from './updates.mjs';
const enc=new TextEncoder(),dec=new TextDecoder(),keys=['quantity','quotation','assistant','identity','workforce'];
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const base64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const safePath=p=>typeof p==='string'&&p.split('/').every(s=>(s==='.leaves-update.json'||/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s))&&s!=='.'&&s!=='..');
export async function coreRuntimeHash(inventory){
 const contract=inventory.filter(f=>f.path.startsWith('src/')&&!['src/identity-config.js','src/modules/runtime/production-handoff.mjs','src/modules/runtime/bundled-modules.mjs','src/modules/runtime/promotion-package.json'].includes(f.path)).map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return hash(enc.encode(JSON.stringify(contract)));
}
export async function buildCoreHtmlBundle(active,html){
 const content=enc.encode(html);if(content.length<100||content.length>8*1048576)throw Error('HTML 大小不符');
 if(!/<!doctype html/i.test(html)||!/<html\b/i.test(html)||!/const BUILD_CHANNEL\s*=\s*'stable'/.test(html)||!html.includes('window.leavesIdentityReady')||!html.includes('../../src/identity-config.js'))throw Error('請使用新版正式版 HTML；舊獨立 HTML 尚未包含新版登入與模組接入');
 if(!/const BUILD_VERSION\s*=\s*'v29\.0\.0'/.test(html))throw Error('此基準僅支援 Core v29.0.0，跨 Core 版本請使用完整更新包');
 const site=structuredClone(active?.site);if(site?.schema!==1||site.environment!=='stable'||!Array.isArray(site.files)||site.files.length<1||site.files.length>128||!Array.isArray(active.siteFiles)||active.siteFiles.length>133)throw Error('網站基準清單不符');
 const baseRoute=assertStableBaseRoute({environment:site.environment,revision:active.baseRoute?.revision,releaseId:site.releaseId,manifestHash:active.baseRoute?.manifestHash},active.baseRoute);
 const files=new Map(),seen=new Set();let total=0;
 for(const f of active.siteFiles){if(!safePath(f.path)||seen.has(f.path.toLowerCase())||typeof f.base64!=='string'||f.base64.length>12*1048576)throw Error('網站基準路徑重複或不安全');seen.add(f.path.toLowerCase());const b=bytes(f.base64);total+=b.length;if(b.length>8*1048576||total>16*1048576)throw Error('網站基準超過大小上限');files.set(f.path,b);}
 const expected=new Set();for(const f of site.files){const b=files.get(f.path);if(!safePath(f.path)||expected.has(f.path.toLowerCase())||!b||b.length!==f.bytes||await hash(b)!==f.sha256)throw Error('網站基準完整性核對失敗');expected.add(f.path.toLowerCase());}
 const runtime=await coreRuntimeHash(site.files),marker=html.match(/<meta name="leaves-core-runtime" content="([a-f0-9]{64})">/);
 if(marker?.[1]!==runtime)throw Error('HTML 與現行共用程式不相容，請使用完整更新包');
 const index=JSON.parse(dec.decode(files.get('candidates/modules/modules-manifest.json'))),packages=[],receipts=new Set();
 for(const key of keys){const item=index.modules?.[key],v=item?.stableVersion;if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(v||''))throw Error('基準模組版本不符');const prefix=`candidates/modules/${key}/${v}/`,path=prefix+'.leaves-update.json',receipt=JSON.parse(dec.decode(files.get(path)));receipts.add(path);if(receipt.package?.module!==key||receipt.package.version!==v||receipt.packageHash!==item.versions?.[v]?.packageHash||item.versions[v].manifest!==`${key}/${v}/module-manifest.json`)throw Error('基準模組收據不符');const payload={...receipt,files:receipt.package.files.map(f=>{const b=files.get(prefix+f.path);if(!b||!expected.has((prefix+f.path).toLowerCase()))throw Error('基準模組缺檔');return{path:f.path,base64:base64(b)};})};await inspectPackage(payload,key);packages.push(payload);}
 for(const path of files.keys())if(!expected.has(path.toLowerCase())&&!receipts.has(path))throw Error('網站基準含未登錄檔案');
 site.releaseId='core-'+(await hash(content)).slice(0,16)+'-'+(await hash(enc.encode(JSON.stringify(baseRoute)))).slice(0,10);site.derivedFrom=baseRoute;
 files.set('candidates/core/index.html',content);
 const configPath='src/identity-config.js',text=dec.decode(files.get(configPath));
 files.set(configPath,enc.encode(text.replaceAll('/'+active.site.releaseId+'/', '/'+site.releaseId+'/')));
 const handoff='src/modules/runtime/production-handoff.mjs';if(files.has(handoff))files.set(handoff,enc.encode(dec.decode(files.get(handoff)).replaceAll('/'+active.site.releaseId+'/', '/'+site.releaseId+'/')));
 const ordered=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0);site.files=[];total=0;for(const [path,b]of ordered){total+=b.length;if(total>16*1048576)throw Error('新網站超過大小上限');if(!receipts.has(path))site.files.push({path,bytes:b.length,sha256:await hash(b)});}
 return{site,baseRoute,siteFiles:ordered.map(([path,b])=>({path,base64:base64(b)})),packages};
}

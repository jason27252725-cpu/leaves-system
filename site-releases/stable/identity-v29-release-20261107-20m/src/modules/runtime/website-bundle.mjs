const enc=new TextEncoder();
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function inspectWebsiteHtml(file,onProgress=()=>{}){
 if(!/\.html$/i.test(file.name)||file.size>48*1048576)throw Error('請選擇 48 MB 以內的整站 HTML 更新檔');
 const html=await file.text(),matches=[...html.matchAll(/<script type="application\/json" id="leaves-website-update">([\s\S]*?)<\/script>/g)];
 if(matches.length!==1)throw Error('這不是完整網站更新 HTML；請使用本次提供的整站更新檔');
 const data=JSON.parse(matches[0][1]);if(data.schema!==1||data.coreVersion!=='v29.0.0'||!data.bundles)throw Error('更新檔版本不符');
 let checked=0,total=Object.values(data.bundles).reduce((n,b)=>n+(b?.files?.length||0),0);
 for(const environment of ['sandbox','stable']){
  const b=data.bundles[environment],m=b?.manifest;if(m?.environment!==environment||!Array.isArray(m.files)||m.files.length<5||m.files.length>128||!Array.isArray(b.files)||b.files.length>133||b.files.length<m.files.length||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(m.releaseId||''))throw Error('缺少完整沙盒或正式版檔案');
  const expected=new Map(m.files.map(f=>[f.path,f])),seen=new Set();let bytes=0;if(expected.size!==m.files.length)throw Error('更新清單路徑重複');
  for(const f of b.files){
   if(typeof f.path!=='string'||!f.path.split('/').every(s=>s==='.leaves-update.json'||/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s))||seen.has(f.path.toLowerCase())||typeof f.base64!=='string'||f.base64.length>12*1048576)throw Error('更新檔案路徑不符');
   seen.add(f.path.toLowerCase());const raw=Uint8Array.from(atob(f.base64),x=>x.charCodeAt(0));bytes+=raw.length;if(bytes>16*1048576||raw.length>8*1048576)throw Error('更新檔案超出大小上限');
   const target=expected.get(f.path);if(target&&(target.bytes!==raw.length||target.sha256!==await hash(raw)))throw Error('檔案校驗失敗：'+f.path);
   if(!target&&!/^candidates\/modules\/(identity|workforce|quantity|quotation|assistant)\/[^/]+\/\.leaves-update\.json$/.test(f.path))throw Error('更新檔含未登錄內容');onProgress(++checked/total);
  }
  if(m.files.some(f=>!seen.has(f.path.toLowerCase())))throw Error('更新檔缺少必要程式');
 }
 return {...data,fileHash:await hash(enc.encode(html))};
}

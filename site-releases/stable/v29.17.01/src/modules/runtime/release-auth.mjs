const releaseAuthorizationMinutes = 20;
export function releaseAuthorizationDeadline() {
 return Date.now() + releaseAuthorizationMinutes * 60_000;
}
export function releaseAuthorizationExpired(deadline) {
 return Date.now() >= deadline;
}
export function releaseAuthorizationMessage(deadline) {
 const time = new Date(deadline).toLocaleTimeString('zh-TW', {timeZone:'Asia/Taipei',hour12:false});
 return '身分已驗證，有效 ' + releaseAuthorizationMinutes + ' 分鐘，到期時間（台灣）' + time;
}

// Client-side confirmation only; the release service still enforces every operation.
export async function reauthenticateOwner({client,epoch,createClient,code}){
 const before=client.snapshot()?.person,at=epoch();
 const owner=p=>p?.role==='owner'&&!!p.permissions?.['technical.release'];
 if(!owner(before))throw Error('請使用目前登入的最高管理員通行碼');
 const probe=createClient();let verified=false;
 try{const result=await probe.login(code,'發布前身分驗證');const p=result.person;
  if(!owner(p)||p.employeeId!==before.employeeId||p.environment!==before.environment||p.revision!==before.revision)throw Error('請使用目前登入的最高管理員通行碼；權限變更後請重新登入');
  verified=true;
 }finally{await probe.logout();}
 const current=client.snapshot()?.person;
 if(!verified||epoch()!==at||!owner(current)||current.employeeId!==before.employeeId||current.revision!==before.revision)throw Error('登入或發布權限已變更，請重新驗證');
 return true;
}

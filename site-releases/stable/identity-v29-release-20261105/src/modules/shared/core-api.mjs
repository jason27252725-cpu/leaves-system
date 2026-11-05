let instance=null;
export function installCoreApi(api){if(instance)throw Error('Core API already installed');instance=Object.freeze(api);return instance;}
export function getCoreApi(){if(!instance)throw Error('Core 尚未就緒');return instance;}

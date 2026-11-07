import {publishedFoundation} from './published-foundation.mjs';
export async function checkFoundationUpdates(switches){const descriptors=await publishedFoundation();const changed=[];for(const[k,d]of Object.entries(descriptors))if(switches.offer(k,d))changed.push(k);return changed;}

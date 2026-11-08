// LEAVES Quantity 2.0.0-alpha.2 — pure, independently testable lifecycle helpers.
export const PHASE_RANGES=Object.freeze({read:[0,12],parse:[12,65],quantity:[65,91],'wasm-load':[12,18],'wasm-parse':[18,92],'wasm-transfer':[92,97]});
export function normalizeProgressPercent(value){
  // null/undefined/blank means "unknown"; Number(null) === 0 must NOT be mistaken for true progress.
  if(value==null || typeof value==='boolean' || (typeof value==='string'&&!value.trim()))return null;
  const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):null;
}
export function stageProgress(phase,percent){
  const normalized=normalizeProgressPercent(percent);const range=PHASE_RANGES[phase]||[0,97];
  return {known:normalized!==null,displayPercent:normalized===null?null:Math.round(range[0]+(range[1]-range[0])*normalized/100),phase,phasePercent:normalized};
}
export function chooseTransferBuffer(data,heapBuffer){
  // Reuse a standalone transferable full ArrayBuffer when possible; NEVER try to transfer a WASM heap buffer.
  if(!(data instanceof Uint8Array))throw new TypeError('Expected Uint8Array GLB data');
  if(data.buffer instanceof ArrayBuffer && data.buffer!==heapBuffer && data.byteOffset===0 && data.byteLength===data.buffer.byteLength)return {bytes:data,copied:false};
  const copy=new Uint8Array(data.byteLength);copy.set(data);return {bytes:copy,copied:true};
}
export function largeFileRisk(fileBytes,deviceMemoryGb){
  const mb=Number(fileBytes||0)/1048576;const mem=Number(deviceMemoryGb||0);
  const level=mb>=400?'extreme':mb>=96?'large':'normal';
  return {level,unknownDeviceMemory:!(mem>0),resourceWarning:level==='extreme'||(mem>0&&mem<=8&&mb>=96)};
}

export const QUANTITY_VIEWER_VERSION = '0.1.0';

const THREE_URL='https://cdn.jsdelivr.net/npm/three@0.186.0/+esm';
const ORBIT_URL='https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/controls/OrbitControls.js/+esm';
let threePromise=null;
async function loadThree(){
  if(!threePromise)threePromise=Promise.all([import(THREE_URL),import(ORBIT_URL)]).then(([THREE,orbit])=>({THREE,OrbitControls:orbit.OrbitControls}));
  return threePromise;
}

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

export async function createQuantityViewer(container,{onSelect=null,onReady=null}={}){
  if(!container)throw new Error('3D viewport container missing');
  const {THREE,OrbitControls}=await loadThree();
  let disposed=false,renderPending=false,selected=null,boxHelper=null,modelRoot=null,grid=null;
  const geometries=new Set(),materials=new Set(),renderMaterialMeta=new Map(),highlightable=new Map();

  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b0c0e);
  const camera=new THREE.PerspectiveCamera(42,1,0.01,5000);camera.position.set(6,4.5,6);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x0b0c0e,1);
  renderer.domElement.className='quantity-webgl-canvas';container.replaceChildren(renderer.domElement);
  renderer.domElement.style.touchAction='none';
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.screenSpacePanning=true;controls.maxPolarAngle=Math.PI;controls.addEventListener('change',requestRender);
  scene.add(new THREE.HemisphereLight(0xffffff,0x22242a,1.35));const sun=new THREE.DirectionalLight(0xffffff,1.15);sun.position.set(8,12,9);scene.add(sun);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();

  function requestRender(){if(disposed||renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;if(!disposed)renderer.render(scene,camera);});}
  function resize(){if(disposed)return;const r=container.getBoundingClientRect();const w=Math.max(10,Math.floor(r.width)),h=Math.max(10,Math.floor(r.height));if(renderer.domElement.width!==Math.floor(w*renderer.getPixelRatio())||renderer.domElement.height!==Math.floor(h*renderer.getPixelRatio()))renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();requestRender();}
  const ro=new ResizeObserver(resize);ro.observe(container);

  function disposeModel(){
    if(boxHelper){scene.remove(boxHelper);boxHelper.geometry?.dispose?.();boxHelper.material?.dispose?.();boxHelper=null;}
    if(modelRoot){scene.remove(modelRoot);modelRoot=null;}
    if(grid){scene.remove(grid);grid.geometry?.dispose?.();grid.material?.dispose?.();grid=null;}
    for(const g of geometries)g.dispose?.();geometries.clear();for(const m of materials)m.dispose?.();materials.clear();renderMaterialMeta.clear();highlightable.clear();selected=null;
  }

  function makeMaterial(meta){
    const c=meta?.color||[.55,.55,.55,1];const alpha=clamp(Number(c[3]??1),.05,1);
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(clamp(c[0],0,1),clamp(c[1],0,1),clamp(c[2],0,1)),roughness:.78,metalness:.02,transparent:alpha<.995,opacity:alpha,side:meta?.doubleSided?THREE.DoubleSide:THREE.FrontSide});
    m.userData={baseOpacity:alpha,baseTransparent:alpha<.995,mappedName:String(meta?.mappedName||'')};materials.add(m);return m;
  }

  function buildResourceTemplates(render){
    const materialObjs=(render.materials||[]).map(meta=>{const m=makeMaterial(meta);renderMaterialMeta.set(Number(meta.index),{...meta,material:m});if(meta.mappedName){if(!highlightable.has(meta.mappedName))highlightable.set(meta.mappedName,new Set());highlightable.get(meta.mappedName).add(m);}return m;});
    const resources=new Map();
    for(const resource of render.resources||[]){
      const parts=[];
      for(const prim of resource.primitives||[]){
        const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(prim.positions,3));if(prim.normals?.length)geo.setAttribute('normal',new THREE.BufferAttribute(prim.normals,3));else geo.computeVertexNormals();geo.setIndex(new THREE.BufferAttribute(prim.indices,1));geo.computeBoundingBox();geometries.add(geo);
        parts.push({geometry:geo,material:materialObjs[prim.materialIndex]||materialObjs[0]||makeMaterial({color:[.5,.5,.5,1]}),materialIndex:prim.materialIndex});
      }
      resources.set(resource.id,{definitionName:resource.definitionName,parts});
    }
    return resources;
  }

  function nodeGroup(node,resources,path='ROOT'){
    const group=new THREE.Group();const nodeName=String(node?.name||node?.definitionName||'Component');const nodePath=path==='ROOT'?nodeName:`${path} / ${nodeName}`;
    if(Array.isArray(node?.matrix)&&node.matrix.length===16){group.matrix.fromArray(node.matrix);group.matrixAutoUpdate=false;}
    const res=node?.meshResourceId?resources.get(node.meshResourceId):null;
    if(res){for(const part of res.parts){const mesh=new THREE.Mesh(part.geometry,part.material);const meta=renderMaterialMeta.get(Number(part.materialIndex))||{};mesh.userData={isQuantityMesh:true,nodeName,definitionName:String(node?.definitionName||res.definitionName||''),layer:String(node?.layer||''),positionMm:Array.isArray(node?.positionMm)?node.positionMm:[0,0,0],path:nodePath,materialName:String(meta.mappedName||''),materialConfidence:String(meta.confidence||'none'),materialCandidates:Array.isArray(meta.candidates)?meta.candidates:[]};group.add(mesh);}}
    for(const child of node?.children||[])group.add(nodeGroup(child,resources,nodePath));
    return group;
  }

  function fit(bounds){
    let box;if(bounds?.min&&bounds?.max){box=new THREE.Box3(new THREE.Vector3(...bounds.min),new THREE.Vector3(...bounds.max));}else if(modelRoot){box=new THREE.Box3().setFromObject(modelRoot);}if(!box||box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),maxDim=Math.max(size.x,size.y,size.z,.1);const fov=camera.fov*Math.PI/180;let distance=(maxDim/2)/Math.tan(fov/2);distance*=1.55;
    camera.near=Math.max(.005,maxDim/5000);camera.far=Math.max(100,distance*25);camera.updateProjectionMatrix();camera.position.set(center.x+distance*.7,center.y+distance*.55,center.z+distance*.7);controls.target.copy(center);controls.minDistance=Math.max(.01,maxDim*.01);controls.maxDistance=Math.max(20,maxDim*15);controls.update();
    if(grid){scene.remove(grid);grid.geometry?.dispose?.();grid.material?.dispose?.();}
    const gridSize=Math.max(2,Math.ceil(maxDim*1.4));grid=new THREE.GridHelper(gridSize,Math.min(40,Math.max(10,Math.round(gridSize))),0x343940,0x1a1d21);grid.position.y=box.min.y-.002;scene.add(grid);requestRender();
  }

  function load(render){
    disposeModel();const resources=buildResourceTemplates(render||{});modelRoot=nodeGroup(render?.hierarchy||{name:'ROOT',children:[]},resources);scene.add(modelRoot);fit(render?.bounds);onReady?.({highlightableMaterials:[...highlightable.keys()]});requestRender();
  }

  function resetMaterialFilter(){for(const m of materials){const base=Number(m.userData?.baseOpacity??1);m.opacity=base;m.transparent=!!m.userData?.baseTransparent;m.depthWrite=true;m.needsUpdate=true;}requestRender();}
  function focusMaterial(name){
    const target=String(name||'');if(!target){resetMaterialFilter();return false;}let found=false;
    for(const m of materials){const match=String(m.userData?.mappedName||'')===target;if(match)found=true;const base=Number(m.userData?.baseOpacity??1);m.opacity=match?Math.max(base,.92):Math.min(base,.055);m.transparent=!match||base<.995;m.depthWrite=match;m.needsUpdate=true;}
    requestRender();return found;
  }

  function clearSelection(){selected=null;if(boxHelper){scene.remove(boxHelper);boxHelper.geometry?.dispose?.();boxHelper.material?.dispose?.();boxHelper=null;}onSelect?.(null);requestRender();}
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down)return;const dx=Math.abs(e.clientX-down.x),dy=Math.abs(e.clientY-down.y);down=null;if(dx>4||dy>4)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObject(modelRoot||scene,true);const hit=hits.find(h=>h.object?.userData?.isQuantityMesh);if(!hit){clearSelection();return;}selected=hit.object;if(boxHelper){scene.remove(boxHelper);boxHelper.geometry?.dispose?.();boxHelper.material?.dispose?.();}boxHelper=new THREE.BoxHelper(selected,0x67e8f9);boxHelper.material.depthTest=false;boxHelper.material.transparent=true;boxHelper.material.opacity=.82;scene.add(boxHelper);onSelect?.({...selected.userData});requestRender();
  });

  resize();requestRender();
  return Object.freeze({
    load,fit:()=>fit(null),focusMaterial,resetMaterialFilter,clearSelection,
    getHighlightableMaterials:()=>[...highlightable.keys()],
    dispose(){if(disposed)return;disposed=true;ro.disconnect();controls.dispose();disposeModel();renderer.dispose();renderer.forceContextLoss?.();container.replaceChildren();}
  });
}

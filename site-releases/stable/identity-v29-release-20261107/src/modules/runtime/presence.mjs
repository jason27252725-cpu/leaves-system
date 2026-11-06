// Reuses session refresh; no websocket, pointer tracking, or per-second writes.
export function startPresence({refresh,leave,isLoggedIn,document,window,setTimer=setTimeout,clearTimer=clearTimeout}){
 let stopped=false,timer=null,busy=false,lastSignal=-Infinity;
 const schedule=()=>{clearTimer(timer);if(!stopped)timer=setTimer(tick,document.hidden?180000:45000);};
 const tick=async()=>{if(stopped||busy)return;schedule();if(!isLoggedIn())return;busy=true;try{await refresh({visible:!document.hidden});}catch{}finally{busy=false;}};
 const visibility=()=>{if(Date.now()-lastSignal<1000)return;lastSignal=Date.now();tick();};
 const hide=()=>{leave?.();clearTimer(timer);};
 document.addEventListener('visibilitychange',visibility);window.addEventListener('online',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',visibility);schedule();
 return()=>{stopped=true;clearTimer(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',visibility);};
}

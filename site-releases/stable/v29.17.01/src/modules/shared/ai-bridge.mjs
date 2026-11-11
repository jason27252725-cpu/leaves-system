// Adapt the authenticated JSON result to Core's existing chat reader.
export function completionResponse(result){
 if(result?.ok!==true||typeof result.text!=='string'||!result.text.trim())throw Object.assign(Error('AI_INVALID_RESPONSE'),{code:'AI_INVALID_RESPONSE'});
 const chunk={choices:[{index:0,delta:{content:result.text},finish_reason:null}],model:result.model};
 const finish={choices:[{index:0,delta:{},finish_reason:'stop'}],usage:result.usage||{}};
 return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify(finish)+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream','X-Leaves-Provider':'openrouter','X-Leaves-Model':result.model||''}});
}

// Preview consent lives in a trusted extension frame, never on the HN page.
if(window.parent!==window)document.body.classList.add("embedded");
const previewEnabled=document.querySelector("#previews-enabled");
const previewStatus=document.querySelector("#previews-status");
const send=payload=>new Promise(resolve=>{
  chrome.runtime.sendMessage(payload,response=>{
    if(chrome.runtime.lastError)return resolve({ok:false});
    resolve(response||{ok:false});
  });
});
previewEnabled.disabled=true;
send({type:"HARMONOVA_NETWORK_POLICY_GET"}).then(result=>{
  if(result?.ok)previewEnabled.checked=result.policy.externalPreviewsEnabled===true;
  else previewStatus.textContent="Could not load preview setting.";
  previewEnabled.disabled=false;
}).catch(()=>{previewStatus.textContent="Could not load preview setting.";previewEnabled.disabled=false;});
previewEnabled.addEventListener("change",async event=>{
  if(!event.isTrusted)return;
  previewEnabled.disabled=true;
  try {
    const result=await send({type:"HARMONOVA_NETWORK_POLICY_SAVE",policy:{version:1,externalPreviewsEnabled:previewEnabled.checked}});
    if(!result?.ok){
      previewEnabled.checked=!previewEnabled.checked;
      previewStatus.textContent="Could not update previews. Try again.";
    }else previewStatus.textContent=previewEnabled.checked?"Previews enabled.":"Previews disabled.";
  }catch{
    previewEnabled.checked=!previewEnabled.checked;
    previewStatus.textContent="Could not update previews. Try again.";
  }finally{previewEnabled.disabled=false;}
});

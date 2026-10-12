// Non-modal release hint, only after a trusted worker confirms a newer version.
(() => {
  'use strict';
  const RELEASES='https://github.com/chaosmanage/harmonova/releases/latest';
  function create({app,settings,saveSettings,el}) {
    const valid=tag=>typeof tag==='string' && /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(tag);
    const send=message=>new Promise(resolve=>
      chrome.runtime.sendMessage(message,response=>resolve(chrome.runtime.lastError?null:response)));
    async function ignore(tag) {
      await send({type:'HARMONOVA_RELEASE_IGNORE',tag});
      document.querySelector('.harmonova-release-notice')?.remove();
    }
    function show(tag) {
      if(!valid(tag)||settings.notifyUpdates===false||!app?.isConnected)return;
      if(document.querySelector('.harmonova-release-notice'))return;
      const notice=el('aside','harmonova-release-notice');
      notice.setAttribute('role','status');
      notice.setAttribute('aria-label','HarmoNova update available');
      const title=el('strong','', 'New HarmoNova release '+tag);
      const description=el('p','', 'An update is available on GitHub. You can download it whenever you like.');
      const buttons=el('div','harmonova-release-actions');
      const download=el('button','', 'Download update');
      download.type='button';
      download.addEventListener('click',()=>{
        window.open(RELEASES,'_blank','noopener,noreferrer');
        void ignore(tag);
      });
      const dismiss=el('button','', 'Ignore this version');
      dismiss.type='button';
      dismiss.addEventListener('click',()=>{void ignore(tag);});
      const optOut=el('button','harmonova-release-optout', "Don't notify me again");
      optOut.type='button';
      optOut.addEventListener('click',async()=>{
        settings.notifyUpdates=false;
        const saved=await saveSettings('notifyUpdates');
        if(!saved)settings.notifyUpdates=true;
        else notice.remove();
      });
      buttons.append(download,dismiss);
      notice.append(title,description,buttons,optOut);
      app.appendChild(notice);
    }
    function refresh() {
      if(settings.notifyUpdates===false)return;
      void send({type:'HARMONOVA_RELEASE_STATUS'}).then(response=>{
        if(response?.ok&&response.available&&valid(response.tag))show(response.tag);
      });
    }
    chrome.runtime.onMessage.addListener((message,sender)=>{
      if(sender.id===chrome.runtime.id&&message?.type==='HARMONOVA_RELEASE_AVAILABLE')
        refresh();
    });
    refresh();
    return {refresh};
  }
  globalThis.HarmoNovaContentReleaseNotice=Object.freeze({create});
})();

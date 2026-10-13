// Worker-owned, serialized cosmetic preferences. Local commit precedes sync;
// a sync failure retains an acknowledged, non-secret local recovery record.
(() => {
  'use strict';
  const KEY='harmonovaPreferencesV1';
  function create({get,set,syncGet,syncSet,broadcast=async()=>{}}) {
    let lock=Promise.resolve();
    const serial=fn=>{const work=lock.then(fn);lock=work.catch(()=>{});return work;};
    async function read() {
      const raw=await get([KEY,'harmonovaSettings','harmonicSettings']);
      if(raw[KEY] && raw[KEY].version!==1)throw new Error('UNSUPPORTED_PREFERENCES_SCHEMA');
      if(raw[KEY])return {version:1,revision:Number.isSafeInteger(raw[KEY].revision)&&raw[KEY].revision>=0?raw[KEY].revision:0,pageMigrated:raw[KEY].pageMigrated===true,
        configuredFields:(Array.isArray(raw[KEY].configuredFields)?raw[KEY].configuredFields:[]).filter(k=>Object.hasOwn(HarmoNovaSettingsSchema.defaults,k)),enabled:raw[KEY].enabled!==false,settings:HarmoNovaSettingsSchema.normalize(raw[KEY].settings)};
      const sync=await syncGet(['harmonovaSettings','harmonicSettings','harmonovaEnabled','harmonicEnabled']);
      const source=sync.harmonovaSettings||sync.harmonicSettings||raw.harmonovaSettings||raw.harmonicSettings;
      const known=HarmoNovaSettingsSchema.normalize(source,false);
      return {version:1,revision:0,pageMigrated:false,configuredFields:Object.keys(known),enabled:(sync.harmonovaEnabled??sync.harmonicEnabled)!==false,settings:HarmoNovaSettingsSchema.normalize(known)};
    }
    async function commit(record) {
      record.revision++;
      await set({[KEY]:record});
      let syncSaved=true;
      try {await syncSet({harmonovaSettings:record.settings,harmonovaEnabled:record.enabled});}catch{syncSaved=false;}
      Promise.resolve().then(() => broadcast(record)).catch(()=>{});
      return {ok:true,value:record,syncSaved};
    }
    const reset=()=>serial(async()=>{
      const current=await read();
      current.settings={...HarmoNovaSettingsSchema.defaults};
      current.configuredFields=[];
      current.pageMigrated=true; // Never restore a discarded page-origin backup.
      current.enabled=true;
      return commit(current);
    });
    const snapshot=()=>serial(read);
    const patch=(fields,enabled)=>serial(async()=> {
      const patch=HarmoNovaSettingsSchema.patch(fields);
      if(!patch||enabled!==undefined&&typeof enabled!=='boolean')throw new Error('INVALID_PREFERENCES');
      const current=await read();current.settings={...current.settings,...patch};
      current.configuredFields=[...new Set([...current.configuredFields,...Object.keys(patch)])];
      if(enabled!==undefined)current.enabled=enabled;
      return commit(current);
    });
    const migrate=(appearance)=>serial(async()=> {
      const record=await read();if(record.pageMigrated)return {ok:true,value:record,syncSaved:true};
      const proposed=HarmoNovaSettingsSchema.normalize(appearance,false);
      for(const key of HarmoNovaSettingsSchema.backupFields)if(!record.configuredFields.includes(key)&&Object.hasOwn(proposed,key))record.settings[key]=proposed[key];
      record.pageMigrated=true;
      return commit(record);
    });
    return Object.freeze({snapshot,patch,migrate,reset});
  }
  globalThis.HarmoNovaPreferencesStore=Object.freeze({create});
})();

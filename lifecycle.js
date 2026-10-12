// Document scopes own cancellation and teardown. A replaced scope cannot
// consume late results or keep timers/listeners/observers alive.
(() => {
  'use strict';
  let next=0;
  function create() {
    const controller=new AbortController(),cleanup=new Set();let alive=true;
    const scope={id:++next,signal:controller.signal,get alive(){return alive;},own(fn){if(alive)cleanup.add(fn);else fn();return fn;},dispose(){if(!alive)return;alive=false;controller.abort();for(const fn of cleanup){try{fn();}catch{}}cleanup.clear();}};
    return Object.freeze(scope);
  }
  function validateTree(root) {
    const stack=[{value:root,depth:0}];let nodes=0;
    while(stack.length) {
      const {value,depth}=stack.pop();
      if(++nodes>50000||depth>64)throw new Error('Public data is too large or deeply nested');
      if(typeof value==='string'&&value.length>32768)throw new Error('Public text is too large');
      if(!value||typeof value!=='object')continue;
      if(Array.isArray(value)){if(value.length>5000)throw new Error('Too many public items');}
      else if(Object.keys(value).some(k=>['__proto__','prototype','constructor'].includes(k)))throw new Error('Invalid public data');
      for(const child of Object.values(value))stack.push({value:child,depth:depth+1});
    }
    return root;
  }
  globalThis.HarmoNovaLifecycle=Object.freeze({create,validateTree});
})();

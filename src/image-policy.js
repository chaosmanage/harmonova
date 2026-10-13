// Bounded raster headers and one-at-a-time re-encoding. Original image bytes
// and URLs never cross the worker boundary into the reader DOM.
(() => {
  'use strict';
  const MAX_BYTES=2*1024*1024, MAX_EDGE=4096, MAX_PIXELS=8388608, MAX_OUTPUT=256*1024;
  const fail=()=> {throw new Error('UNSUPPORTED_IMAGE');};
  const ascii=(b,start,n)=>String.fromCharCode(...b.subarray(start,start+n));
  function dimensions(bytes,mime) {
    if (!(bytes instanceof Uint8Array) || bytes.length>MAX_BYTES || bytes.length<12) fail();
    const b=bytes, view=new DataView(b.buffer,b.byteOffset,b.byteLength);
    let width,height;
    if(mime==='image/png') {
      if(ascii(b,0,8)!=='\x89PNG\r\n\x1a\n') fail();
      let offset=8, chunks=0, sawData=false, sawEnd=false;
      while(offset+12<=b.length) {
        const size=view.getUint32(offset), type=ascii(b,offset+4,4);
        if(size>b.length-offset-12 || ++chunks>4096) fail();
        if(chunks===1) {
          if(type!=='IHDR'||size!==13) fail();
          width=view.getUint32(offset+8); height=view.getUint32(offset+12);
          const depth=b[offset+16],color=b[offset+17];
          const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
          if(!depths[color]?.includes(depth)||b[offset+18]||b[offset+19]||b[offset+20]>1) fail();
        } else if(type==='IHDR'||['acTL','fcTL','fdAT'].includes(type)) fail();
        if(type==='IDAT') sawData=true;
        offset+=size+12;
        if(type==='IEND') {if(size||offset!==b.length)fail(); sawEnd=true;break;}
      }
      if(!sawData||!sawEnd) fail();
    } else if(mime==='image/jpeg') {
      if(b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217) fail();
      let offset=2, sawScan=false, segments=0;
      while(offset+4<=b.length) {
        if(b[offset++]!==255) fail();
        while(b[offset]===255) offset++;
        const marker=b[offset++];
        if(marker===0||marker===216||marker===217||marker>=208&&marker<=215) fail();
        if(++segments>4096 || offset+2>b.length) fail();
        const size=view.getUint16(offset);
        if(size<2||offset+size>b.length) fail();
        if(marker===226&&ascii(b,offset+2,4)==='MPF\0')fail();
        if([192,193,194].includes(marker)) {
          if(width!==undefined||size<8||b[offset+2]!==8)fail();
          height=view.getUint16(offset+3);width=view.getUint16(offset+5);
          const components=b[offset+7]; if(![1,3,4].includes(components)||size!==8+3*components)fail();
        } else if(marker>=195&&marker<=207&&![196,200,204].includes(marker)) fail();
        if(marker===218) {sawScan=true;break;}
        offset+=size;
      }
      if(!sawScan)fail();
      for(let i=offset;i<b.length-2;i++) if(b[i]===255&&[216,217].includes(b[i+1]))fail();
    } else if(mime==='image/webp') {
      if(ascii(b,0,4)!=='RIFF'||ascii(b,8,4)!=='WEBP'||view.getUint32(4,true)+8!==b.length)fail();
      let offset=12, frames=0, extended;
      while(offset+8<=b.length) {
        const type=ascii(b,offset,4),size=view.getUint32(offset+4,true),start=offset+8;
        if(size>b.length-start) fail();
        if(['ANIM','ANMF'].includes(type))fail();
        if(type==='VP8X') {if(extended||size!==10||b[start]&0xc3||b[start+1]||b[start+2]||b[start+3])fail();extended=[1+b[start+4]+(b[start+5]<<8)+(b[start+6]<<16),1+b[start+7]+(b[start+8]<<8)+(b[start+9]<<16)];}
        if(type==='VP8 ') {if(++frames>1||size<10||b[start]&1||ascii(b,start+3,3)!=='\x9d\x01\x2a')fail();width=view.getUint16(start+6,true)&16383;height=view.getUint16(start+8,true)&16383;}
        if(type==='VP8L') {if(++frames>1||size<5||b[start]!==47||b[start+4]&224)fail(); const packed=view.getUint32(start+1,true);width=1+(packed&16383);height=1+((packed>>>14)&16383);}
        offset=start+size+(size%2);
      }
      if(offset!==b.length||frames!==1||extended&&(extended[0]!==width||extended[1]!==height))fail();
    } else fail();
    if(!width||!height||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)fail();
    return {width,height};
  }
  let tail=Promise.resolve(), pending=0;
  async function sanitize(bytes,mime,signal) {
    const header=dimensions(bytes,mime);
    if(pending>=50) throw new Error('IMAGE_BUSY');
    pending++;
    const previous=tail; let release;tail=new Promise(r=>release=r);
    await previous;
    let bitmap;
    try {
      if(signal?.aborted)throw new Error('IMAGE_CANCELLED');
      bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));
      if(bitmap.width!==header.width||bitmap.height!==header.height)fail();
      let scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
      let output,canvas;
      for(let attempt=0;attempt<2;attempt++) {
        canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        output=await canvas.convertToBlob({type:'image/png'});
        if(output.type!=='image/png')fail();
        if(output.size<=MAX_OUTPUT)break;scale/=2;
      }
      if(output.size>MAX_OUTPUT||signal?.aborted)fail();
      const thumb=new OffscreenCanvas(1,1),ctx=thumb.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0,1,1);const pixel=ctx.getImageData(0,0,1,1).data;
      const tint='#'+[...pixel].slice(0,3).map(v=>Math.round(v*.34).toString(16).padStart(2,'0')).join('');
      const encoded=new Uint8Array(await output.arrayBuffer()); let binary='';
      for(let i=0;i<encoded.length;i+=8192)binary+=String.fromCharCode(...encoded.subarray(i,i+8192));
      return {src:'data:image/png;base64,'+btoa(binary),width:canvas.width,height:canvas.height,tint};
    } finally {bitmap?.close();pending--;release();}
  }
  globalThis.HarmoNovaImagePolicy=Object.freeze({dimensions,sanitize});
})();

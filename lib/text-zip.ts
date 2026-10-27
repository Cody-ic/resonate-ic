// Stored ZIP, UTF-8 filenames. Generated text only; no execution or dependencies.
export function textZip(files:{name:string;content:string}[]){
  const encoder=new TextEncoder(),parts:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
  const crc=(data:Uint8Array)=>{let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const header=(size:number)=>{const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};};
  const join=(items:Uint8Array[])=>{const result=new Uint8Array(items.reduce((n,b)=>n+b.length,0));let at=0;for(const item of items){result.set(item,at);at+=item.length;}return result;};
  for(const file of files){const name=encoder.encode(file.name),data=encoder.encode(file.content),sum=crc(data),local=header(30),central=header(46);
    local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);local.view.setUint32(14,sum,true);local.view.setUint32(18,data.length,true);local.view.setUint32(22,data.length,true);local.view.setUint16(26,name.length,true);
    central.view.setUint32(0,0x02014b50,true);central.view.setUint16(4,20,true);central.view.setUint16(6,20,true);central.view.setUint16(8,0x800,true);central.view.setUint32(16,sum,true);central.view.setUint32(20,data.length,true);central.view.setUint32(24,data.length,true);central.view.setUint16(28,name.length,true);central.view.setUint32(42,offset,true);
    parts.push(local.bytes,name,data);directory.push(central.bytes,name);offset+=30+name.length+data.length;
  }
  const central=join(directory),end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,central.length,true);end.view.setUint32(16,offset,true);return join([...parts,central,end.bytes]);
}

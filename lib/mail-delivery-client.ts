const storageKey=(email:string,reset:boolean)=>'gongzhen:mail-delivery:'+(reset?'reset:':'verify:')+email.trim().toLowerCase();
export function rememberDelivery(email:string,ticket:string,reset=false){try{sessionStorage.setItem(storageKey(email,reset),ticket);}catch{}}
export function rememberedDelivery(email:string,reset=false){try{return sessionStorage.getItem(storageKey(email,reset))??'';}catch{return '';}}

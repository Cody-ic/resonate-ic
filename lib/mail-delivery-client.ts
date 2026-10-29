const storageKey=(email:string,reset:boolean)=>'gongzhen:mail-delivery:'+(reset?'reset:':'verify:')+email.trim().toLowerCase();
export function rememberDelivery(email:string,ticket:string,reset=false){try{sessionStorage.setItem(storageKey(email,reset),ticket);sessionStorage.setItem(storageKey(email,reset)+':resend-after',String(Date.now()+60000));}catch{}}
export function rememberedDelivery(email:string,reset=false){try{return sessionStorage.getItem(storageKey(email,reset))??'';}catch{return '';}}
export function deliveryResendAfter(email:string,reset=false){try{return Number(sessionStorage.getItem(storageKey(email,reset)+':resend-after'))||0;}catch{return 0;}}

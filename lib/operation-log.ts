// Avoid raw exception messages: provider responses can contain private values.
export function logApiFailure(operation:string,error:unknown){
  const requestId=crypto.randomUUID();
  console.error(JSON.stringify({event:'api_failure',requestId,operation:/^[a-z-]+$/.test(operation)?operation:'unknown',errorType:error instanceof Error?error.name:'unknown',at:new Date().toISOString()}));
  return requestId;
}

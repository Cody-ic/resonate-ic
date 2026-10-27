// Only expose the server's opaque support ID; never stringify response objects.
export function requestErrorMessage(value:Record<string,any>,fallback='操作失败，请稍后重试') {
  const message=typeof value.error==='string'?value.error:fallback;
  const fields=value.fields?.fieldErrors;
  const details=fields&&typeof fields==='object'?Object.entries(fields).map(([key,errors])=>`${key} ${errors}`).join('；'):'';
  const requestId=typeof value.requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)?value.requestId:null;
  return message+(details?'：'+details:'')+(requestId?`（错误编号：${requestId}，联系网站时请附上此编号）`:'');
}

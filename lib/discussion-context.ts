export function discussionInput(snapshot:any,info:any){
  const reply=info.type==='reply';
  return {
    target:{type:reply?'reply':'topic',id:info.id,...(!reply?{title:snapshot.title,board:snapshot.board}:{}),body:snapshot.body},
    ...(reply?{parentContext:{type:'topic',id:info.row.topic_id,title:snapshot.topicTitle??info.row.title,body:snapshot.topicBody??info.row.topic_body,scope:'context_only',capturedAt:'reply_submission'}}:{}),
  };
}
export function discussionEvidence(snapshot:any){return [snapshot.title,snapshot.body].filter(x=>typeof x==='string').join('\n');}

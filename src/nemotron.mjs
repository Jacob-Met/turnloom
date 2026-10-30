// Optional return suggestions from NVIDIA Nemotron on Nebius Token Factory.
// The server holds the key; the browser never receives it. Inputs come from
// controller.modelInput, which excludes private drafts by construction.
export const NEBIUS_BASE_URL='https://api.tokenfactory.nebius.com/v1';
export const NEMOTRON_MODEL='nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
export const CUE_LIMIT=300;
const SYSTEM=[
  'You help a participant in a group conversation return to a statement they want to answer.',
  'You receive the original statement, the current topic, and recent public statements. You never receive private drafts.',
  'Reply with only a JSON object: {"statementId":"<the original statement id, copied exactly>","cue":"<one or two plain sentences>"}.',
  'The cue is a neutral reference that names the original statement, its speaker and its point, and connects it to the current topic. Example: "Returning to Sam about the garden gate, while we talk about timing." Do not write the participant\'s position, wording or answer. Do not invent, complete or attribute any unshared contribution. Do not say or imply that anyone agreed or consented. Keep it under 240 characters.',
].join(' ');

export class ModelError extends Error {
  constructor(message){super(message);this.name='ModelError';this.code='MODEL_UNAVAILABLE';}
}

export function parseCue(content,originalId){
  if(typeof content!=='string'||!content.trim())throw new ModelError('The model returned no suggestion.');
  const start=content.indexOf('{'),end=content.lastIndexOf('}');
  let data;
  try{data=JSON.parse(content.slice(start,end+1));}catch{throw new ModelError('The model suggestion was not valid JSON.');}
  if(!data||typeof data!=='object'||data.statementId!==originalId)throw new ModelError('The model suggestion did not cite the original statement.');
  if(typeof data.cue!=='string')throw new ModelError('The model suggestion had no cue.');
  const cue=data.cue.replace(/\s+/g,' ').trim();
  if(!cue||cue.length>CUE_LIMIT)throw new ModelError('The model suggestion was empty or too long.');
  return cue;
}

export function createNemotronClient({apiKey,fetchImpl=globalThis.fetch,model=NEMOTRON_MODEL,baseUrl=NEBIUS_BASE_URL,timeoutMs=30000}={}){
  const available=typeof apiKey==='string'&&apiKey.trim().length>0;
  return {
    available,
    model,
    async suggestReturnCue(input){
      if(!available)throw new ModelError('No model key is configured.');
      const names=new Map(input.publicContext.participants.map(p=>[p.id,p.name]));
      const statements=input.publicContext.anchors.slice(-12).map(a=>({id:a.id,speaker:names.get(a.speakerId)||'Participant',topic:a.topicId,statement:a.statement}));
      const user=JSON.stringify({
        originalStatement:{id:input.originalAnchor.id,speaker:names.get(input.originalAnchor.speakerId)||'Participant',statement:input.originalAnchor.statement},
        currentTopic:input.activeTopic.label,
        recentStatements:statements,
      });
      let response;
      try{
        response=await fetchImpl(`${baseUrl}/chat/completions`,{
          method:'POST',
          signal:AbortSignal.timeout(timeoutMs),
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey.trim()}`},
          body:JSON.stringify({model,max_tokens:1500,temperature:0.2,messages:[{role:'system',content:SYSTEM},{role:'user',content:user}]}),
        });
      }catch{throw new ModelError('The model service could not be reached.');}
      if(!response.ok)throw new ModelError(`The model service returned status ${response.status}.`);
      let body;
      try{body=await response.json();}catch{throw new ModelError('The model service returned an unreadable response.');}
      return parseCue(body?.choices?.[0]?.message?.content,input.originalAnchor.id);
    },
  };
}

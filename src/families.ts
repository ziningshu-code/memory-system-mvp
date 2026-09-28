import type {CanonicalExchange, CanonicalTopic} from './types.js';
import {LexicalIndex} from './retrieval.js';

export interface MemoryEmbedding {
  /** Must identify provider, model and dimensionality; change it when any of these change. */
  id: string;
  embed(texts: string[], inputType: 'passage' | 'query'): Promise<number[][]>;
}
export type EvidenceOrder = 'earliest' | 'latest';
export interface FamilyView {
  familyId: string; scope: string; segments: CanonicalTopic[];
  firstTime: number | null; lastTime: number | null; turnCount: number; occurrences: number;
  relatedIds: string[];
}
export const familyIdOf=(t:CanonicalTopic)=>t.family?.id??t.topicId;
export const segmentText=(t:CanonicalTopic)=>[t.family?.scope??'',...t.labelTerms,...t.retrievalTerms].join(' ');
export function familyViews(topics:CanonicalTopic[]):FamilyView[] {
  const groups=new Map<string,CanonicalTopic[]>();
  for(const t of topics){const id=familyIdOf(t);groups.set(id,[...(groups.get(id)??[]),t]);}
  const result=[...groups].map(([familyId,segments])=>{
    segments.sort((a,b)=>(a.startedAt??0)-(b.startedAt??0)||a.topicId.localeCompare(b.topicId));
    const sequences=new Set<number>();let occurrences=0,lastEnd=-Infinity;
    for(const s of segments){
      for(const span of s.spans)for(let i=span.startSequence;i<=span.endSequence;i++)sequences.add(i);
      // A batch boundary alone does not count as another recurrence. This is a disclosed proxy.
      const start=s.startedAt??0,end=s.endedAt??start;
      if(!occurrences||start-lastEnd>=30*60*1000)occurrences++;
      lastEnd=Math.max(lastEnd,end);
    }
    return {familyId,scope:segments[0].family?.scope??segments[0].labelTerms.join(' / '),segments,
      firstTime:segments[0].startedAt,lastTime:Math.max(...segments.map(s=>s.endedAt??s.startedAt??0)),
      turnCount:sequences.size,occurrences,relatedIds:[...new Set(segments.flatMap(s=>s.family?.relatedIds??[]))].filter(id=>id!==familyId)};
  });
  // Relation edges are a view over immutable segments and can be followed in either direction.
  const byId=new Map(result.map(f=>[f.familyId,f]));
  for(const f of result)for(const id of [...f.relatedIds]){
    const target=byId.get(id);if(target&&!target.relatedIds.includes(f.familyId))target.relatedIds.push(f.familyId);
  }
  return result;
}
export function validVector(v:unknown,dimensions?:number):v is number[]{
  return Array.isArray(v)&&v.length>0&&v.length<=16384&&(dimensions===undefined||v.length===dimensions)&&v.every(n=>typeof n==='number'&&Number.isFinite(n))&&v.some(n=>n!==0);
}
function cosine(a:number[],b:number[]){let dot=0,x=0,y=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}return dot/Math.sqrt(x*y);}
export interface RankedFamily {family:FamilyView; relevance:number; priority:number; score:number;}
export async function rankFamilies(query:string,topics:CanonicalTopic[],rows:CanonicalExchange[],now:number,embedding?:MemoryEmbedding){
  const families=familyViews(topics),byTopic=new Map(topics.map(t=>[t.topicId,familyIdOf(t)]));
  // Index every immutable card, so old names do not disappear from a rolling family summary.
  const lexical=new LexicalIndex(topics.map(t=>({id:t.topicId,text:segmentText(t)})));
  const sparse=new Map<string,number>();
  for(const hit of lexical.search(query,topics.length)){
    const id=byTopic.get(hit.id)!;sparse.set(id,Math.max(sparse.get(id)??0,hit.score));
  }
  // Raw BM25 is local only. It can recover a literal detail omitted from every card.
  const rowFamily=new Map<number,string>();
  for(const t of topics)for(const span of t.spans)for(let i=span.startSequence;i<=span.endSequence;i++)rowFamily.set(i,familyIdOf(t));
  const raw=new LexicalIndex(rows.map(r=>({id:String(r.sequence),text:r.userText+' '+r.assistantText})));
  const rawScores=new Map<string,number>();
  for(const hit of raw.search(query,rows.length)){
    const id=rowFamily.get(Number(hit.id));if(id)rawScores.set(id,Math.max(rawScores.get(id)??0,hit.score));
  }
  function normalized(values:Map<string,number>){const max=Math.max(0,...values.values());return new Map([...values].map(([id,n])=>[id,max?n/max:0]));}
  const cardScores=normalized(sparse),originalScores=normalized(rawScores),dense=new Map<string,number>();
  let embeddingCalls=0,embeddingError:string|null=null;
  const vectors=topics.filter(t=>t.embedding?.model===embedding?.id&&t.embedding?.text===segmentText(t)&&validVector(t.embedding?.vector));
  if(embedding&&vectors.length){
    try{
      embeddingCalls++;const output=await embedding.embed([query],'query');
      if(output.length!==1||!validVector(output[0]))throw new Error('Invalid query embedding');
      for(const t of vectors){
        if(!validVector(t.embedding!.vector,output[0].length))throw new Error('Embedding dimensions changed');
        const id=familyIdOf(t),score=Math.max(0,cosine(output[0],t.embedding!.vector));dense.set(id,Math.max(dense.get(id)??0,score));
      }
    }catch{embeddingError='Embedding unavailable; using local keyword candidates.';dense.clear();}
  }
  // Fuse ranks only when semantic search is enabled; scores are heuristics, not probabilities.
  const lexicalScores=new Map(families.map(f=>[f.familyId,Math.max(cardScores.get(f.familyId)??0,originalScores.get(f.familyId)??0)]));
  const fused=new Map<string,number>();
  if(dense.size){
    for(const scores of [lexicalScores,dense]) [...scores].filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).forEach(([id],i)=>fused.set(id,(fused.get(id)??0)+1/(60+i+1)));
  }
  const relevance=dense.size?normalized(fused):lexicalScores;
  const ranked=families.map(family=>{
    const age=Math.max(0,now-(family.lastTime??now)),recency=Math.exp(-age/(30*86400000));
    const frequency=Math.min(1,Math.log1p(Math.max(0,family.occurrences-1))/Math.log(11));
    const length=Math.min(1,Math.log1p(family.turnCount)/Math.log(101));
    // No duration bonus: two isolated mentions years apart are not automatically important.
    const priority=.6*recency+.3*frequency+.1*length,r=relevance.get(family.familyId)??0;
    return {family,relevance:r,priority,score:r*(.85+.15*priority)};
  }).sort((a,b)=>b.score-a.score||b.priority-a.priority||a.family.familyId.localeCompare(b.family.familyId));
  return {ranked,embeddingCalls,embeddingError,rawMatchedFamilyIds:new Set(rawScores.keys())};
}
export function familyCard(family:FamilyView,query='',originalKeywordMatch=false){
  const lexical=new LexicalIndex(family.segments.map(t=>({id:t.topicId,text:segmentText(t)})));
  const hits=lexical.search(query,2).map(h=>h.id);
  const ids=[...new Set([family.segments[0].topicId,family.segments.at(-1)!.topicId,...hits])];
  return {familyId:family.familyId,scope:family.scope,firstTime:family.firstTime,lastTime:family.lastTime,
    ...(originalKeywordMatch?{originalKeywordMatch:true}:{}),
    turnCount:family.turnCount,occurrences:family.occurrences,segmentCount:family.segments.length,
    relatedIds:family.relatedIds.slice(0,8),examples:ids.slice(0,4).map(id=>{
      const t=family.segments.find(t=>t.topicId===id)!;
      return {topicId:id,labels:t.labelTerms,terms:t.retrievalTerms,startedAt:t.startedAt,endedAt:t.endedAt};
    }),examplesComplete:ids.length===family.segments.length};
}

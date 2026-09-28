import type {CanonicalExchange, CanonicalTopic, TopicLinkEvidence} from './types.js';
import type {FamilyView} from './families.js';

interface Link {
  fromTopic: number;
  toTopic?: number;
  toFamily?: string;
  kind: TopicLinkEvidence['kind'];
  sequence: number;
  quote: string;
}
const contains=(t:CanonicalTopic,n:number)=>t.spans.some(s=>n>=s.startSequence&&n<=s.endSequence);

/** Check references and source provenance, then resolve only explicit same-event claims.
 * Semantic correctness still belongs in retrieval/model evaluation. Never rewrite old segments.
 */
export function assignGroundedFamilies(parsed:Record<string,unknown>,fresh:CanonicalTopic[],rows:CanonicalExchange[],allowed:Map<string,FamilyView>){
  const values=parsed.topics as Array<Record<string,unknown>>;
  if(!Array.isArray(parsed.links)||parsed.links.length>fresh.length*3)throw new Error('Expected bounded family links array');
  const scopes=values.map(v=>{
    if(typeof v.scope!=='string'||!v.scope.trim()||v.scope.length>160)throw new Error('Invalid family scope');
    return v.scope.trim();
  });
  let droppedUngroundedLinks=0;
  const links:Link[]=parsed.links.flatMap(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid family link');
    const l=value as Link;
    const validIndex=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<fresh.length;
    if(!validIndex(l.fromTopic)||!['same_event','related','separate'].includes(l.kind))throw new Error('Invalid family link source or kind');
    const hasTopic=Object.hasOwn(l,'toTopic'),hasFamily=Object.hasOwn(l,'toFamily');
    if(hasTopic===hasFamily||(hasTopic&&(!validIndex(l.toTopic)||(l.toTopic===l.fromTopic&&l.kind!=='same_event')))||
      (hasFamily&&(typeof l.toFamily!=='string'||!allowed.has(l.toFamily))))throw new Error('Unknown or ambiguous family link target');
    const row=rows.find(r=>r.sequence===l.sequence);
    if(!row||!contains(fresh[l.fromTopic],l.sequence)||typeof l.quote!=='string'||l.quote.trim().length<2||l.quote.length>240||
      !(row.userText.includes(l.quote)||row.assistantText.includes(l.quote))){
      droppedUngroundedLinks++;
      return [];
    }
    return [{fromTopic:l.fromTopic,...(hasTopic?{toTopic:l.toTopic}:{toFamily:l.toFamily}),kind:l.kind,sequence:l.sequence,quote:l.quote}];
  }).filter(l=>!(l.kind==='same_event'&&'toTopic' in l&&l.toTopic===l.fromTopic));
  const parents=fresh.map((_,i)=>i);
  const find=(i:number):number=>parents[i]===i?i:find(parents[i]);
  const anchors=new Map<number,string>();let downgradedConflictingLinks=0;
  for(const l of links)if(l.kind==='same_event'&&l.toFamily){
    const previous=anchors.get(l.fromTopic);
    if(previous&&previous!==l.toFamily){l.kind='related';downgradedConflictingLinks++;}
    else anchors.set(l.fromTopic,l.toFamily);
  }
  for(const l of links)if(l.kind==='same_event'&&l.toTopic!==undefined){
    const a=find(l.fromTopic),b=find(l.toTopic);
    if(a===b)continue;
    const first=anchors.get(a),second=anchors.get(b);
    if(first&&second&&first!==second){l.kind='related';downgradedConflictingLinks++;continue;}
    const root=Math.min(a,b),child=Math.max(a,b);
    parents[child]=root;
    if(first||second)anchors.set(root,(first??second)!);
  }
  const ids=new Map<number,string>();
  fresh.forEach((_,i)=>{const root=find(i);if(!ids.has(root))ids.set(root,anchors.get(root)??'fam_'+crypto.randomUUID());});
  const idOf=(i:number)=>ids.get(find(i))!;
  for(const l of links)if(l.kind==='separate'&&idOf(l.fromTopic)===(l.toFamily??idOf(l.toTopic!)))throw new Error('Conflicting same-event and separate links');
  fresh.forEach((t,i)=>{
    const id=idOf(i),existing=allowed.get(id),v=values[i];
    // Older custom output may supply an ID, but it must agree with grounded links.
    if(v.familyId!==undefined&&v.familyId!==null&&v.familyId!==id)throw new Error('Family ID requires a matching grounded same-event link');
    if(v.relatedFamilyIds!==undefined&&(!Array.isArray(v.relatedFamilyIds)||v.relatedFamilyIds.some(r=>!links.some(l=>l.fromTopic===i&&l.toFamily===r&&l.kind==='related'))))throw new Error('Related family IDs require grounded links');
    const changes=(parsed.assignments as Array<{sequence:number;topicIndex:number;change:unknown}>).filter(a=>a.topicIndex===i).map(a=>{
      if(!['continuation','addition','revision','negation'].includes(String(a.change)))throw new Error('Invalid family change type');
      return {sequence:a.sequence,kind:a.change as 'continuation'|'addition'|'revision'|'negation'};
    });
    const evidence=links.filter(l=>l.fromTopic===i).map(l=>({kind:l.kind,targetFamilyId:l.toFamily??idOf(l.toTopic!),sequence:l.sequence,quote:l.quote}));
    t.family={id,scope:existing?.scope??scopes[find(i)],relatedIds:[...new Set(evidence.filter(l=>l.kind==='related').map(l=>l.targetFamilyId))].filter(r=>r!==id),changes,linkEvidence:evidence};
  });
  return {droppedUngroundedLinks,downgradedConflictingLinks};
}

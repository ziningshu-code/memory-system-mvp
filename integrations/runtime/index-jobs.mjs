/** Drain ready batches while one process owns the project index lock. */
export async function drainReadyBatches(memory,{auto=false,retry=false,maxBatches=32,onBatch=async()=>{}}={}){
  if(!Number.isSafeInteger(maxBatches)||maxBatches<1)throw new Error('Invalid index batch limit');
  let acceptedBatches=0,last;
  while(true){
    last=await memory.index({flush:!auto,retryFailed:retry&&acceptedBatches===0});
    await onBatch(last);
    if(last.reason==='accepted')acceptedBatches++;
    if(!auto||last.reason!=='accepted'||acceptedBatches>=maxBatches)break;
  }
  return {last,acceptedBatches,hitLimit:auto&&acceptedBatches>=maxBatches&&last.reason==='accepted'};
}

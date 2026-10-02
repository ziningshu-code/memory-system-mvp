export function parseStoredScope(userId) {
  for (const representation of [userId, typeof userId === 'string' ? userId.replaceAll('\\"', '"') : userId]) {
   try {
    const value = JSON.parse(representation);
    return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string' && item)
      ? { ownerId: value[0], sessionId: value[1] } : null;
   } catch { /* Accept the native sanitizer's escaped-quote representation too. */ }
  }
  return null;
}
export function actualSourceKey(source) {
  const transcript = source.transcriptOwnership;
  const scoped = parseStoredScope(transcript?.user_id ?? source.nodeStorageOwnership?.user_id ?? source.nodeUserId);
  const session = transcript?.session_id ?? source.nodeConversationId;
  return `${scoped?.ownerId ?? 'invalid-owner'}/${session ?? 'invalid-session'}/${transcript?.source_id ?? source.id}`;
}
export function storedSourceScopes(source) {
  const nodeScope = parseStoredScope(source.nodeStorageOwnership?.user_id ?? source.nodeUserId), transcript = source.transcriptOwnership;
  const metadataScope = parseStoredScope(source.nodeUserId);
  const transcriptScope = parseStoredScope(transcript?.user_id);
  return [...new Set([
    ...(nodeScope ? [`${nodeScope.ownerId}/${nodeScope.sessionId}`, `${nodeScope.ownerId}/${source.nodeConversationId}`] : []),
    ...(metadataScope ? [`${metadataScope.ownerId}/${metadataScope.sessionId}`, `${metadataScope.ownerId}/${source.nodeConversationId}`] : []),
    ...(transcriptScope ? [`${transcriptScope.ownerId}/${transcriptScope.sessionId}`, `${transcriptScope.ownerId}/${transcript.session_id}`] : []),
  ])];
}
export function auditSource(source, expectedSources, requestedScope) {
  const key = actualSourceKey(source), expected = expectedSources.get(key);
  const request = requestedScope ?? expected;
  const wantedUserId = request ? JSON.stringify([request.ownerId, request.sessionId]) : null;
  const transcript = source.transcriptOwnership;
  const metadataScope = parseStoredScope(source.nodeUserId), storage = source.nodeStorageOwnership;
  const nodeScopeCorrect = Boolean(request && metadataScope?.ownerId === request.ownerId && metadataScope?.sessionId === request.sessionId
    && storage?.tenant_id === 'blind-synthetic' && storage.user_id === wantedUserId && storage.node_id === source.id
    && source.nodeConversationId === request.sessionId && source.nodeSourceId === source.id);
  const transcriptScopeCorrect = source.system === 'upstream' ? null : Boolean(transcript && request
    && transcript.tenant_id === 'blind-synthetic' && transcript.user_id === wantedUserId
    && transcript.session_id === request.sessionId && transcript.source_id === source.id
    && transcript.derived_node_id === source.nodeSourceId);
  const expectedTraceId = source.system === 'upstream' ? source.nodeUserId : source.id;
  const metadataSourceIdCorrect = source.metadataSourceId === source.id;
  const traceSourceIdCorrect = source.sourceTraceId === expectedTraceId;
  const traceRefCorrect = Boolean(expected && source.sourceTraceRef === `conversation:${expected.sessionId}:${source.id}`);
  const traceAtCorrect = Boolean(expected && source.sourceTraceAt === expected.recordedAt);
  return { key, exactText: Boolean(expected && source.text === expected.text),
    derivedText: Boolean(expected && source.derivedText === expected.text),
    role: Boolean(expected && source.role === expected.role), turnId: Boolean(expected && source.turnId === expected.turnId),
    recordedAt: Boolean(expected && source.recordedAt === expected.recordedAt), excerpted: source.excerpted,
    nodeScopeCorrect, transcriptScopeCorrect, storedScopeCorrect: nodeScopeCorrect
      && (source.system === 'upstream' || transcriptScopeCorrect), storedScopes: storedSourceScopes(source),
    storedNodeUserId: source.nodeUserId, storedNodeConversationId: source.nodeConversationId,
    storedNodeSourceId: source.nodeSourceId, nodeStorageOwnership: storage ?? null, transcriptOwnership: transcript ?? null,
    nativeProvenanceCorrect: traceSourceIdCorrect && traceRefCorrect && traceAtCorrect && metadataSourceIdCorrect,
    nativeProvenanceContract: source.system === 'upstream' ? 'scoped owner source_trace.source_id' : 'per-source source_trace.source_id',
    traceUsesPerSourceId: source.sourceTraceId === source.id,
    traceSourceIdCorrect, traceRefCorrect, traceAtCorrect, metadataSourceIdCorrect,
    provenanceSourceId: source.sourceTraceId, sourceTraceRef: source.sourceTraceRef,
    sourceTraceAt: source.sourceTraceAt, metadataSourceId: source.metadataSourceId };
}
export function auditEvidence(test, sources, expectedSources) {
  const actual = sources.map(actualSourceKey), audit = sources.map(source => auditSource(source, expectedSources, test));
  // Supersession replaces the completed exchange, so forbid both role records even
  // when a label names only the user record. Labels themselves remain unchanged.
  const forbiddenTurns = new Set((test.forbidden ?? []).map(id => id.replace(/:(user|assistant)$/, '')));
  const staleSources = actual.filter(key => {
    const prefix = `${test.ownerId}/${test.sessionId}/`;
    return key.startsWith(prefix) && forbiddenTurns.has(key.slice(prefix.length).replace(/:(user|assistant)$/, ''));
  });
  const forbiddenScopeSources = audit.filter(row => row.storedScopes.some(scope => (test.forbiddenScopes ?? []).includes(scope))).map(row => row.key);
  const temporalViolations = test.asOf === undefined ? [] : sources.flatMap((source, index) => {
    const gold = expectedSources.get(actual[index]);
    if (!gold) return [{ key: actual[index], reason: 'missing authoritative fixture source' }];
    if (source.recordedAt > test.asOf || gold.recordedAt > test.asOf) return [{ key: actual[index], reason: 'recorded after asOf' }];
    const superseded = [...expectedSources.values()].some(candidate => candidate.ownerId === gold.ownerId
      && candidate.sessionId === gold.sessionId && candidate.role === gold.role
      && candidate.supersedesSourceId === `${gold.turnId}:user` && candidate.recordedAt <= test.asOf);
    return superseded ? [{ key: actual[index], reason: 'superseded at asOf' }] : [];
  });
  const expectedHit = test.expected.length ? test.expected.every(id => actual.includes(id)) : actual.length === 0;
  const exactSourceIntegrity = audit.every(row => row.exactText && row.derivedText && row.role && row.turnId && row.recordedAt);
  const storedScopeIntegrity = audit.every(row => row.storedScopeCorrect) && !forbiddenScopeSources.length;
  const nativeProvenanceIntegrity = audit.every(row => row.nativeProvenanceCorrect);
  return { actual, sourceAudit: audit, expectedHit, staleSources, forbiddenScopeSources, temporalViolations,
    exactSourceIntegrity, storedScopeIntegrity, nativeProvenanceIntegrity,
    evidenceCorrect: expectedHit && !staleSources.length && !temporalViolations.length && exactSourceIntegrity
      && storedScopeIntegrity && nativeProvenanceIntegrity };
}

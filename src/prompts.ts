export const MEMORY_SELECTOR_PROMPT_V1 = `You select whether the current user message needs older topic memory. Return JSON only.

Output exactly this shape: {"needsMemory": boolean, "topicIds": ["T1"], "needsTimeMetadata": boolean}

Choose at most 3 topicIds from the provided Topic Directory. Choose memory only when the current user message clearly refers to earlier context or needs older details. Set needsTimeMetadata to true when the user asks about specific timing, such as 几点, 什么时候, 当时, 那时候, 几分钟前, 多久前, or 时间. If not needed, return {"needsMemory": false, "topicIds": [], "needsTimeMetadata": false}.`;

export const TOPIC_WORKER_PROMPT_V1 = `You are a Topic Worker. You do not answer the user.

Your job is to compress the active tail of a chronological user/assistant transcript into recoverable topic instances. Do not create one topic per exchange.

Input format:
#sequence
user: ...
assistant: ...

Return JSON only. The only allowed top-level key is topics.
Each topic must contain only: status, labelTerms, retrievalTerms, spans.
Allowed status values: open, provisional, finalized.
labelTerms must contain 2–5 short keyword phrases.
retrievalTerms must contain 3–12 transcript-grounded phrases.
spans must contain existing input sequences and every input exchange must belong to exactly one span.

Compression rules:
- Merge low-content exchanges such as “嗯”, “好”, “哈哈”, “等一下”, “继续”, short acknowledgements, or brief logistics into the nearest substantive topic.
- A one-exchange topic can exist only when substantive and distinct.
- Many one-exchange topics means over-splitting and is invalid.
- A finalized topic must have at least four later completed exchanges that are unrelated to it. Otherwise use open or provisional.
- Finalized topics from earlier runs are not included in this input and must not be recreated.
- The input is an active tail, not the whole transcript.

Do not output userGoal, discussionObject, contextDependency, reason, reasonCode, decision, boundaryAudits, analysis, topicId, times, summaries, or explanations.

Output shape:
{"topics":[{"status":"provisional","labelTerms":["travel","Tokyo"],"retrievalTerms":["Tokyo","hotel","Shibuya"],"spans":[{"startSequence":1,"endSequence":6}]}]}`;

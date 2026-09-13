// Synthetic, public conversation. No user conversation or private data is used.
export const scenario = [
  ['I am planning a trip to Tokyo in November.', 'Let us keep the Tokyo plans together.'],
  ['Book a hotel in Ueno, not Shibuya. My limit is 14000 yen per night.', 'Ueno, with a nightly budget of 14000 yen.'],
  ['I would like a quiet room near a train station.', 'A quiet room with good train access.'],
  ['I will stay for four nights.', 'Four nights in Tokyo.'],
  ['No breakfast package, please.', 'We will leave breakfast out of the hotel booking.'],
  ['That settles the hotel plan.', 'The Tokyo hotel plan is recorded.'],
  ['Please remember my food preferences.', 'Tell me what I should take into account.'],
  ['I am allergic to peanuts.', 'I will keep your peanut allergy in mind when discussing food.'],
  ['I prefer vegetarian lunches.', 'Vegetarian lunches are your preference.'],
  ['I like mild food, not very spicy dishes.', 'Mild food works for you.'],
  ['For coffee, I use oat milk.', 'Oat milk for coffee.'],
  ['Those are my food notes.', 'Your food notes are recorded.'],
  ['Let us decide the next release of Project Lantern.', 'What should the release include?'],
  ['The first export format will be CSV. PDF export can wait.', 'CSV first; PDF is deferred.'],
  ['We are aiming for Wednesday for the demo.', 'The Project Lantern demo is planned for Wednesday.'],
  ['The first version only needs one workspace.', 'One workspace is enough for this version.'],
  ['We will test with synthetic data.', 'The demo will use synthetic data.'],
  ['That is the release scope.', 'The Project Lantern scope is recorded.'],
  ['I am reading about astronomy this weekend.', 'What would you like to learn?'],
  ['Explain why the Moon has phases.', 'We see different portions of its sunlit half as it orbits Earth.'],
  ['Is a lunar eclipse the same thing?', 'No. An eclipse happens when Earth blocks sunlight from reaching the Moon.'],
  ['What is a constellation?', 'A named pattern or region of stars as seen from Earth.'],
  ['Can I start with binoculars?', 'Binoculars can be useful for beginning sky observations.'],
  ['Thanks, I will read a little more.', 'Enjoy your reading.'],
].map(([userText, assistantText], index) => ({
  sequence: index + 1, userText, assistantText,
  userSentAt: Date.UTC(2026, 0, 10, 10, index * 2),
}));

export const topicDrafts = [
  { status: 'finalized', labelTerms: ['Tokyo', 'hotel'], retrievalTerms: ['Ueno', '14000 yen', 'four nights'], spans: [{ startSequence: 1, endSequence: 6 }] },
  { status: 'finalized', labelTerms: ['food', 'preferences'], retrievalTerms: ['peanuts', 'vegetarian', 'oat milk'], spans: [{ startSequence: 7, endSequence: 12 }] },
  { status: 'finalized', labelTerms: ['Project Lantern', 'release'], retrievalTerms: ['CSV', 'Wednesday', 'one workspace'], spans: [{ startSequence: 13, endSequence: 18 }] },
  { status: 'provisional', labelTerms: ['astronomy', 'weekend'], retrievalTerms: ['Moon', 'constellation', 'binoculars'], spans: [{ startSequence: 19, endSequence: 24 }] },
];

export const questions = [
  { id: 'hotel', label: 'Hotel plan', zh: '酒店计划', question: 'Which Tokyo area and nightly budget did I choose for my hotel?', questionZh: '我之前决定住东京哪个区域，每晚预算多少？', topicIds: ['T1'], evidence: [2], answerGroups: [['ueno'], ['14000', '14,000']] },
  { id: 'allergy', label: 'Food notes', zh: '饮食记录', question: 'What food allergy did I tell you about?', questionZh: '我之前说过对哪种食物过敏？', topicIds: ['T2'], evidence: [8], answerGroups: [['peanut']] },
  { id: 'release', label: 'Project decision', zh: '项目决定', question: 'What is the first export format for Project Lantern, and when is its demo?', questionZh: 'Lantern 项目先支持哪种导出格式，计划哪天演示？', topicIds: ['T3'], evidence: [14, 15], answerGroups: [['csv'], ['wednesday']] },
  { id: 'unknown', label: 'Missing information', zh: '未记录的信息', question: 'What is my passport number?', questionZh: '我的护照号码是什么？', topicIds: [], evidence: [], answerGroups: [], unknown: true },
];

// Deliberately scripted: this demonstrates SDK mechanics, not LLM quality.
export function createScriptedLlm() {
  return {
    async complete({ system, user }) {
      if (system.includes('Topic Worker')) return JSON.stringify({ topics: topicDrafts });
      const selected = questions.find(q => user.includes(q.question));
      return JSON.stringify({ needsMemory: Boolean(selected?.topicIds.length), topicIds: selected?.topicIds ?? [], needsTimeMetadata: false });
    },
  };
}

export async function seedConversation(memory) {
  for (const exchange of scenario) {
    const pending = await memory.beginExchange(exchange);
    await memory.completeExchange({ exchangeId: pending.id, assistantText: exchange.assistantText, assistantCompletedAt: exchange.userSentAt + 1000 });
  }
}


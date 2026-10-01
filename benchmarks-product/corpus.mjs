export const BASE_TIME = Date.UTC(2026, 8, 1, 12);

const primary = [
  ['tokyo', 'For my Tokyo trip, I booked Sakura Hotel in Ueno. Booking code TYO-314.', 'You booked Sakura Hotel in Ueno for Tokyo.'],
  ['food', 'I prefer vegetarian meals when I travel.', 'I will remember your vegetarian travel preference.'],
  ['museum', '我计划周五去上海博物馆看青铜器展。', '你计划周五参观上海博物馆的青铜器展。'],
  ['project', 'Project Atlas 的截止日期是 10 月 18 日，负责人是 Mei。', 'Atlas is due October 18 and Mei owns it.'],
  ['paris', 'I booked Lumiere Hotel beside the Seine for my Paris trip.', 'Your Paris hotel is Lumiere Hotel.'],
  ['pet', 'My cat Juniper likes the blue blanket by the window.', 'Juniper likes the blue blanket.'],
  ['music', 'I practice jazz piano on Tuesday evenings.', 'Tuesday evenings are for jazz piano practice.'],
  ['garden', 'The balcony basil plants need water every Sunday morning.', 'The balcony basil gets water on Sundays.'],
  ['train', '我的高铁车次是 G812，周六早上从杭州到南京。', 'G812 goes from Hangzhou to Nanjing on Saturday morning.'],
  ['invoice', 'Invoice INV-702 is for the September design workshop.', 'INV-702 is the September workshop invoice.'],
  ['recipe', 'For the family soup, I add ginger before the mushrooms.', 'Ginger goes in before the mushrooms.'],
  ['verbatim', '  Keep this exact note:\n  line one has two leading spaces.\n  Symbols: Ø / 雪 / 🧭  ', 'I saw the note with its original spacing and symbols.'],
];

const secondary = [
  ['tokyo-other', 'For my Tokyo trip, I booked Maple Hotel in Shinjuku.', 'Your Tokyo hotel is Maple Hotel in Shinjuku.'],
  ['project-other', 'Project Atlas 的负责人是 Kai，截止日期是 11 月 2 日。', 'Kai owns this Atlas project, due November 2.'],
];

// Thirty-six distinct, short exchanges make the restart case fifty turns /
// one hundred visible messages while requiring only seven document batches.
const continuation = Array.from({ length: 36 }, (_, index) => {
  const label = String(index + 1).padStart(2, '0');
  return [`checkpoint-${label}`,
    `Conversation checkpoint ${label}: I filed archive card Cedar-${label} in drawer ${index + 1}.`,
    `Archive card Cedar-${label} is in drawer ${index + 1}.`];
});

export const baselineTurns = [
  ...[...primary, ...continuation].map(([id, user, assistant], index) => ({
    sessionId: 'primary', turnId: id, recordedAt: BASE_TIME + index * 60_000, user, assistant,
  })),
  ...secondary.map(([id, user, assistant], index) => ({
    sessionId: 'secondary', turnId: id, recordedAt: BASE_TIME + index * 60_000, user, assistant,
  })),
];

export const recallCases = [
  { id: 'en-paraphrase', category: 'semantic paraphrase / English', sessionId: 'primary',
    query: 'Where am I staying during my Japan holiday?', expected: 'tokyo:user' },
  { id: 'zh-paraphrase', category: 'semantic paraphrase / Chinese', sessionId: 'primary',
    query: '周五我准备看哪个展览？', expected: 'museum:user' },
  { id: 'mixed-paraphrase', category: 'semantic paraphrase / mixed', sessionId: 'primary',
    query: 'Atlas project 的 owner 和 deadline 是什么？', expected: 'project:user' },
  { id: 'cross-language', category: 'semantic paraphrase / cross-language', sessionId: 'primary',
    query: '我在东京旅行住的是哪家酒店？', expected: 'tokyo:user' },
  { id: 'direct-source', category: 'source-grounded recall', sessionId: 'primary',
    query: 'What is the exact Tokyo booking code?', expected: 'tokyo:user' },
  { id: 'secondary-isolation', category: 'session isolation', sessionId: 'secondary',
    query: 'Where is my Tokyo hotel?', expected: 'tokyo-other:user', forbidden: ['tokyo:user'] },
  { id: 'primary-isolation', category: 'session isolation', sessionId: 'primary',
    query: 'Who owns Project Atlas and when is it due?', expected: 'project:user', forbidden: ['project-other:user'] },
  { id: 'no-memory-submarine', category: 'no-memory queries', sessionId: 'primary',
    query: 'What is the serial number of my private submarine?', expected: null },
  { id: 'no-memory-medicine', category: 'no-memory queries', sessionId: 'secondary',
    query: 'Which medicine did my dentist prescribe yesterday?', expected: null },
];

export const correctionTurns = [
  { sessionId: 'correction', turnId: 'beijing', recordedAt: BASE_TIME,
    user: 'I live in Beijing.', assistant: 'You live in Beijing.' },
  { sessionId: 'correction', turnId: 'shanghai', recordedAt: BASE_TIME + 60_000,
    user: 'I moved to Shanghai.', assistant: 'You now live in Shanghai.', supersedesSourceId: 'beijing:user' },
  { sessionId: 'correction', turnId: 'shenzhen', recordedAt: BASE_TIME + 120_000,
    user: 'I moved to Shenzhen.', assistant: 'You now live in Shenzhen.', supersedesSourceId: 'shanghai:user' },
];

export const correctionQueries = {
  current: 'Where do I live now?',
  old: 'Where did I live before moving to Shanghai?',
  shanghai: 'Did I ever live in Shanghai?',
};

export const failureTurn = { sessionId: 'failure', turnId: 'failed', recordedAt: BASE_TIME,
  user: 'I store my hiking boots in the blue closet.',
  assistant: 'Your hiking boots are in the blue closet.' };
// The failure case isolates persistence/rebuild from semantic paraphrase quality.
export const failureQuery = failureTurn.user;

export const allEmbeddingInputs = {
  document: [...baselineTurns, ...correctionTurns, failureTurn].flatMap((turn) => [turn.user, turn.assistant]),
  query: [...recallCases.map((item) => item.query), ...Object.values(correctionQueries), failureQuery],
};

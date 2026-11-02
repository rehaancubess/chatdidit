export const TOPICS = [
  { id: 'anything', label: 'Anything Goes', description: 'A little bit of everything', icon: '🎲' },
  { id: 'gaming', label: 'Gaming', description: 'Boss-level bluffing', icon: '🎮' },
  { id: 'movies', label: 'Movies', description: 'Lights, camera, deception', icon: '🎬' },
  { id: 'weird', label: 'Weird Facts', description: 'Too strange to be true?', icon: '👀' },
  { id: 'history', label: 'History', description: 'The past gets suspicious', icon: '🏛️' },
  { id: 'science', label: 'Science', description: 'Put your theories to the test', icon: '🧪' },
] as const;
export type Topic = typeof TOPICS[number]['id'];
export type ContentTopic = Exclude<Topic, 'anything'>;
export function roundCapacity(mode: 'fact' | 'definition' | 'mixed', counts: { fact: number; definition: number }) {
  return Math.min(10, mode === 'mixed' ? Math.min(counts.fact * 2, counts.definition * 2 + 1) : counts[mode]);
}

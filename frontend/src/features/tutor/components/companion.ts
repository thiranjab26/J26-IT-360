import type { Session } from '../api/sessionApi';
import type { Mood } from './Mascot';

export interface Say {
  mood: Mood;
  text: string;
}

const CHEERS = [
  'Nailed it!',
  'Yes! That is exactly right.',
  'Sharp thinking. Keep going!',
  'Boom. Another one down.',
  'You are on a roll!',
];

const MISSES = [
  'Close one. Read the question once more.',
  'Not quite, but every miss teaches something.',
  'Hmm, so near. Look at the hint if you have one.',
];

/**
 * What Byte says, chosen from where the student is. Pure and deterministic (it rotates by the
 * step number, not by chance), so the same screen always gets the same line and a re-render
 * never changes the words under someone's eyes.
 */
export function companionSays(session: Session, combo: number): Say {
  const pick = (lines: string[]) => lines[session.position.step_number % lines.length] ?? lines[0]!;
  const feedback = session.feedback;

  switch (session.phase) {
    case 'hook':
      return { mood: 'idle', text: `Ready? Let us get into ${session.concept_title}.` };
    case 'teach':
      return {
        mood: 'think',
        text:
          session.position.step_number <= 1
            ? 'Read this through. I will quiz you right after.'
            : 'Good pace. Take your time with this part.',
      };
    case 'checkpoint':
      if (session.question?.hint) {
        return { mood: 'think', text: 'Here is a hint. Use it well.' };
      }
      return {
        mood: 'idle',
        text: session.question?.gating ? 'Checkpoint time. Show me what you know!' : 'A quick one, no pressure.',
      };
    case 'feedback':
      if (feedback?.outcome === 'correct') {
        return {
          mood: 'cheer',
          text: combo >= 3 ? `${combo} in a row! You are on fire!` : pick(CHEERS),
        };
      }
      if (feedback?.outcome === 'unreadable') {
        return { mood: 'think', text: 'I could not read that one. It cost you no try.' };
      }
      return { mood: 'oops', text: pick(MISSES) };
    case 'reteach':
      return { mood: 'think', text: 'Let me explain it another way. Then you try again.' };
    case 'ended': {
      const good = ['completed', 'mastery_satisfied'].includes(session.summary?.exit_reason ?? '');
      return good
        ? { mood: 'cheer', text: 'Level cleared! Look at what you earned.' }
        : { mood: 'idle', text: 'Rest a moment. I will be here when you are ready.' };
    }
    default:
      return { mood: 'idle', text: 'Let us keep going.' };
  }
}

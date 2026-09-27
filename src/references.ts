import { memeReferences } from './meme-references';

const poseReferences = [
  {
    title: 'A little closer',
    category: 'Couple',
    prompt: 'Lean your heads toward the middle. Find each other in the frame.',
  },
  {
    title: 'Peace & love',
    category: 'Cute',
    prompt: 'Two peace signs, two big smiles. A photo booth classic.',
  },
  {
    title: 'Two halves',
    category: 'Couple',
    prompt: 'Each make half a heart. Meet your hands in the middle.',
  },
  {
    title: 'Plot twist',
    category: 'Reaction',
    prompt: 'You just heard the most unbelievable news. Show us your faces.',
  },
  {
    title: 'Movie poster',
    category: 'Cinematic',
    prompt: 'Turn away from each other, look at the camera, and get dramatic.',
  },
  {
    title: 'Absolutely unserious',
    category: 'Funny',
    prompt: 'Your silliest face. No warning your partner what it will be.',
  },
  {
    title: 'Caught laughing',
    category: 'Cute',
    prompt: 'Look toward each other. Try making your partner laugh first.',
  },
  {
    title: 'Main character energy',
    category: 'Chaotic',
    prompt: 'Arms up. Celebrate something tiny like it is the best news ever.',
  },
];

export const references: Array<{
  title: string;
  category: string;
  prompt: string;
  memeImage?: string;
  memeSource?: string;
}> = [...poseReferences, ...memeReferences];

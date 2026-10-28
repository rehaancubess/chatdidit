export type GameMode = 'fact' | 'definition';
export interface Question {
  id: string;
  factId: string;
  mode: GameMode;
  prompt: string;
  category: string;
  answer: string;
  aliases: string[];
  explanation: string;
  sourceUrl: string;
  fillers: string[];
}

const definition = (
  word: string,
  answer: string,
  fillers: string[],
  explanation?: string,
): Question => ({
  id: `word-${word}`,
  factId: `definition:${word}`,
  mode: 'definition',
  prompt: `What does “${word}” mean?`,
  category: 'Strange words',
  answer,
  aliases: [answer],
  explanation: explanation || `“${word}” is a real word. ${answer}.`,
  sourceUrl: `https://www.merriam-webster.com/dictionary/${word}`,
  fillers,
});

/** Curated seed bank. Source URLs are supporting evidence, not model-generated citations.
 * Never silently recycle this bank: exhaustion asks the host to choose another mode.
 * New generated questions require editorial/source verification before insertion here.
 */
export const QUESTIONS: Question[] = [
  {
    id: 'bubble-wrap-wallpaper',
    factId: 'invention:bubble-wrap:wallpaper',
    mode: 'fact',
    prompt: 'What was Bubble Wrap originally invented to be?',
    category: 'Weird inventions',
    answer: 'Textured wallpaper',
    aliases: ['wallpaper', 'plastic wallpaper', '3d wallpaper', 'textured wallpaper'],
    explanation:
      'In 1957, Alfred Fielding and Marc Chavannes set out to make textured wallpaper. Their invention eventually became protective packaging.',
    sourceUrl: 'https://www.sealedair.com/products/brand/bubble-wrap',
    fillers: [
      'Greenhouse insulation',
      'A shower curtain',
      'A swimming pool cover',
      'Soundproof recording panels',
      'A reusable ice pack',
    ],
  },
  {
    id: 'venus-rotation',
    factId: 'astronomy:venus:rotation',
    mode: 'fact',
    prompt: 'Which planet takes longer to spin once than to orbit the Sun?',
    category: 'Space oddities',
    answer: 'Venus',
    aliases: ['venus'],
    explanation:
      'Venus takes about 243 Earth days to rotate once and about 225 Earth days to orbit the Sun.',
    sourceUrl: 'https://science.nasa.gov/venus/venus-facts/',
    fillers: ['Mercury', 'Neptune', 'Mars', 'Jupiter', 'Saturn'],
  },
  {
    id: 'first-webcam-coffee',
    factId: 'internet:first-webcam:coffee-pot',
    mode: 'fact',
    prompt: 'What did the world’s first webcam watch?',
    category: 'Internet archaeology',
    answer: 'A coffee pot',
    aliases: [
      'coffee',
      'coffee pot',
      'a coffee pot',
      'coffee machine',
      'a coffee machine',
      'the coffee pot',
    ],
    explanation:
      'Cambridge researchers pointed a camera at their coffee pot to check whether coffee was available. The system went on the web in 1993.',
    sourceUrl: 'https://www.cl.cam.ac.uk/coffee/qsf/timeline.html',
    fillers: [
      'A university fish tank',
      'A computer server’s warning light',
      'A sleeping laboratory cat',
      'A vending machine',
      'The entrance to a bank vault',
    ],
  },
  {
    id: 'nintendo-first-product',
    factId: 'gaming:nintendo:first-product:hanafuda',
    mode: 'fact',
    prompt: 'What did Nintendo sell when it began in 1889?',
    category: 'Gaming history',
    answer: 'Japanese playing cards',
    aliases: [
      'playing cards',
      'cards',
      'hanafuda',
      'hanafuda cards',
      'japanese cards',
      'japanese playing cards',
      'flower cards',
    ],
    explanation:
      'Long before Mario, Nintendo’s first product was Hanafuda: flower-themed Japanese playing cards.',
    sourceUrl:
      'https://www.nintendo.com/en-gb/News/2021/August/Revisit-Nintendo-s-roots-with-Hanafuda-2019412.html',
    fillers: [
      'Hand-painted kites',
      'Mechanical fortune tellers',
      'Wooden spinning tops',
      'Bicycle bells',
      'Pocket-sized puppet theaters',
    ],
  },
  {
    id: 'velcro-burdock',
    factId: 'invention:hook-and-loop:burdock',
    mode: 'fact',
    prompt: 'What everyday annoyance inspired the invention of VELCRO fasteners?',
    category: 'Nature-inspired design',
    answer: 'Burrs sticking to clothing and dog fur',
    aliases: [
      'burrs',
      'burdock',
      'burdock burrs',
      'burrs on his dog',
      'burrs stuck to clothes',
      'burrs sticking to clothing and dog fur',
    ],
    explanation:
      'George de Mestral examined burdock burrs caught on his clothes and his dog. Their tiny hooks inspired a reusable hook-and-loop fastener.',
    sourceUrl:
      'https://www.velcro.com/news-and-blog/2026/02/an-idea-that-stuck-how-george-de-mestral-invented-the-velcro-fastener/',
    fillers: [
      'A zipper snagging a sweater',
      'Spider webs across a doorway',
      'Wet socks clinging together',
      'Buttons falling off army coats',
      'A shoelace caught in a bicycle chain',
    ],
  },
  {
    id: 'scotland-unicorn',
    factId: 'culture:scotland:national-animal',
    mode: 'fact',
    prompt: 'What is Scotland’s national animal?',
    category: 'Unexpected traditions',
    answer: 'A unicorn',
    aliases: ['unicorn', 'a unicorn', 'the unicorn'],
    explanation:
      'Scotland’s national animal is the unicorn, a mythical creature with a long place in Scottish heraldry.',
    sourceUrl: 'https://www.rct.uk/resources/unicorns',
    fillers: ['A red deer', 'A golden eagle', 'A Highland cow', 'A wildcat', 'A dragon'],
  },
  {
    id: 'eiffel-summer',
    factId: 'engineering:eiffel:thermal-expansion',
    mode: 'fact',
    prompt: 'What happens to the Eiffel Tower’s iron structure when it gets hotter?',
    category: 'Everyday science',
    answer: 'It expands',
    aliases: ['expands', 'it expands', 'grows', 'it gets bigger', 'gets taller', 'it gets taller'],
    explanation:
      'Iron expands when heated. The Eiffel Tower changes size slightly as its temperature changes.',
    sourceUrl:
      'https://www.toureiffel.paris/en/news/history-and-culture/why-does-eiffel-tower-change-size',
    fillers: [
      'It contracts',
      'It becomes magnetic',
      'It loses mass',
      'It absorbs sound',
      'It produces an electric charge',
    ],
  },
  {
    id: 'michelin-guide-tires',
    factId: 'marketing:michelin-guide:tire-sales',
    mode: 'fact',
    prompt: 'Why did a tire company create the Michelin Guide?',
    category: 'Marketing gone weird',
    answer: 'To encourage driving and sell more tires',
    aliases: [
      'sell tires',
      'sell tyres',
      'to sell tires',
      'to sell tyres',
      'tire sales',
      'tyre sales',
      'to encourage driving and sell more tires',
    ],
    explanation:
      'The Michelin brothers gave motorists useful travel information to encourage road trips, boosting car use and, in turn, tire purchases.',
    sourceUrl: 'https://guide.michelin.com/us/en/about-us',
    fillers: [
      'To recruit chefs for a company cafeteria',
      'To help salesmen avoid expensive meals',
      'To test whether rubber affected taste',
      'To settle a bet between rival restaurant owners',
      'To keep factory workers busy during winter',
    ],
  },
  {
    id: 'playdoh-wallpaper-cleaner',
    factId: 'invention:play-doh:wallpaper-cleaner',
    mode: 'fact',
    prompt: 'Before it became a toy, what was Play-Doh developed to do?',
    category: 'Accidental inventions',
    answer: 'Clean wallpaper',
    aliases: [
      'wallpaper cleaner',
      'clean wallpaper',
      'cleaning wallpaper',
      'wall cleaner',
      'clean walls',
    ],
    explanation:
      'Play-Doh began as a wallpaper-cleaning compound before becoming a reusable modeling material for children.',
    sourceUrl:
      'https://newsroom.hasbro.com/news-releases/news-release-details/hasbro-and-horizon-group-usa-sign-strategic-play-doh-licensing',
    fillers: [
      'Seal windows against winter drafts',
      'Remove fingerprints from photographs',
      'Patch bicycle tires',
      'Make molds for false teeth',
      'Polish antique silver',
    ],
  },
  {
    id: 'postit-yellow-scrap',
    factId: 'invention:post-it:yellow-paper',
    mode: 'fact',
    prompt: 'Why were the original Post-it Notes yellow?',
    category: 'Office oddities',
    answer: 'A nearby lab had scrap yellow paper',
    aliases: [
      'scrap yellow paper',
      'yellow scrap paper',
      'spare yellow paper',
      'leftover yellow paper',
      'a nearby lab had scrap yellow paper',
    ],
    explanation:
      'The color was a happy accident: a neighboring laboratory had scrap yellow paper available when the notes were being developed.',
    sourceUrl: 'https://www.post-it.com/3M/en_US/post-it/contact-us/about-us/',
    fillers: [
      'Yellow pigment made the glue dry faster',
      'The inventor wanted to match a phone book',
      'White notes were mistaken for official documents',
      'A safety rule required warning-yellow stationery',
      'A marketing survey picked the happiest color',
    ],
  },
  definition('aglet', 'The covering on the end of a lace', [
    'A tiny musical instrument',
    'The groove beneath your nose',
    'A young eagle',
    'A decorative door hinge',
    'A knot used by sailors',
  ]),
  definition('petrichor', 'The earthy smell associated with rain', [
    'A fear of stepping on stones',
    'A mineral inside a cave',
    'A type of ancient poetry',
    'The sound of distant thunder',
    'A cloud shaped like a feather',
  ]),
  definition('tittle', 'A small written mark, such as the dot over an i', [
    'A small argument about money',
    'A hat worn by a judge',
    'A tiny bell on a bicycle',
    'A title given to an apprentice',
    'A narrow alley between houses',
  ]),
  definition('defenestration', 'Throwing something out of a window', [
    'Removing the feathers from a bird',
    'Falling asleep during an argument',
    'Removing a fence',
    'Forgetting why you entered a room',
    'Repairing a broken doorway',
  ]),
  definition('borborygmus', 'A rumbling sound in the intestines', [
    'An unusually long eyebrow',
    'A fear of garden gnomes',
    'An ancient form of wrestling',
    'A bubble trapped in glass',
    'The sound of a loose floorboard',
  ]),
  definition('crepuscular', 'Relating to twilight', [
    'Covered in tiny scales',
    'Moving in a spiral',
    'Having a brittle shell',
    'Growing beneath the sea',
    'Producing a high-pitched noise',
  ]),
  definition('zugzwang', 'A chess position where having to move is a disadvantage', [
    'A dance performed in a circle',
    'A railway running up a mountain',
    'A sudden change in wind',
    'A very narrow victory',
    'A joke that loses its meaning in translation',
  ]),
  definition('velleity', 'A wish too weak to lead to action', [
    'The urge to rearrange furniture',
    'A feeling of being watched',
    'A velvet ribbon on a hat',
    'A sudden burst of inspiration',
    'The habit of collecting receipts',
  ]),
  definition('liminal', 'Relating to a threshold or transitional state', [
    'Glowing faintly in the dark',
    'Occurring only once a year',
    'Easily dissolved in water',
    'Having unusually small leaves',
    'Perfectly balanced on one point',
  ]),
  definition('obelus', 'A mark shaped like a short horizontal line, used in ancient manuscripts', [
    'A small ceremonial drum',
    'A curved roof tile',
    'A hidden door in a library',
    'A short poem about winter',
    'A belt worn over armor',
  ]),
];

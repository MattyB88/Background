// Static data shared by the launcher and the UI: AI providers, personality presets, worlds.

export const MC_VERSION = '1.21.1';
export const NEOFORGE_VERSION = '21.1.252';
// Pinned so an upstream change can't break a working setup. Bump deliberately.
export const MINDCRAFT_REF = '5f3acc87b479864124173de444f31fa5538f94a6';

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)', key: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    note: 'Opus 5 is the smartest; Sonnet 5 and Haiku 4.5 are cheaper and faster.',
  },
  openai: {
    label: 'OpenAI (GPT)', key: 'OPENAI_API_KEY', keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5.4', 'gpt-5-mini'],
  },
  google: {
    label: 'Google (Gemini)', key: 'GEMINI_API_KEY', keyUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-flash-latest', 'gemini-2.5-pro'], note: 'Gemini has a free tier - good for trying things out.',
  },
  xai: { label: 'xAI (Grok)', key: 'XAI_API_KEY', keyUrl: 'https://console.x.ai', models: ['grok-4-fast-reasoning'] },
  deepseek: { label: 'DeepSeek', key: 'DEEPSEEK_API_KEY', keyUrl: 'https://platform.deepseek.com/api_keys', models: ['deepseek-chat'] },
  mistral: { label: 'Mistral', key: 'MISTRAL_API_KEY', keyUrl: 'https://console.mistral.ai/api-keys', models: ['mistral-large-latest'] },
  groq: { label: 'Groq', key: 'GROQCLOUD_API_KEY', keyUrl: 'https://console.groq.com/keys', models: ['llama-3.3-70b-versatile'] },
  openrouter: { label: 'OpenRouter', key: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys', models: ['anthropic/claude-sonnet-5'] },
  ollama: {
    label: 'Ollama (free, runs on your PC)', key: null, keyUrl: 'https://ollama.com/download',
    models: ['sweaterdog/andy-4:micro-q8_0', 'llama3.1'], note: 'No key needed. Install Ollama and pull the model first. Needs a good GPU.',
  },
};

// Behaviour toggles map 1:1 onto Mindcraft "modes".
export const MODES = {
  self_defense: 'Fights back when attacked',
  hunting: 'Hunts animals for food',
  item_collecting: 'Picks up nearby items',
  torch_placing: 'Places torches in the dark',
  cowardice: 'Runs away from danger',
  self_preservation: 'Avoids lava, drowning and fire',
  unstuck: 'Gets itself unstuck',
  elbow_room: 'Gives players personal space',
  idle_staring: 'Looks around when idle',
  cheat: 'Cheat mode (uses commands to build instantly)',
};

export const DEFAULT_MODES = {
  self_defense: true, hunting: true, item_collecting: true, torch_placing: true, cowardice: false,
  self_preservation: true, unstuck: true, elbow_room: true, idle_staring: true, cheat: false,
};

export const PRESETS = [
  { id: 'buddy', emoji: '🤝', label: 'Helpful Buddy', color: '#4ade80',
    text: 'You are a kind, upbeat best friend. You follow the players around, help with whatever they are doing, share your stuff, and cheer them on. You keep everyone safe from mobs.' },
  { id: 'knight', emoji: '🛡️', label: 'Brave Knight', color: '#60a5fa',
    text: 'You are a brave and noble knight who protects the players. You speak a little like a knight ("Fear not, friend!"). You stay close, fight monsters, craft good armour and weapons, and escort players on adventures.' },
  { id: 'builder', emoji: '🏰', label: 'Master Builder', color: '#f59e0b',
    text: 'You are a creative master builder. You love designing houses, towers, farms and bridges. You help players build, suggest cool ideas, and gather the blocks you need.' },
  { id: 'farmer', emoji: '🌾', label: 'Happy Farmer', color: '#a3e635',
    text: 'You are a cheerful farmer. You make sure everyone always has food: you plant crops, breed animals, cook food, and hand out snacks. You love animals and give them silly names.' },
  { id: 'explorer', emoji: '🧭', label: 'Explorer', color: '#22d3ee',
    text: 'You are a curious explorer who loves caves, villages and treasure. You scout ahead, find diamonds and cool places, and lead the players there. You describe what you find with excitement.' },
  { id: 'wizard', emoji: '🔮', label: 'Wise Wizard', color: '#c084fc',
    text: 'You are a wise, friendly wizard who knows everything about Minecraft. You teach tips and recipes, answer questions patiently, and brew potions and enchant gear for the players.' },
  { id: 'joker', emoji: '🤪', label: 'Funny Joker', color: '#f472b6',
    text: 'You are a goofy, funny friend who tells jokes and puns and makes everyone laugh, while still being genuinely helpful and useful.' },
];

export const SPEEDS = {
  fast: { label: 'Fast (quick replies)', effort: 'low' },
  balanced: { label: 'Balanced', effort: 'medium' },
  smart: { label: 'Smartest (slower)', effort: 'high' },
};

export const WORLDS = {
  buddy: {
    label: 'Buddy World', emoji: '🤖',
    blurb: 'Survival world where your AI friends can join. Vanilla-compatible with speed-up mods. JEI, Jade, Just Zoom and Durability Tooltip still work from your CurseForge "magic" profile.',
    ai: true,
    // Server-side only Fabric mods: they make the server faster without clients needing them.
    mods: ['fabric-api', 'lithium', 'ferrite-core'],
  },
  magic: {
    label: 'Magic World', emoji: '✨',
    blurb: `Your son's "magic" modpack (NeoForge ${NEOFORGE_VERSION}) with Ars Nouveau. Join with the CurseForge "magic" profile. AI friends cannot join modded worlds yet (a Mindcraft limit).`,
    ai: false,
    // Mods that must also exist on the server. Just Zoom and Durability Tooltip are client-only.
    mods: ['ars-nouveau', 'curios', 'geckolib', 'jade', 'jei'],
  },
};

// Voices: the control panel speaks each AI friend's chat out loud with ElevenLabs.
export const VOICE = {
  label: 'ElevenLabs (voices)', key: 'ELEVENLABS_API_KEY', keyUrl: 'https://elevenlabs.io/app/developers/api-keys',
  note: 'When creating the key, give it Access to "Text to Speech" (and Read for "Voices" to list your own voices).',
  model: 'eleven_flash_v2_5',
};

// ElevenLabs premade voices, used when the key can't list the account's voices.
export const DEFAULT_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (deep, friendly)' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (young, upbeat)' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (warm)' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (tough)' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam (raspy)' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (calm)' },
  { id: 'EXAVITQu4vr4xnVAvJFX', name: 'Bella (soft)' },
  { id: 'MF3mGyEYCl7XYWbV9V5O', name: 'Elli (bright)' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (bold)' },
];

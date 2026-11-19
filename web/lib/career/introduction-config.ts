import { createHash } from 'node:crypto';

const WORK_SUMMARY_VERSION = 'work-summary-v1';
const INTRO_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type IntroProvider = (typeof INTRO_PROVIDERS)[number];
const settings = {
  openai: {
    label: 'OpenAI',
    key: 'OPENAI_API_KEY',
    env: 'CAREERFLOW_INTRO_OPENAI_MODEL',
    model: 'gpt-6-luna',
  },
  anthropic: {
    label: 'Claude',
    key: 'ANTHROPIC_API_KEY',
    env: 'CAREERFLOW_INTRO_ANTHROPIC_MODEL',
    model: 'claude-haiku-5-5',
  },
  google: {
    label: 'Gemini',
    key: 'GOOGLE_GENERATIVE_AI_API_KEY',
    env: 'CAREERFLOW_INTRO_GOOGLE_MODEL',
    model: 'gemini-3.8-flash',
  },
};
export function introductionProvider() {
  const selected = process.env.CAREERFLOW_INTRO_PROVIDER || 'google';
  const id = INTRO_PROVIDERS.find((provider) => provider === selected);
  if (!id) return undefined;
  const { label, key, env, model } = settings[id];
  return {
    id,
    label,
    model: process.env[env] || model,
    keyName: key,
    configured: Boolean(process.env[key]),
  };
}

export function introFingerprint(
  text: string,
  provider: IntroProvider,
  model: string,
) {
  return createHash('sha256')
    .update(JSON.stringify([WORK_SUMMARY_VERSION, text, provider, model]))
    .digest('hex');
}

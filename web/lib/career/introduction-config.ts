import { createHash } from 'node:crypto';

const INTRO_VERSION = 'intro-evidence-v1';
const WORK_SUMMARY_VERSION = 'work-summary-v1';
export const INTRO_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
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
export function introductionProviders() {
  return INTRO_PROVIDERS.map((id) => ({
    id,
    label: settings[id].label,
    model: process.env[settings[id].env] || settings[id].model,
    configured: process.env.NODE_ENV !== 'production' && Boolean(process.env[settings[id].key]),
    keyName: settings[id].key,
  }));
}
export function introFingerprint(
  text: string,
  provider: IntroProvider,
  model: string,
  kind: 'comparison' | 'work-summary' = 'comparison',
) {
  const version =
    kind === 'work-summary' ? WORK_SUMMARY_VERSION : INTRO_VERSION;
  return createHash('sha256')
    .update(JSON.stringify([version, text, provider, model]))
    .digest('hex');
}

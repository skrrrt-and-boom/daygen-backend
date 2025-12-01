export interface ProviderRouteConfig {
    defaultModel: string;
    allowedModels?: Set<string>;
    allowInline?: boolean;
}

const FLUX_MODELS = new Set(['flux.2']);

const RUNWAY_MODELS = new Set(['runway-gen4', 'runway-gen4-turbo']);
const RECRAFT_MODELS = new Set(['recraft-v3', 'recraft-v2']);
const LUMA_MODELS = new Set([
    'luma-photon-1',
    'luma-photon-flash-1',
    'luma-dream-shaper',
    'luma-realistic-vision',
]);
const GROK_MODELS = new Set([
    'grok-2-image',
    'grok-2-image-1212',
    'grok-2-image-latest',
]);

export const PROVIDER_ROUTES: Record<string, ProviderRouteConfig> = {
    gemini: {
        defaultModel: 'gemini-3.0-pro-image',
        allowedModels: new Set([
            'gemini-3-pro-image-preview',
            'gemini-3.0-pro-image',
            'gemini-3.0-pro',
            'gemini-3.0-pro-exp-01',
            'gemini-3-pro-image-preview',
            'gemini-3-pro-image',
            'gemini-2.5-flash-image',
            'imagen-4.0-generate-001',
            'imagen-4.0-fast-generate-001',
            'imagen-4.0-ultra-generate-001',
            'imagen-3.0-generate-002',
        ]),
        allowInline: true,
    },
    flux: {
        defaultModel: 'flux.2',
        allowedModels: FLUX_MODELS,
    },
    chatgpt: {
        defaultModel: 'chatgpt-image',
    },
    ideogram: {
        defaultModel: 'ideogram',
    },
    qwen: {
        defaultModel: 'qwen-image',
    },
    grok: {
        defaultModel: 'grok-2-image',
        allowedModels: GROK_MODELS,
    },
    runway: {
        defaultModel: 'runway-gen4',
        allowedModels: RUNWAY_MODELS,
    },
    seedream: {
        defaultModel: 'seedream-3.0',
    },
    reve: {
        defaultModel: 'reve-image',
    },
    recraft: {
        defaultModel: 'recraft-v3',
        allowedModels: RECRAFT_MODELS,
    },
    luma: {
        defaultModel: 'luma-photon-1',
        allowedModels: LUMA_MODELS,
    },
};

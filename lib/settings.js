// Settings helpers for LoreVeil. Pure and DOM-free.
import { DEFAULT_TAG, normalizeTagList, markerPair } from './scan-exclusion.js';

export const SETTINGS_KEY = 'loreVeil';
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    tags: DEFAULT_TAG,
    markers: true,
    attribute: true,
    debug: false,
});

/** Fill missing/ill-typed keys of store[SETTINGS_KEY] from defaults; returns the live object. */
export function loadSettings(store) {
    let s = store[SETTINGS_KEY];
    if (!s || typeof s !== 'object') s = store[SETTINGS_KEY] = {};
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (typeof s[k] !== typeof v) s[k] = v;
    }
    return s;
}

/** Masker options from settings; falls back to the default tag when none is valid. */
export function resolveMaskOptions(settings) {
    const { tags, invalid } = normalizeTagList(settings.tags);
    const fallback = tags.length === 0;
    return {
        options: {
            tags: fallback ? [DEFAULT_TAG] : tags,
            markers: settings.markers !== false,
            attribute: settings.attribute !== false,
        },
        invalid,
        fallback,
    };
}

/** Render blanked spaces visibly: every run of masking spaces that differs from the original becomes a middle dot. */
export function visualizeBlanks(original, masked) {
    if (original === masked) return masked;
    if (masked === '') return '·'.repeat(original.length);
    let out = '';
    for (let i = 0; i < masked.length; i++) {
        out += masked[i] === ' ' && original[i] !== ' ' ? '·' : masked[i];
    }
    return out;
}

/** Usage examples for the given (already normalized) tags. */
export function buildExamples(tags) {
    return tags.map((tag) => {
        const [start, end] = markerPair(tag);
        return {
            tag,
            element: `<${tag}>...</${tag}>`,
            marker: `${start} ... ${end}`,
            attribute: `<div ${tag}>...</div>`,
        };
    });
}

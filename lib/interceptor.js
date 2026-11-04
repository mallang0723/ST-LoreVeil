// One-shot coreChat.map override for SillyTavern's World Info scan. Pure, DOM-free,
// dependency-injected. Contract: DESIGN.md section 2.1.
import { createScanExclusionMasker } from './scan-exclusion.js';
import { resolveMaskOptions } from './settings.js';

// ST's chatForWI callback references this variable; ST serves script.js unminified.
export const WI_MAPPER_TOKEN = 'world_info_include_names';

/**
 * deps: { getSettings: () => settings, eventSource, eventTypes, log?: (...a) => void }
 * Returns { interceptor, clearPending, hasPending, attach, detach }.
 */
export function createInterceptor(deps) {
    const { getSettings, eventSource, eventTypes } = deps;
    const log = deps.log || ((...a) => console.debug(...a));
    let pending = null; // the chat array carrying our own `map`
    let cachedKey = null;
    let cachedMasker = null;

    function masker(settings) {
        const { options } = resolveMaskOptions(settings);
        const key = JSON.stringify(options);
        if (key !== cachedKey) {
            cachedMasker = createScanExclusionMasker(options);
            cachedKey = key;
        }
        return cachedMasker;
    }

    function clearPending() {
        if (pending) {
            if (Object.hasOwn(pending, 'map')) delete pending.map;
            pending = null;
        }
    }

    async function interceptor(chat, _contextSize, _abort, _type) {
        clearPending();
        const settings = getSettings();
        if (!settings || !settings.enabled || !Array.isArray(chat)) return;
        const mask = masker(settings);
        let count = 0;
        // Array.prototype.map explicitly: never touches item.mes of the real array.
        const maskedView = Array.prototype.map.call(chat, (item) => {
            if (!item || typeof item.mes !== 'string') return item;
            const m = mask(item.mes);
            if (m === item.mes) return item;
            count++;
            return { ...item, mes: m };
        });
        if (count === 0) return;
        const debug = !!settings.debug;
        Object.defineProperty(chat, 'map', {
            configurable: true,
            writable: true,
            enumerable: false,
            value: function (fn, thisArg) {
                // Only ST's WI mapper (script.js chatForWI) gets the masked view; any other
                // caller (e.g. a later interceptor) maps the real array and keeps the override.
                if (typeof fn !== 'function' || !String(fn).includes(WI_MAPPER_TOKEN)) {
                    return Array.prototype.map.call(chat, fn, thisArg);
                }
                delete chat.map;
                if (pending === chat) pending = null;
                if (debug) log('[LoreVeil] masked view consumed by WI scan');
                return Array.prototype.map.call(maskedView, fn, thisArg);
            },
        });
        pending = chat;
        if (debug) log(`[LoreVeil] masked ${count} message(s) for WI scan`);
    }

    const events = () => [eventTypes.WORLDINFO_ENTRIES_LOADED, eventTypes.GENERATION_ENDED, eventTypes.GENERATION_STOPPED];
    function attach() { for (const e of events()) eventSource.on(e, clearPending); }
    function detach() { for (const e of events()) eventSource.removeListener(e, clearPending); }

    return { interceptor, clearPending, hasPending: () => pending !== null, attach, detach };
}

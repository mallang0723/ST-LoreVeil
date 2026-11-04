// LoreVeil: hides marked text from World Info keyword scanning only.
// Imports only this extension's own files; everything from ST via SillyTavern.getContext().
import { DEFAULT_TAG, normalizeTagList, createScanExclusionMasker } from './lib/scan-exclusion.js';
import { loadSettings, resolveMaskOptions, visualizeBlanks, buildExamples } from './lib/settings.js';
import { createInterceptor } from './lib/interceptor.js';

const ctx = SillyTavern.getContext();
const { eventSource, eventTypes, saveSettingsDebounced } = ctx;
const settings = loadSettings(ctx.extensionSettings);

const core = createInterceptor({ getSettings: () => settings, eventSource, eventTypes });
core.attach();
globalThis.loreVeilInterceptor = core.interceptor;

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node[k] = v;
    }
    for (const c of children) node.append(c);
    return node;
}

function checkbox(label, key, onChange) {
    const input = el('input', { type: 'checkbox', checked: !!settings[key] });
    input.addEventListener('change', () => {
        settings[key] = input.checked;
        saveSettingsDebounced();
        onChange?.();
    });
    return el('label', { class: 'checkbox_label' }, input, el('span', { text: label }));
}

function buildPanel() {
    const root = el('div', { class: 'loreveil_settings' });
    const drawer = el('div', { class: 'inline-drawer' });
    const header = el('div', { class: 'inline-drawer-toggle inline-drawer-header' },
        el('b', { text: 'LoreVeil (월드인포 스캔 제외)' }),
        el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }));
    const content = el('div', { class: 'inline-drawer-content' });

    const tagInput = el('input', { type: 'text', class: 'text_pole', value: settings.tags, placeholder: DEFAULT_TAG });
    const resetBtn = el('input', { type: 'button', class: 'menu_button', value: '기본값으로' });
    const invalidBox = el('div', { class: 'loreveil_invalid' });
    const markerLine = el('div', { class: 'loreveil_example' });
    const attrLine = el('div', { class: 'loreveil_example' });
    const examples = el('pre', { class: 'loreveil_pre' });
    const testInput = el('textarea', { class: 'text_pole', rows: 4, placeholder: '여기에 메시지를 붙여 넣으면 WI 스캔이 보는 모습을 보여줍니다.' });
    const testOut = el('pre', { class: 'loreveil_pre' });

    function refresh() {
        const { options, invalid, fallback } = resolveMaskOptions(settings);
        invalidBox.textContent = '';
        if (invalid.length) invalidBox.append(el('div', { text: `사용할 수 없는 이름: ${invalid.join(', ')}` }));
        if (fallback) invalidBox.append(el('div', { text: `유효한 이름이 없어 기본값(${DEFAULT_TAG})을 사용합니다.` }));
        const ex = buildExamples(options.tags);
        markerLine.textContent = settings.markers ? `마커: ${ex.map((e) => e.marker).join('   |   ')}` : '마커 형식 꺼짐';
        attrLine.textContent = settings.attribute ? `속성: ${ex.map((e) => e.attribute).join('   |   ')}` : '속성 형식 꺼짐';
        examples.textContent = ex.map((e) => [e.element, settings.markers && e.marker, settings.attribute && e.attribute].filter(Boolean).join('\n')).join('\n\n');
        const text = testInput.value;
        const masked = createScanExclusionMasker(options)(text);
        testOut.textContent = visualizeBlanks(text, masked);
    }

    tagInput.addEventListener('input', () => {
        settings.tags = tagInput.value;
        saveSettingsDebounced();
        refresh();
    });
    resetBtn.addEventListener('click', () => {
        settings.tags = DEFAULT_TAG;
        tagInput.value = DEFAULT_TAG;
        saveSettingsDebounced();
        refresh();
    });
    testInput.addEventListener('input', refresh);

    content.append(
        checkbox('사용', 'enabled'),
        el('label', { text: '감쌀 명령어(태그 이름)' }),
        el('small', { text: '쉼표로 여러 개 지정할 수 있습니다. 기본값: st-loreveil' }),
        el('div', { class: 'loreveil_row' }, tagInput, resetBtn),
        invalidBox,
        checkbox('마커 형식 사용', 'markers', refresh),
        markerLine,
        checkbox('속성 형식 사용', 'attribute', refresh),
        attrLine,
        el('label', { text: '사용 예시' }),
        examples,
        el('label', { text: '테스트 (빈칸은 · 로 표시)' }),
        testInput,
        testOut,
        checkbox('디버그 로그', 'debug'),
    );
    drawer.append(header, content);
    root.append(drawer);
    refresh();
    return root;
}

function mount() {
    const host = document.getElementById('extensions_settings2');
    if (!host || host.querySelector('.loreveil_settings')) return;
    host.append(buildPanel());
}

mount();
if (!document.querySelector('.loreveil_settings')) eventSource.on(eventTypes.APP_READY, mount);

#!/usr/bin/env node
// Real-SillyTavern end-to-end harness for the LoreVeil extension.
// Usage: ST_DIR=/path/to/SillyTavern node tests/e2e/run-e2e.mjs   (see README.md)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock, MOCK_REPLY } from './mock-openai.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const EXT_FILES = ['manifest.json', 'index.js', 'style.css', 'lib']; // install root files only (no tests/, README, .git)
const ST_DIR = process.env.ST_DIR && path.resolve(process.env.ST_DIR);
const EXT_NAME = process.env.EXT_NAME || 'lv-e2e-ext'; // deliberately not "loreveil"
const KEEP = process.env.KEEP_WORKDIR === '1';
const BOOK = 'e2e-book';
const MARKER = 'MIRA_LORE_MARKER';

if (!ST_DIR || !fs.existsSync(path.join(ST_DIR, 'server.js')) || !fs.existsSync(path.join(ST_DIR, 'node_modules'))) {
    console.error('Set ST_DIR to a SillyTavern checkout with node_modules installed (npm ci --omit=dev).');
    process.exit(2);
}

function loadPlaywright() {
    const req = createRequire(import.meta.url);
    const cands = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean);
    for (const c of cands) { try { return req(c); } catch { /* next */ } }
    console.error('playwright module not found (set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright).');
    process.exit(2);
}
const { chromium } = loadPlaywright();

const results = [];
const record = (id, name, ok, evidence) => {
    results.push({ id, name, ok, evidence });
    console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${name}\n      ${String(evidence).replace(/\n/g, '\n      ')}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const promptText = (reqBody) => (reqBody?.messages || []).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n----\n');
const excerpt = (text, needle, w = 60) => { const i = text.indexOf(needle); return i < 0 ? `(not found: ${needle})` : '…' + text.slice(Math.max(0, i - w), i + needle.length + w).replace(/\n/g, '\\n') + '…'; };

async function freePort() {
    const net = await import('node:net');
    return new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loreveil-e2e-'));
const dataRoot = path.join(work, 'data');
const userDir = path.join(dataRoot, 'default-user');
let st = null; let mock = null; let browser = null;

async function cleanup() {
    try { await browser?.close(); } catch { /* ignore */ }
    if (st && !st.killed) { st.kill('SIGTERM'); await sleep(500); if (st.exitCode === null) st.kill('SIGKILL'); }
    try { await mock?.close(); } catch { /* ignore */ }
    if (!KEEP) fs.rmSync(work, { recursive: true, force: true }); else console.log('workdir kept:', work);
}

try {
    mock = await startMock();
    const stPort = await freePort();
    const base = `http://127.0.0.1:${stPort}`;

    // --- seed data dir: settings (Chat Completion -> Custom -> mock), world book, extension ---
    fs.mkdirSync(path.join(userDir, 'worlds'), { recursive: true });
    fs.mkdirSync(path.join(userDir, 'extensions', EXT_NAME), { recursive: true });
    for (const f of EXT_FILES) fs.cpSync(path.join(REPO, f), path.join(userDir, 'extensions', EXT_NAME, f), { recursive: true });

    const settings = JSON.parse(fs.readFileSync(path.join(ST_DIR, 'default/content/settings.json'), 'utf8'));
    settings.firstRun = false; // skip the welcome popup
    settings.main_api = 'openai';
    Object.assign(settings.oai_settings, {
        chat_completion_source: 'custom',
        custom_url: `http://127.0.0.1:${mock.port}/v1`,
        custom_model: 'mock-model',
        stream_openai: false,
        bypass_status_check: true,
    });
    settings.world_info_settings = { ...settings.world_info_settings, world_info: { globalSelect: [BOOK] } };
    settings.extension_settings = { ...(settings.extension_settings || {}), loreVeil: { debug: true } };
    fs.writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify(settings, null, 4));

    const eldoria = JSON.parse(fs.readFileSync(path.join(ST_DIR, 'default/content/Eldoria.json'), 'utf8'));
    const tmpl = Object.values(eldoria.entries)[0];
    const entry = {
        ...tmpl, uid: 0, key: ['Mira'], keysecondary: [], comment: 'mira', content: MARKER,
        constant: false, selective: false, disable: false, probability: 100, useProbability: true,
        sticky: null, cooldown: null, delay: null, position: 0, order: 100, displayIndex: 0,
    };
    fs.writeFileSync(path.join(userDir, 'worlds', `${BOOK}.json`), JSON.stringify({ entries: { 0: entry } }, null, 4));

    // static fact: the caller gate token must still exist on the chatForWI line
    const scriptJs = fs.readFileSync(path.join(ST_DIR, 'public/script.js'), 'utf8');
    const gateLine = scriptJs.split('\n').find((l) => l.includes('const chatForWI = coreChat.map('));
    record('pre', 'ST chatForWI line still contains world_info_include_names (caller gate)', !!gateLine && gateLine.includes('world_info_include_names'), (gateLine || 'chatForWI line NOT FOUND').trim());

    // --- start SillyTavern ---
    const stLog = [];
    st = spawn('node', ['server.js', '--port', String(stPort), '--listen', 'false', '--dataRoot', dataRoot,
        '--configPath', path.join(work, 'config.yaml'), '--browserLaunchEnabled', 'false'], { cwd: ST_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    st.stdout.on('data', (d) => stLog.push(String(d))); st.stderr.on('data', (d) => stLog.push(String(d)));
    let up = false;
    for (let i = 0; i < 240 && !up; i++) {
        if (st.exitCode !== null) throw new Error('SillyTavern exited early:\n' + stLog.join('').slice(-2000));
        try { up = (await fetch(base + '/')).ok; } catch { await sleep(500); }
    }
    if (!up) throw new Error('SillyTavern did not start:\n' + stLog.join('').slice(-2000));

    // --- browser ---
    browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleMsgs = []; const pageErrors = []; const extResponses = [];
    page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('response', (r) => { if (r.url().includes(`/extensions/third-party/${EXT_NAME}/`)) extResponses.push(`${r.status()} ${r.url().replace(base, '')}`); });

    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.querySelector('#send_textarea') && document.querySelector('#rm_print_characters_block .character_select'), null, { timeout: 90000 });
    await sleep(1500);

    const loaded = await page.evaluate(() => ({
        interceptor: typeof globalThis.loreVeilInterceptor,
        panel: !!document.querySelector('.loreveil_settings'),
        mode: SillyTavern.getContext().mainApi,
        source: SillyTavern.getContext().chatCompletionSettings?.chat_completion_source,
        activeBooks: SillyTavern.getContext().selected_world_info ?? null,
    }));
    record('load', 'extension loaded from data/default-user/extensions/' + EXT_NAME, loaded.interceptor === 'function' && loaded.panel && extResponses.some((x) => x.startsWith('200') && x.endsWith('/index.js')),
        `interceptor=${loaded.interceptor} panel=${loaded.panel} api=${loaded.mode}/${loaded.source} responses=${extResponses.join(' | ')}`);

    // select the default character
    await page.evaluate(() => SillyTavern.getContext().selectCharacterById(0));
    await page.waitForSelector('#chat .mes', { timeout: 30000 });
    // ST only runs the API status check on explicit connect; do it so the send button appears.
    await page.evaluate(() => document.querySelector('#api_button_openai').click());
    await page.waitForFunction(() => !document.querySelector('#send_but').classList.contains('displayNone'), null, { timeout: 30000 });

    const sendBox = page.locator('#send_textarea');
    async function newChat() {
        await sendBox.fill('/newchat');
        await page.keyboard.press('Enter');
        await page.waitForFunction((reply) => {
            const m = document.querySelectorAll('#chat .mes');
            return m.length === 1 && !m[0].textContent.includes(reply);
        }, MOCK_REPLY, { timeout: 30000 });
        await sleep(500);
    }
    // Sends text in a fresh chat; returns the recorded prompt text of the generation request.
    async function sendFresh(text) {
        await newChat();
        const before = mock.requests.length;
        await sendBox.fill(text);
        await page.locator('#send_but').click();
        for (let i = 0; i < 120 && mock.requests.length === before; i++) await sleep(250);
        if (mock.requests.length === before) throw new Error('no request reached the mock for: ' + text);
        await page.waitForFunction((reply) => [...document.querySelectorAll('#chat .mes')].some((m) => m.textContent.includes(reply)), MOCK_REPLY, { timeout: 30000 });
        await sleep(300);
        const reqs = mock.requests.slice(before);
        // Other extensions may send their own requests (e.g. translators, memory archivers).
        // The generation request is the one whose prompt ends with the message just sent.
        const prompts = reqs.map((q) => promptText(q.body));
        const main = prompts.filter((t) => t.trimEnd().endsWith(text));
        return { prompt: main[0] ?? prompts[0], n: main.length, extra: reqs.length - main.length };
    }
    const storedUserMes = () => page.evaluate(() => SillyTavern.getContext().chat.filter((m) => m.is_user).at(-1)?.mes);

    // settings drawer helpers
    const panel = page.locator('.loreveil_settings');
    async function openDrawer() {
        if (!(await page.locator('#extensions_settings2').isVisible())) await page.locator('#extensions-settings-button .drawer-toggle').click();
        if (!(await panel.locator('.inline-drawer-content').isVisible())) await panel.locator('.inline-drawer-toggle').click();
        await panel.locator('.inline-drawer-content').waitFor({ state: 'visible' });
    }
    async function closeDrawer() {
        if (await page.locator('#extensions_settings2').isVisible()) await page.locator('#extensions-settings-button .drawer-toggle').click();
        await sleep(400);
    }
    const tagInput = panel.locator('input[type=text]');
    const cb = (i) => panel.locator('input[type=checkbox]').nth(i); // 0 enabled, 1 markers, 2 attribute, 3 debug
    const has = (p) => p.includes(MARKER);

    // (a)
    let r = await sendFresh('Mira enters.');
    record('a', 'control: "Mira enters." activates the entry', has(r.prompt) && r.n === 1, `generation requests=${r.n}, other requests=${r.extra}; ${excerpt(r.prompt, MARKER)}`);

    const dbgLines = (from) => consoleMsgs.slice(from).map((m) => m.text).filter((t) => t.includes('[LoreVeil]'));
    // excluded-form case: marker absent, text verbatim in prompt, stored mes unchanged
    async function excludedCase(id, name, msg) {
        const from = consoleMsgs.length;
        const x = await sendFresh(msg);
        const st_ = await storedUserMes();
        record(id, name, !has(x.prompt) && x.prompt.includes(msg) && st_ === msg,
            `marker absent=${!has(x.prompt)}; ${excerpt(x.prompt, msg, 20)}; stored mes verbatim=${st_ === msg}`);
        return dbgLines(from);
    }

    // (b) default tag element
    const dbg = await excludedCase('b', 'default <st-loreveil> element excluded; prompt verbatim; stored mes unchanged', '<st-loreveil>Mira</st-loreveil>');
    record('b2', 'debug log: "[LoreVeil] masked 1 message(s)" and "consumed by WI scan"', dbg.some((t) => /masked 1 message/.test(t)) && dbg.some((t) => /consumed by WI scan/.test(t)), JSON.stringify(dbg));
    await excludedCase('c', 'ST_LOREVEIL marker form excluded', '!--ST_LOREVEIL_START--!Mira!--ST_LOREVEIL_END--!');
    await excludedCase('d', 'attribute form <div st-loreveil> excluded', '<div st-loreveil>Mira</div>');

    // (n) defaults do not include wi-exclude
    const msgW = '<wi-exclude>Mira</wi-exclude>';
    r = await sendFresh(msgW);
    record('n', 'defaults: <wi-exclude>Mira</wi-exclude> NOT excluded (marker present)', has(r.prompt) && r.prompt.includes(msgW), `marker present=${has(r.prompt)}; ${excerpt(r.prompt, MARKER)}`);

    // (h) preview
    await openDrawer();
    await panel.locator('textarea').fill('a <st-loreveil>Mira</st-loreveil> b');
    const preview = await panel.locator('textarea + pre').textContent();
    record('h', 'drawer test preview shows blanks (·) for the excluded span', preview.includes('·') && !preview.includes('Mira') && preview.startsWith('a '), JSON.stringify(preview));

    // (i) typed "st-loreveil, wi-exclude"
    await tagInput.fill('st-loreveil, wi-exclude');
    await sleep(300);
    await closeDrawer();
    r = await sendFresh(msgW);
    record('i', 'drawer tags "st-loreveil, wi-exclude": <wi-exclude> now excluded', !has(r.prompt) && r.prompt.includes(msgW), `marker absent=${!has(r.prompt)}; ${excerpt(r.prompt, msgW, 20)}`);

    // (e) lore-skip
    await openDrawer();
    await tagInput.fill('lore-skip');
    await sleep(300);
    await closeDrawer();
    const msgE1 = '<lore-skip>Mira</lore-skip>';
    r = await sendFresh(msgE1);
    const e1 = !has(r.prompt) && r.prompt.includes(msgE1);
    const msgE2 = '<st-loreveil>Mira</st-loreveil>';
    const r2 = await sendFresh(msgE2);
    const e2 = has(r2.prompt) && r2.prompt.includes(msgE2);
    record('e', 'tag "lore-skip": lore-skip excluded, st-loreveil now activates', e1 && e2,
        `lore-skip: marker absent=${!has(r.prompt)}, verbatim=${r.prompt.includes(msgE1)}; st-loreveil: marker present=${has(r2.prompt)}, verbatim=${r2.prompt.includes(msgE2)}`);

    // (f) disable toggle
    await openDrawer();
    await cb(0).uncheck();
    await sleep(300);
    await closeDrawer();
    r = await sendFresh(msgE1);
    record('f', 'disable toggle: wrapped <lore-skip>Mira activates again', has(r.prompt) && r.prompt.includes(msgE1), `marker present=${has(r.prompt)}; ${excerpt(r.prompt, MARKER)}`);

    // (g) persistence across reload (state now: tags=lore-skip, enabled=false)
    await sleep(2500); // saveSettingsDebounced
    const disk = JSON.parse(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8')).extension_settings?.loreVeil;
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.querySelector('.loreveil_settings') && document.querySelector('#rm_print_characters_block .character_select'), null, { timeout: 90000 });
    await sleep(1500);
    await openDrawer();
    const afterTags = await tagInput.inputValue();
    const afterEnabled = await cb(0).isChecked();
    record('g', 'settings persist after reload', afterTags === 'lore-skip' && afterEnabled === false && disk?.tags === 'lore-skip' && disk?.enabled === false,
        `UI tags=${afterTags} enabled=${afterEnabled}; settings.json loreVeil=${JSON.stringify(disk)}`);
    await cb(0).check();
    await sleep(300);
    await closeDrawer();
    await page.evaluate(() => SillyTavern.getContext().selectCharacterById(0));
    await page.waitForSelector('#chat .mes', { timeout: 30000 });
    await page.evaluate(() => document.querySelector('#api_button_openai').click());
    await page.waitForFunction(() => !document.querySelector('#send_but').classList.contains('displayNone'), null, { timeout: 30000 });
    r = await sendFresh(msgE1);
    record('g2', 'after reload + re-enable, persisted tag still excludes', !has(r.prompt) && r.prompt.includes(msgE1), `marker absent=${!has(r.prompt)}`);

    // console
    const extRelated = consoleMsgs.filter((m) => /lore[ -_]?veil|lv-e2e-ext/i.test(m.text));
    const bad = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'warning');
    const extBad = extRelated.filter((m) => m.type === 'error' || m.type === 'warning');
    record('console', 'no extension-related console errors/warnings or page errors', extBad.length === 0 && pageErrors.length === 0,
        `extension-related messages: ${JSON.stringify(extRelated)}\n pageErrors=${JSON.stringify(pageErrors)}\n all error/warn (${bad.length}) sample: ${JSON.stringify(bad.slice(0, 8))}`);
} catch (e) {
    record('fatal', 'harness error', false, e.stack || String(e));
} finally {
    await cleanup();
}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (process.env.RESULTS_OUT) fs.writeFileSync(process.env.RESULTS_OUT, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);

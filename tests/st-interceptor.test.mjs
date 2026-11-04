import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterceptor } from '../lib/interceptor.js';
import { loadSettings } from '../lib/settings.js';

const eventTypes = {
  WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
  GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped',
};
class FakeBus {
  constructor() { this.l = new Map(); }
  on(e, f) { (this.l.get(e) ?? this.l.set(e, []).get(e)).push(f); }
  removeListener(e, f) { this.l.set(e, (this.l.get(e) ?? []).filter((x) => x !== f)); }
  emit(e) { for (const f of this.l.get(e) ?? []) f(); }
  count(e) { return (this.l.get(e) ?? []).length; }
}

// Stand-in for ST's script.js variable; its name in the callback source is the WI-mapper marker.
const world_info_include_names = false;
const wiMes = (x) => (world_info_include_names ? x.name : x.mes);

const CHAT = [
  { name: 'A', mes: 'hello dragon', is_user: true },
  { name: 'B', mes: 'secret <st-loreveil>castle</st-loreveil> visible' },
  { name: 'A', mes: 'plain text' },
];

function setup(over = {}) {
  const bus = new FakeBus();
  const logs = [];
  const settings = loadSettings({ loreVeil: over });
  const h = createInterceptor({ getSettings: () => settings, eventSource: bus, eventTypes, log: (...a) => logs.push(a.join(' ')) });
  h.attach();
  return { bus, logs, settings, h };
}

// Mimics Generate(): shallow copies -> interceptor -> chatForWI -> prompt reads.
async function generate(h, chat, { includeNames = false } = {}) {
  const coreChat = chat.map((x) => ({ ...x }));
  await h.interceptor(coreChat, 4096, () => {}, 'normal');
  const chatForWI = coreChat.map((x) => (world_info_include_names || includeNames ? `${x.name}: ${x.mes}` : x.mes)).reverse();
  const promptView = coreChat.map((x) => x.mes);
  const promptDirect = coreChat.map((_, i) => coreChat[i].mes);
  return { coreChat, chatForWI, promptView, promptDirect };
}

test('WI view masked; prompt view and original chat untouched', async () => {
  const { h } = setup();
  const snapshot = JSON.stringify(CHAT);
  const r = await generate(h, CHAT);
  assert.ok(!r.chatForWI.join('|').includes('castle'));
  assert.equal(r.chatForWI[1].length, CHAT[1].mes.length);
  assert.ok(r.promptView.join('|').includes('castle'));
  assert.ok(r.promptDirect[1].includes('castle'));
  assert.equal(r.coreChat[1].mes, CHAT[1].mes);
  assert.equal(JSON.stringify(CHAT), snapshot);
});

test('include-names variant is masked too', async () => {
  const { h } = setup();
  const r = await generate(h, CHAT, { includeNames: true });
  assert.ok(!r.chatForWI.join('|').includes('castle'));
  assert.ok(r.chatForWI.some((s) => s.startsWith('B: secret')));
});

test('override consumed once and removed', async () => {
  const { h } = setup();
  const coreChat = CHAT.map((x) => ({ ...x }));
  await h.interceptor(coreChat, 0, () => {}, 'normal');
  assert.ok(Object.hasOwn(coreChat, 'map'));
  assert.equal(Object.keys(coreChat).includes('map'), false);
  assert.equal(h.hasPending(), true);
  const first = coreChat.map(wiMes);
  assert.ok(!first.join('').includes('castle'));
  assert.equal(Object.hasOwn(coreChat, 'map'), false);
  assert.equal(h.hasPending(), false);
  assert.ok(coreChat.map((x) => x.mes).join('').includes('castle'));
});

test('map override honours thisArg and index args', async () => {
  const { h } = setup();
  const coreChat = CHAT.map((x) => ({ ...x }));
  await h.interceptor(coreChat, 0, () => {}, 'normal');
  const seen = [];
  coreChat.map(function (x, i, arr) { void world_info_include_names; seen.push([this.k, i, arr.length]); return x; }, { k: 7 });
  assert.deepEqual(seen.map((s) => s[0]), [7, 7, 7]);
  assert.deepEqual(seen.map((s) => s[1]), [0, 1, 2]);
});

for (const ev of Object.values(eventTypes)) {
  test(`clearPending on ${ev}`, async () => {
    const { h, bus } = setup();
    const coreChat = CHAT.map((x) => ({ ...x }));
    await h.interceptor(coreChat, 0, () => {}, 'normal');
    assert.ok(Object.hasOwn(coreChat, 'map'));
    bus.emit(ev);
    assert.equal(Object.hasOwn(coreChat, 'map'), false);
    assert.equal(h.hasPending(), false);
    assert.ok(coreChat.map((x) => x.mes).join('').includes('castle'));
  });
}

test('start of next interceptor run clears a leftover override', async () => {
  const { h } = setup();
  const a = CHAT.map((x) => ({ ...x }));
  await h.interceptor(a, 0, () => {}, 'normal');
  const b = CHAT.map((x) => ({ ...x }));
  await h.interceptor(b, 0, () => {}, 'normal');
  assert.equal(Object.hasOwn(a, 'map'), false);
  assert.equal(Object.hasOwn(b, 'map'), true);
});

test('disabled setting is a no-op, even for a leftover', async () => {
  const { h, settings } = setup();
  const a = CHAT.map((x) => ({ ...x }));
  await h.interceptor(a, 0, () => {}, 'normal');
  settings.enabled = false;
  const b = CHAT.map((x) => ({ ...x }));
  await h.interceptor(b, 0, () => {}, 'normal');
  assert.equal(Object.hasOwn(a, 'map'), false);
  assert.equal(Object.hasOwn(b, 'map'), false);
  assert.ok(b.map((x) => x.mes).join('').includes('castle'));
});

test('custom tags (settings changes picked up live)', async () => {
  const { h, settings } = setup({ tags: 'ooc, Note' });
  const chat = [{ name: 'A', mes: 'x <note>hidden</note> y <st-loreveil>kept</st-loreveil>' }];
  const r = await generate(h, chat);
  assert.ok(!r.chatForWI[0].includes('hidden'));
  assert.ok(r.chatForWI[0].includes('kept'));
  settings.tags = 'st-loreveil';
  const r2 = await generate(h, chat);
  assert.ok(r2.chatForWI[0].includes('hidden'));
  assert.ok(!r2.chatForWI[0].includes('kept'));
});

test('no override when nothing matches', async () => {
  const { h } = setup();
  const chat = [{ name: 'A', mes: 'nothing here' }, { name: 'B', mes: 'still nothing' }];
  const coreChat = chat.map((x) => ({ ...x }));
  await h.interceptor(coreChat, 0, () => {}, 'normal');
  assert.equal(Object.hasOwn(coreChat, 'map'), false);
  assert.equal(h.hasPending(), false);
});

test('swipe/continue-like arrays: empty, non-string mes, trailing item', async () => {
  const { h } = setup();
  const empty = [];
  await h.interceptor(empty, 0, () => {}, 'swipe');
  assert.equal(Object.hasOwn(empty, 'map'), false);
  const odd = [{ name: 'A' }, null, { mes: 5 }, { name: 'B', mes: 'a !--ST_LOREVEIL_START--!gone!--ST_LOREVEIL_END--! b' }];
  await h.interceptor(odd, 0, () => {}, 'continue');
  const v = odd.map((x) => (world_info_include_names ? 0 : x?.mes));
  assert.equal(v[3].includes('gone'), false);
  assert.equal(odd[3].mes.includes('gone'), true);
  assert.equal(v[0], undefined);
});

test('debug logging toggles', async () => {
  const quiet = setup();
  await generate(quiet.h, CHAT);
  assert.deepEqual(quiet.logs, []);
  const loud = setup({ debug: true });
  await generate(loud.h, CHAT);
  assert.equal(loud.logs.length, 2);
  assert.match(loud.logs[0], /masked 1 message/);
  assert.match(loud.logs[1], /consumed/);
});

test('attach/detach register and remove listeners', () => {
  const { h, bus } = setup();
  for (const ev of Object.values(eventTypes)) assert.equal(bus.count(ev), 1);
  h.detach();
  for (const ev of Object.values(eventTypes)) assert.equal(bus.count(ev), 0);
});

test('index.js is a module importing only ./lib/ files; manifest sane', () => {
  const dir = fileURLToPath(new URL('../', import.meta.url));
  const src = readFileSync(dir + 'index.js', 'utf8');
  const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(specs.length >= 1);
  for (const s of specs) assert.match(s, /^\.\/lib\/[\w-]+\.js$/);
  assert.equal(/\bimport\s*\(/.test(src), false);
  assert.equal(/\.html\(|innerHTML/.test(src), false);
  for (const f of ['lib/interceptor.js', 'lib/settings.js']) {
    const t = readFileSync(dir + f, 'utf8');
    for (const m of t.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.match(m[1], /^\.\/[\w-]+\.js$/);
  }
  const mf = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  assert.equal(mf.display_name, 'LoreVeil');
  assert.equal(mf.loading_order, 10000);
  assert.equal(mf.generate_interceptor, 'loreVeilInterceptor');
  assert.equal(mf.js, 'index.js');
  assert.equal(mf.css, 'style.css');
  assert.equal(mf.version, '1.0.0');
});

test('non-WI map caller (later interceptor) sees the real chat and keeps the override', async () => {
  const { h } = setup();
  const coreChat = CHAT.map((x) => ({ ...x }));
  await h.interceptor(coreChat, 0, () => {}, 'normal');
  const rewritten = coreChat.map((x) => ({ ...x, mes: x.mes.toUpperCase() }));
  assert.ok(rewritten[1].mes.includes('CASTLE'));
  assert.equal(Object.hasOwn(coreChat, 'map'), true);
  assert.equal(h.hasPending(), true);
  assert.ok(coreChat.map(wiMes).join('').includes('castle') === false);
  assert.equal(coreChat[1].mes, CHAT[1].mes);
});

test('defaults: settings key, tag and legacy name', async () => {
  const store = {};
  const s = loadSettings(store);
  assert.equal(s, store.loreVeil);
  assert.equal(s.tags, 'st-loreveil');
  assert.equal(Object.hasOwn(store, 'wiExclude'), false);
  const { h } = setup();
  const r = await generate(h, [{ name: 'A', mes: '<wi-exclude>kept</wi-exclude> <st-loreveil>gone</st-loreveil>' }]);
  assert.ok(r.chatForWI[0].includes('kept'));
  assert.ok(!r.chatForWI[0].includes('gone'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_TAG, TAG_NAME_PATTERN, normalizeTagList, markerPair,
  createScanExclusionMasker, maskScanExclusions,
} from '../lib/scan-exclusion.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'test-vectors.json'), 'utf8'));

function optionsFor(c) {
  if (c.useBuiltinDefault) return c.options;
  if (c.options && c.options.tags) return c.options;
  return { ...c.options, tags: vectors.defaultTags };
}

function expectedFor(c) {
  if (c.expectEmpty) return '';
  let out = '';
  let pos = 0;
  for (const b of c.blank) {
    const idx = c.input.indexOf(b, pos);
    assert.notEqual(idx, -1, `vector substring not found: ${b}`);
    out += c.input.slice(pos, idx) + ' '.repeat(b.length);
    pos = idx + b.length;
  }
  return out + c.input.slice(pos);
}

test('exports', () => {
  assert.equal(DEFAULT_TAG, 'st-loreveil');
  assert.ok(TAG_NAME_PATTERN.test('a-b:c_1'));
  assert.equal(typeof maskScanExclusions, 'function');
});

for (const c of vectors.cases) {
  test(`case: ${c.name}`, () => {
    const opts = optionsFor(c);
    const out = maskScanExclusions(c.input, opts);
    assert.equal(out, expectedFor(c));
    if (out !== '') assert.equal(out.length, c.input.length);
    if (!c.expectEmpty && c.blank.length === 0) assert.ok(Object.is(out, c.input));
    // masker reuse gives the same answer
    assert.equal(createScanExclusionMasker(opts)(c.input), out);
  });
}

for (const c of vectors.normalize) {
  test(`normalize: ${JSON.stringify(c.input)}`, () => {
    assert.deepEqual(normalizeTagList(c.input), { tags: c.tags, invalid: c.invalid });
  });
}

for (const c of vectors.markers) {
  test(`markers: ${c.tag}`, () => {
    assert.deepEqual(markerPair(c.tag), [c.start, c.end]);
  });
}

test('normalize accepts arrays', () => {
  assert.deepEqual(normalizeTagList(['A', 'b,c', 'a']), { tags: ['a', 'b', 'c'], invalid: [] });
});

test('fuzz: no throw, length preserved', () => {
  const frags = ['<', '>', '/', '"', "'", '=', 'st-loreveil', 'div', '!--ST_LOREVEIL_START--!',
    '!--ST_LOREVEIL_END--!', '<!--', '-->', ' ', 'a', 'b', 'script', '</', 'Mira', '\n'];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const maskers = [createScanExclusionMasker(), createScanExclusionMasker({ tags: ['st-loreveil', 'div'], attribute: false })];
  for (let n = 0; n < 2000; n++) {
    let s = '';
    const len = 1 + Math.floor(rnd() * 30);
    for (let k = 0; k < len; k++) s += frags[Math.floor(rnd() * frags.length)];
    for (const m of maskers) {
      const out = m(s);
      if (out !== '') assert.equal(out.length, s.length, JSON.stringify(s));
    }
  }
});

test('performance: pathological input stays fast', () => {
  const inputs = ['<div '.repeat(40000), '<st-loreveil>'.repeat(17000), '<div st-loreveil>'.repeat(13000),
    '<a b="'.repeat(33000), '!--ST_LOREVEIL_START--!'.repeat(9000), '<script>'.repeat(25000), '</script '.repeat(22000)];
  const mask = createScanExclusionMasker();
  for (const s of inputs) {
    const t0 = performance.now();
    mask(s);
    const dt = performance.now() - t0;
    assert.ok(dt < 1000, `took ${dt}ms for ${s.slice(0, 12)}`);
  }
});

test('region: other-name tags and stray < are plain text (core-1)', () => {
  assert.equal(maskScanExclusions('<st-loreveil>if hp<half then flee</st-loreveil> Mira enters.').trim(), 'Mira enters.');
  assert.equal(maskScanExclusions('<st-loreveil>x <b title="oops</st-loreveil> visible').trim(), 'visible');
  assert.equal(maskScanExclusions('<st-loreveil>a <st-loreveils> b</st-loreveil> vis').trim(), 'vis');
});

test('stray = after / does not self-close (core-3)', () => {
  assert.equal(maskScanExclusions('<st-loreveil/=>secret</st-loreveil> vis').trim(), 'vis');
  assert.equal(maskScanExclusions('<span st-loreveil /=>secret</span> vis').trim(), 'vis');
});

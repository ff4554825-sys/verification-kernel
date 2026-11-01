import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAutoLoad } from '../lib/auto-load.js';

test('registerAutoLoad publishes the protocol and repo-review skills plus the prompt section', () => {
  const skills = [];
  const sections = [];
  const ctx = {
    get(name) {
      if (name === 'skills') return { register: (skill) => { skills.push(skill); return () => {}; } };
      if (name === 'systemPrompt') return { section: (section) => { sections.push(section); return () => {}; } };
      return undefined;
    },
    effect(callback) {
      return callback();
    },
  };
  registerAutoLoad(ctx);
  assert.equal(skills.length, 2);
  assert.deepEqual(skills.map((skill) => skill.name).sort(), ['repo-review', 'verification-protocol']);
  assert.equal(sections.length, 1);
  assert.match(sections[0].text, /Verification discipline/);
  assert.match(sections[0].text, /repo-review/);
});

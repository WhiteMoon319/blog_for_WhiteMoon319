import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicBase } from '../src/lib/utils.ts';

test('publicBase：去除首尾空白与末尾斜杠', () => {
  assert.equal(publicBase('https://cdn.example'), 'https://cdn.example');
  assert.equal(publicBase('https://cdn.example/'), 'https://cdn.example');
  assert.equal(publicBase('https://cdn.example//'), 'https://cdn.example');
  assert.equal(publicBase(' https://cdn.example/ '), 'https://cdn.example');
  assert.equal(publicBase(''), '');
});
// Tests des points sensibles de l'integration Popina (voir Annexe 9 du prompt).
// Lancer avec : node --test
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const popina = require('../lib/popina');

test('verifySignature accepte une signature HMAC-SHA256 valide', () => {
  const secret = 'my-secret';
  const body = JSON.stringify({ hello: 'world' });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.strictEqual(popina.verifySignature(body, sig, secret), true);
});

test('verifySignature rejette une signature invalide', () => {
  assert.strictEqual(popina.verifySignature('{}', 'deadbeef', 'secret'), false);
});

test('verifySignature rejette si le corps a ete modifie apres signature', () => {
  const secret = 'my-secret';
  const sig = crypto.createHmac('sha256', secret).update(JSON.stringify({ a: 1 })).digest('hex');
  assert.strictEqual(popina.verifySignature(JSON.stringify({ a: 2 }), sig, secret), false);
});

test('verifySignature retourne false si secret ou signature manquant (ne doit jamais planter)', () => {
  assert.strictEqual(popina.verifySignature('{}', null, 'secret'), false);
  assert.strictEqual(popina.verifySignature('{}', 'abc', null), false);
});

// Déclenche une transaction depuis l'API (pour tester la mise à jour poussée par WebSocket).
// Compatible Maestro >= 3.5 (API maestro.http). Backend joignable depuis l'émulateur via 10.0.2.2.
const base = process.env.BACKEND_URL || 'http://10.0.2.2:3000/api';
const email = process.env.REGISTERED_EMAIL || '';
const password = process.env.REGISTERED_PASSWORD || 'Maestro2024!';
const toEmail = process.env.TO_EMAIL || 'partner@clearnet.test';

if (!email) throw new Error('REGISTERED_EMAIL requis (env du flow Maestro)');

const loginRes = await maestro.http.post(base + '/auth/login', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (loginRes.status !== 201 && loginRes.status !== 200) {
  throw new Error('login echec : ' + loginRes.status + ' ' + loginRes.body);
}
const token = loginRes.body.access_token;

const txRes = await maestro.http.post(base + '/transactions', {
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ toEmail, amount: 2, note: 'e2e-ws-' + Date.now() }),
});
if (txRes.status !== 201 && txRes.status !== 200) {
  throw new Error('transaction echec : ' + txRes.status + ' ' + txRes.body);
}
console.log('transaction declenchee : ' + txRes.status);
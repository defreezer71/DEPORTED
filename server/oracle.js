// Match-result attestation oracle — BIP-340 Schnorr, DLC-style pre-committed
// nonce per match. See docs/private/OCRA_PROTOCOL_DRAFT.md for the protocol
// this implements a subset of (Kind B announcement / Kind C attestation).
//
// Security model (do not weaken any of this without re-reading the whole file):
//   - One nonce (r_secret) per match_id, generated once at announceMatch() and
//     never reused. Reusing it to sign two different outcome messages leaks
//     ORACLE_PRIVKEY outright (standard Schnorr/DLC property) — see the s formula
//     in attestMatch(). This is why attestations are append-once and why
//     r_secret is nulled out immediately after the one signature that uses it.
//   - ORACLE_PRIVKEY never leaves this module: not returned, not logged, not put
//     in an error message. Only its derived public key and signatures are.
//   - Signing input is exclusively the caller's match_id/outcome — no external
//     or user-suppliable data reaches the challenge hash.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { schnorr } = require('@noble/curves/secp256k1');

const Pointk1 = schnorr.Point;
const Fn = Pointk1.Fn;
const hasEven = (y) => y % 2n === 0n;
const numFromBytes = schnorr.utils.bytesToNumberBE;

// A generous window over round-based duel + disconnect/reconnect slack. If no
// attestation lands by attest_by, external consumers treat the match as void
// (this file publishes no explicit VOID — the deadline itself is the signal,
// per the announcement's role as a DLC refund path).
const ATTEST_WINDOW_MS = 20 * 60 * 1000;

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('invalid hex input');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}
function bytesToHex(bytes) { return Buffer.from(bytes).toString('hex'); }

// Mirrors BIP-340's internal "get extended pubkey": given a 32-byte scalar
// seed, return the even-y-normalized scalar and the x-only point bytes. Used
// both for the oracle keypair itself and for each match's committed nonce —
// the two are the same math, just applied to different seeds.
function getExtPubKey(seedBytes) {
  const raw = numFromBytes(seedBytes);
  if (raw <= 0n || raw >= Fn.ORDER) throw new Error('scalar out of range');
  const d_ = Fn.create(raw);
  const p = Pointk1.BASE.multiply(d_);
  const scalar = hasEven(p.y) ? d_ : Fn.neg(d_);
  return { scalar, bytes: schnorr.utils.pointToBytes(p) };
}

function challenge(Rx, Px, m) {
  return Fn.create(numFromBytes(schnorr.utils.taggedHash('BIP0340/challenge', Rx, Px, m)));
}

// ── Oracle keypair ───────────────────────────────────────────────────────
// Real deploys set both env vars (Render does). Local dev without them still
// boots — using a throwaway per-process keypair — so playtesting never
// requires provisioning real oracle keys. A *mismatched* pair (both present,
// wrong) is a real misconfiguration and still hard-fails at boot.
let ORACLE_PRIVKEY_HEX = process.env.ORACLE_PRIVKEY;
let ORACLE_PUBKEY_HEX = process.env.ORACLE_PUBKEY;
const ephemeral = !ORACLE_PRIVKEY_HEX || !ORACLE_PUBKEY_HEX;
if (ephemeral) ORACLE_PRIVKEY_HEX = bytesToHex(crypto.randomBytes(32));

const privBytes = hexToBytes(ORACLE_PRIVKEY_HEX);
const { scalar: oraclePrivScalar, bytes: derivedPubBytes } = getExtPubKey(privBytes);
const derivedPubHex = bytesToHex(derivedPubBytes);

if (ephemeral) {
  ORACLE_PUBKEY_HEX = derivedPubHex;
  console.warn('[oracle] ORACLE_PRIVKEY/ORACLE_PUBKEY not set — using an EPHEMERAL '
    + 'dev-only keypair (pubkey ' + derivedPubHex + '). Fine for local play, never for prod.');
} else if (derivedPubHex !== ORACLE_PUBKEY_HEX.toLowerCase()) {
  throw new Error('[oracle] ORACLE_PUBKEY does not match ORACLE_PRIVKEY — refusing to start');
} else {
  console.log('[oracle] keys OK — pubkey ' + derivedPubHex);
}
ORACLE_PUBKEY_HEX = ORACLE_PUBKEY_HEX.toLowerCase();

// ── Storage ───────────────────────────────────────────────────────────────
const DATA_DIR = fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'oracle.db'));
db.pragma('synchronous = FULL'); // fsync before a write returns — see announceMatch()

db.exec(`
  CREATE TABLE IF NOT EXISTS nonces (
    match_id  TEXT PRIMARY KEY,
    r_secret  TEXT,
    R         TEXT NOT NULL,
    outcomes  TEXT NOT NULL,
    attest_by INTEGER NOT NULL,
    sig       TEXT NOT NULL,
    created   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attestations (
    match_id TEXT PRIMARY KEY,
    outcome  TEXT NOT NULL,
    s        TEXT NOT NULL,
    created  INTEGER NOT NULL
  );
`);

const stmt = {
  insertNonce: db.prepare(
    `INSERT INTO nonces (match_id, r_secret, R, outcomes, attest_by, sig, created) VALUES (?,?,?,?,?,?,?)`),
  getNonce: db.prepare(`SELECT r_secret, R, outcomes, attest_by, sig FROM nonces WHERE match_id = ?`),
  nullifyRSecret: db.prepare(`UPDATE nonces SET r_secret = NULL WHERE match_id = ?`),
  insertAttestation: db.prepare(`INSERT INTO attestations (match_id, outcome, s, created) VALUES (?,?,?,?)`),
  getAttestation: db.prepare(`SELECT outcome, s, created FROM attestations WHERE match_id = ?`),
};

const commitAttestation = db.transaction((matchId, outcome, sHex, created) => {
  stmt.insertAttestation.run(matchId, outcome, sHex, created);
  stmt.nullifyRSecret.run(matchId); // constraint 4: r_secret must not survive the one signature it's used for
});

// ── Canonical message preimages (wire contract — do not reorder keys) ──────
function announcementMessage(matchId, rHex, outcomes, attestBy) {
  return crypto.createHash('sha256').update(JSON.stringify({
    match_id: matchId, oracle_pubkey: ORACLE_PUBKEY_HEX, R: rHex, outcomes, attest_by: attestBy,
  })).digest();
}
function outcomeMessage(matchId, outcome) {
  return crypto.createHash('sha256').update(JSON.stringify({ match_id: matchId, outcome })).digest();
}

// ── Pre-match announcement ──────────────────────────────────────────────
// Idempotent by construction: matchId is a fresh UUID minted once per match by
// the caller, so a second call for the same id (should never happen) is a no-op.
function announceMatch(matchId, outcomeIds) {
  if (stmt.getNonce.get(matchId)) return getAnnouncement(matchId);

  let r_secret, R;
  for (;;) { // scalar-out-of-range draws are ~2^-128, but never silently reduce one
    try {
      const seed = crypto.randomBytes(32);
      const ext = getExtPubKey(seed);
      r_secret = seed; R = ext.bytes;
      break;
    } catch (_) { /* retry with a fresh draw */ }
  }

  const created = Date.now();
  const attestBy = created + ATTEST_WINDOW_MS;
  const rHex = bytesToHex(R);
  const sig = schnorr.sign(announcementMessage(matchId, rHex, outcomeIds, attestBy), privBytes);

  // Synchronous + synchronous=FULL: this has been fsynced by the time .run() returns.
  stmt.insertNonce.run(matchId, bytesToHex(r_secret), rHex, JSON.stringify(outcomeIds), attestBy, bytesToHex(sig), created);
  return getAnnouncement(matchId);
}

function getAnnouncement(matchId) {
  const row = stmt.getNonce.get(matchId);
  if (!row) return null;
  return {
    match_id: matchId,
    oracle_pubkey: ORACLE_PUBKEY_HEX,
    R: row.R,
    outcomes: JSON.parse(row.outcomes),
    attest_by: row.attest_by,
    sig: row.sig,
  };
}

// ── Match-end attestation ───────────────────────────────────────────────
// DLC-style signature over the chosen outcome, using the R committed at
// announce time. Signing two different outcomes for the same match would
// reuse k and leak ORACLE_PRIVKEY — the attestations PRIMARY KEY plus the
// "check attestations before touching the nonce" order below is what
// prevents that from ever being possible, including across a mid-match
// Render restart (in-memory room state is gone, but this check survives it).
function attestMatch(matchId, outcome) {
  if (stmt.getAttestation.get(matchId)) return getAttestation(matchId); // already signed — never re-sign

  const nonceRow = stmt.getNonce.get(matchId);
  if (!nonceRow) {
    console.error('[oracle] attestMatch: no announcement on file for match ' + matchId + ' — refusing to sign');
    return null;
  }
  if (!nonceRow.r_secret) {
    console.error('[oracle] attestMatch: r_secret already cleared for match ' + matchId
      + ' with no attestation on file — refusing to sign (should be unreachable)');
    return null;
  }

  const r_secret = hexToBytes(nonceRow.r_secret);
  const R = hexToBytes(nonceRow.R);
  const { scalar: k, bytes: rCheck } = getExtPubKey(r_secret);
  if (bytesToHex(rCheck) !== bytesToHex(R)) {
    console.error('[oracle] attestMatch: recomputed R does not match stored R for match ' + matchId
      + ' — refusing to sign (possible data corruption)');
    return null;
  }

  const m = outcomeMessage(matchId, outcome);
  const e = challenge(R, derivedPubBytes, m);
  const s = Fn.create(k + e * oraclePrivScalar);
  const sHex = bytesToHex(Fn.toBytes(s));
  const created = Date.now();

  commitAttestation(matchId, outcome, sHex, created);
  return getAttestation(matchId);
}

function getAttestation(matchId) {
  const row = stmt.getAttestation.get(matchId);
  if (!row) return null;
  return { match_id: matchId, outcome: row.outcome, s: row.s, created: row.created };
}

// ── Public read endpoints ───────────────────────────────────────────────
function httpHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let m;
  if (req.method === 'GET' && (m = req.url.match(/^\/oracle\/announcement\/([^/?]+)/))) {
    const a = getAnnouncement(decodeURIComponent(m[1]));
    res.writeHead(a ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(a || { error: 'not_found' }));
    return;
  }
  if (req.method === 'GET' && (m = req.url.match(/^\/oracle\/attestation\/([^/?]+)/))) {
    const a = getAttestation(decodeURIComponent(m[1]));
    res.writeHead(a ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(a || { error: 'not_found' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

module.exports = { announceMatch, attestMatch, getAnnouncement, getAttestation, httpHandler, publicKey: ORACLE_PUBKEY_HEX };

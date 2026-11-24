// Invite-only, two-seat matches. The host orders moves; both peers apply the same rules.
import { newGame, play } from './rules.js';

const storageKey = 'stoneandturn.hex-go.room.v1';
const prefix = 'stoneandturn-hexgo-v1-';
const validRoom = /^[a-f0-9]{24}$/;
const token = () => crypto.randomUUID().replaceAll('-', '');
const roomId = () => token().slice(0, 24);
const compact = m => m.type === 'pass' ? { type: 'pass' } : { type: 'place', cell: m.cell };
const toHex = bytes => Array.from(new Uint8Array(bytes), octet => octet.toString(16).padStart(2, '0')).join('');
const encoder = new TextEncoder();
const same = (a, b) => a.type === b.type && (a.type === 'pass' || a.cell === b.cell);

export function parseRoom(input) {
  const value = input.trim();
  if (validRoom.test(value)) return value;
  try {
    const id = new URL(value).searchParams.get('room') || '';
    return validRoom.test(id) ? id : null;
  } catch { return null; }
}

export function currentRoom() {
  const id = new URL(location.href).searchParams.get('room');
  if (!id || !validRoom.test(id)) return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved?.id === id && ['black','white'].includes(saved.seat) && Array.isArray(saved.moves)) return saved;
  } catch {}
  return guestSeat(id);
}

export const hostSeat = side => ({ id: roomId(), seat: 'black', side, moves: [], guest: null });
export const guestSeat = id => ({ id, seat: 'white', side: 5, moves: [], guest: token() });

export function roomURL(id) {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('room', id);
  return url.href;
}

export class OnlineMatch {
  constructor(record, changed, message) {
    this.record = record;
    this.changed = changed;
    this.message = message;
    this.game = record.moves.reduce(play, newGame(record.side));
    this.phase = 'connecting';
    this.detail = 'Connecting to the room…';
    this.attempt = 0;
    this.closed = false;
    this.pending = false;
    this.persist();
  }

  persist() {
    this.record.moves = this.game.moves.map(compact);
    try { sessionStorage.setItem(storageKey, JSON.stringify(this.record)); }
    catch { this.message('This browser cannot save the room when you refresh.'); }
  }

  setState(phase, detail) {
    this.phase = phase;
    this.detail = detail;
    this.changed();
  }

  get myTurn() {
    return this.phase === 'ready' && !this.pending && !this.game.ended && this.game.turn === this.record.seat;
  }

  async start() {
    try {
      await import('../../vendor/peerjs-1.5.5/peerjs.min.js');
      const secret = encoder.encode(this.record.id);
      this.address = prefix + toHex(await crypto.subtle.digest('SHA-256', secret));
      this.inviteKey = await crypto.subtle.importKey('raw', secret, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
      if (!this.closed) this.connect();
    } catch {
      if (!this.closed) this.setState('error', 'Online play could not start. Reload or try another browser.');
    }
  }

  connect() {
    this.clearConnection();
    const host = this.record.seat === 'black';
    const peer = new window.Peer(host ? this.address : undefined, { secure: true, debug: 0 });
    this.peer = peer;
    const active = () => !this.closed && this.peer === peer;
    this.timeout = setTimeout(() => { if (active()) this.retry('The connection timed out.'); }, 20000);
    this.setState('connecting', this.attempt ? 'Reconnecting to the room…' : 'Connecting to the room…');
    peer.on('open', () => {
      if (!active()) return;
      clearTimeout(this.timeout);
      if (host) {
        this.setState('waiting', this.record.guest ? 'Waiting for White to reconnect.' : 'Invite a friend to take White.');
      } else {
        const conn = peer.connect(this.address, { reliable: true, serialization: 'json' });
        this.attach(conn);
      }
    });
    peer.on('connection', conn => {
      if (!active() || !host || this.conn) {
        conn.on('open', () => { conn.send({ type:'busy' }); setTimeout(() => conn.close(), 250); });
        return;
      }
      this.attach(conn);
    });
    peer.on('disconnected', () => {
      if (!active()) return;
      if (this.conn?.open && this.phase === 'ready') return; // Established WebRTC channels survive a signaling outage.
      this.retry('The room directory disconnected.');
    });
    peer.on('error', err => {
      if (!active()) return;
      if (this.conn?.open && this.phase === 'ready' && err.type === 'network') return;
      if (err.type === 'browser-incompatible' || err.type === 'ssl-unavailable') {
        this.clearConnection();
        this.setState('error', 'This browser cannot open a secure WebRTC connection.');
      } else {
        this.retry(err.type === 'peer-unavailable' ? 'The host is offline. Keep both game tabs open.' : 'Could not connect to the other player.');
      }
    });
  }

  attach(conn) {
    this.conn = conn;
    const active = () => !this.closed && this.conn === conn;
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => { if (active()) this.retry('Could not reach the other player on this network.'); }, 20000);
    conn.on('open', () => {
      if (active() && this.record.seat === 'white') {
        this.challenge = token();
        conn.send({ type:'hello', challenge:this.challenge });
      }
    });
    conn.on('data', data => {
      if (!active()) return;
      this.receive(data, conn).catch(err => {
        if (active()) { this.message(err.message); this.retry('Room synchronization was interrupted.'); }
      });
    });
    conn.on('close', () => { if (active()) this.retry('The other player disconnected.'); });
    conn.on('error', () => { if (active()) this.retry('The game connection was interrupted.'); });
  }

  snapshot() {
    this.conn.send({ type:'state', side:this.record.side, moves:this.record.moves });
  }

  ready() {
    clearTimeout(this.timeout);
    this.pending = false;
    this.attempt = 0;
    this.setState('ready', 'Both players connected');
  }

  async receive(data, connection = this.conn) {
    if (!data || typeof data !== 'object') return;
    if (this.record.seat === 'black') {
      if (data.type === 'hello' && /^[a-f0-9]{32}$/.test(data.challenge) && this.phase !== 'ready') {
        const proof = await crypto.subtle.sign('HMAC', this.inviteKey, encoder.encode(data.challenge));
        if (connection === this.conn) connection.send({type:'welcome', proof:toHex(proof)});
        return;
      }
      if (data.type === 'join' && this.phase !== 'ready') {
        if (data.invite !== this.record.id || typeof data.seatKey !== 'string' || !/^[a-f0-9]{32}$/.test(data.seatKey) ||
            (this.record.guest && this.record.guest !== data.seatKey)) {
          const rejected = this.conn;
          rejected.send({ type:'busy' });
          setTimeout(() => rejected.close(), 250);
          return;
        }
        this.record.guest = data.seatKey;
        this.persist();
        this.snapshot();
        this.ready();
      } else if (data.type === 'move' && this.phase === 'ready') {
        if (this.game.turn === 'white' && data.revision === this.game.moves.length) {
          try { this.game = play(this.game, data.action); this.persist(); }
          catch { /* Return the authoritative position for illegal or stale proposals. */ }
        }
        this.snapshot();
        this.changed();
      }
      return;
    }
    if (data.type === 'busy') {
      this.clearConnection();
      this.setState('error', 'Both seats are taken. Reopen the original player tab or start another match.');
      return;
    }
    if (data.type === 'welcome' && this.challenge) {
      const challenge = this.challenge;
      this.challenge = null;
      const proof = await crypto.subtle.sign('HMAC', this.inviteKey, encoder.encode(challenge));
      if (connection !== this.conn) return;
      if (data.proof !== toHex(proof)) throw Error('Could not verify the host for this invite.');
      this.hostVerified = true;
      connection.send({ type:'join', invite:this.record.id, seatKey:this.record.guest });
      return;
    }
    if (!this.hostVerified || data.type !== 'state' || !Array.isArray(data.moves)) return;
    const old = this.game.moves;
    if (data.moves.length < old.length || !old.every((m, i) => same(m, data.moves[i]))) throw Error('The room history changed.');
    if (old.length && this.record.side !== data.side) throw Error('The board size changed.');
    let next = old.length ? this.game : newGame(data.side);
    for (let i = old.length; i < data.moves.length; i++) next = play(next, data.moves[i]);
    this.record.side = data.side;
    this.game = next;
    this.persist();
    this.ready();
  }

  move(action) {
    if (!this.myTurn) throw Error(this.phase === 'ready' ? 'Wait for your opponent’s turn.' : this.detail);
    const next = play(this.game, action);
    try {
      if (this.record.seat === 'black') {
        this.game = next;
        this.persist();
        this.snapshot();
      } else {
        this.pending = true;
        this.conn.send({type:'move', revision:this.game.moves.length, action:compact(action)});
        this.timeout = setTimeout(() => this.retry('Move confirmation timed out.'), 10000);
      }
      this.changed();
    } catch { this.retry('Connection interrupted. Reconnecting to confirm the board.'); }
  }

  clearConnection() {
    clearTimeout(this.timeout);
    clearTimeout(this.retryTimer);
    const peer = this.peer;
    this.peer = null;
    this.hostVerified = false;
    this.challenge = null;
    this.conn = null;
    this.pending = false;
    peer?.destroy();
  }

  retry(reason) {
    if (this.closed) return;
    this.clearConnection();
    this.attempt++;
    this.setState('reconnecting', reason + ' Retrying…');
    this.retryTimer = setTimeout(() => this.connect(), Math.min(1000 * this.attempt, 8000));
  }

  leave() {
    this.closed = true;
    this.clearConnection();
    try { sessionStorage.removeItem(storageKey); } catch {}
  }
}

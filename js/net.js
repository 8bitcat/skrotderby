// PeerJS-lager: värden äger simuleringen, gäster skickar input och får snapshots.
// Handlers sätts efter skapandet (net.handlers.onData = ...) — de läses vid händelsetillfället.
const PREFIX = 'skrotderby-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // utan lättförväxlade I/O

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function peerAvailable() {
  return typeof window.Peer !== 'undefined';
}

export class HostNet {
  constructor(code) {
    this.code = code;
    this.conns = new Map();
    this.handlers = {};
  }

  static create(code) {
    return new Promise((resolve, reject) => {
      if (!peerAvailable()) return reject(new Error('PeerJS kunde inte laddas'));
      const net = new HostNet(code);
      let opened = false;
      const peer = new window.Peer(PREFIX + code);
      net.peer = peer;
      peer.on('open', () => { opened = true; resolve(net); });
      peer.on('error', (e) => {
        if (!opened) reject(e);
        else net.handlers.onError?.(e);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => net.conns.set(conn.peer, conn));
        conn.on('data', (d) => net.handlers.onData?.(conn.peer, d));
        conn.on('close', () => {
          if (net.conns.delete(conn.peer)) net.handlers.onLeave?.(conn.peer);
        });
        conn.on('error', () => {
          if (net.conns.delete(conn.peer)) net.handlers.onLeave?.(conn.peer);
        });
      });
      setTimeout(() => { if (!opened) reject(new Error('Timeout mot PeerJS-servern')); }, 10000);
    });
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  broadcast(msg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }
}

export class ClientNet {
  constructor() { this.handlers = {}; }

  static join(code) {
    return new Promise((resolve, reject) => {
      if (!peerAvailable()) return reject(new Error('PeerJS kunde inte laddas'));
      const net = new ClientNet();
      let done = false;
      const peer = new window.Peer();
      net.peer = peer;
      const timeout = setTimeout(() => {
        if (!done) { done = true; reject(new Error('Hittade inget rum med den koden')); }
      }, 10000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        net.conn = conn;
        conn.on('open', () => {
          if (!done) { done = true; clearTimeout(timeout); resolve(net); }
        });
        conn.on('data', (d) => net.handlers.onData?.(d));
        conn.on('close', () => net.handlers.onClose?.());
        conn.on('error', (e) => {
          if (!done) { done = true; clearTimeout(timeout); reject(e); }
        });
      });
      peer.on('error', (e) => {
        if (!done) { done = true; clearTimeout(timeout); reject(e); }
      });
    });
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }
}

// Client for the F1 live-timing SignalR Core hub (the same feed used by the official live timing page).
const HOST = 'livetiming.formula1.com';
const UA = 'BestHTTP';
export const TOPICS = ['Heartbeat', 'SessionInfo', 'SessionStatus', 'TrackStatus', 'LapCount', 'WeatherData', 'RaceControlMessages', 'TeamRadio', 'DriverList', 'TimingData', 'TimingAppData', 'PitLaneTimeCollection', 'CarData.z', 'Position.z'];
const SEP = '\x1e';

export class F1Feed {
  constructor({ onSnapshot, onMessage, onState, log = () => {} }) {
    Object.assign(this, { onSnapshot, onMessage, onState, log });
    this.ws = null;
    this.stopped = false;
    this.retry = 0;
    this.connected = false;
  }

  start() { this.stopped = false; this.open(); }
  stop() { this.stopped = true; clearInterval(this.ping); try { this.ws?.close(); } catch { /* ignore */ } }

  async open() {
    try {
      const res = await fetch(`https://${HOST}/signalrcore/negotiate?negotiateVersion=1`, { method: 'POST', headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip,identity' } });
      if (!res.ok) throw new Error(`negotiate ${res.status}`);
      const j = await res.json();
      const cookie = (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
      const ws = new WebSocket(`wss://${HOST}/signalrcore?id=${encodeURIComponent(j.connectionToken)}`, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip,identity', Cookie: cookie } });
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + SEP);
      ws.onmessage = ev => this.handle(String(ev.data));
      ws.onerror = () => this.log('feed websocket error');
      ws.onclose = () => this.closed();
    } catch (e) {
      this.log(`feed connect failed: ${e.message}`);
      this.closed();
    }
  }

  closed() {
    clearInterval(this.ping);
    if (this.connected) this.onState?.(false);
    this.connected = false;
    if (this.stopped) return;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(this.retry++, 5));
    this.log(`feed reconnecting in ${wait} ms`);
    setTimeout(() => this.open(), wait);
  }

  handle(raw) {
    for (const part of raw.split(SEP).filter(Boolean)) {
      let m;
      try { m = JSON.parse(part); } catch { continue; }
      if (m.type === undefined && m.target === undefined) {
        // handshake accepted
        this.ws.send(JSON.stringify({ type: 1, target: 'Subscribe', arguments: [TOPICS], invocationId: '1' }) + SEP);
        this.ping = setInterval(() => { try { this.ws.send(JSON.stringify({ type: 6 }) + SEP); } catch { /* closed */ } }, 15000);
      } else if (m.type === 3 && m.invocationId === '1') {
        this.retry = 0;
        this.connected = true;
        this.onState?.(true);
        if (m.result) this.onSnapshot?.(m.result);
      } else if (m.type === 1 && m.target === 'feed') {
        const [topic, data, ts] = m.arguments;
        this.onMessage?.(topic, data, ts ? Date.parse(ts.endsWith('Z') ? ts : `${ts}Z`) : Date.now());
      } else if (m.type === 7) {
        try { this.ws.close(); } catch { /* ignore */ }
      }
    }
  }
}

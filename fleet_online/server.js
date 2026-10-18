import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomInt } from 'node:crypto';

const app = express();
const http = createServer(app);
const io = new Server(http);
app.use(express.static('public'));

const rooms = new Map();
const hpByType = { S: 3, J: 2, K: 1 };
const defaultQuotas = [{ S: 1, J: 2, K: 3 }, { S: 1, J: 2, K: 3 }];
const valid = p => typeof p === 'string' && /^[A-E][1-5]$/.test(p);
const dist = (a, b) => [Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a[1]) - Number(b[1]))];
const total = q => Object.values(q).reduce((a, b) => a + b, 0);
const freshPlayer = id => ({ id, ready: false, ships: {}, ownLog: [], enemyLog: [] });
function makeRoom() {
  let id;
  do { id = String(randomInt(0, 100000)).padStart(5, '0'); } while (rooms.has(id));
  return id;
}
function view(r, side) {
  const p = r.players[side], other = r.players[1 - side];
  return {
    id: r.id, side, phase: r.phase, turn: r.turn, ready: p.ready,
    opponentReady: !!other?.ready, opponentConnected: !!other,
    ships: p.ships, ownLog: p.ownLog, enemyLog: p.enemyLog,
    win: r.win, quotas: r.quotas, opponentShips: other ? Object.keys(other.ships).length : null,
    lastAttack: r.lastAttack
  };
}
function push(r) { r.players.forEach((p, i) => { if (p) io.to(p.id).emit('state', view(r, i)); }); }
function notice(r, side, msg) { if (r.players[side]) io.to(r.players[side].id).emit('notice', msg); }
function reply(cb, result) { if (typeof cb === 'function') cb(result); }
function authorized(socket, r) { return r && r.players[socket.data.side]?.id === socket.id; }
function parseQuota(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  const result = {};
  for (const t of ['S', 'J', 'K']) {
    if (!Number.isInteger(q[t]) || q[t] < 0 || q[t] > 5) return null;
    result[t] = q[t];
  }
  return total(result) >= 1 && total(result) <= 25 ? result : null;
}

io.on('connection', socket => {
  socket.on('create', (_, cb) => {
    if (socket.data.room) return reply(cb, { ok: false, error: 'すでにルームに参加しています' });
    const id = makeRoom();
    const r = { id, phase: 'setup', turn: 0, players: [freshPlayer(socket.id), null], win: null,
      quotas: defaultQuotas.map(q => ({ ...q })), lastAttack: null, seq: 0 };
    rooms.set(id, r); socket.data.room = id; socket.data.side = 0; socket.join(id);
    reply(cb, { ok: true, id }); push(r);
  });
  socket.on('join', ({ id } = {}, cb) => {
    if (socket.data.room) return reply(cb, { ok: false, error: 'すでにルームに参加しています' });
    const r = rooms.get(String(id));
    if (!r || r.players[1] || r.phase !== 'setup') return reply(cb, { ok: false, error: 'ルームがないか、満員です' });
    r.players[1] = freshPlayer(socket.id); socket.data.room = r.id; socket.data.side = 1; socket.join(r.id);
    reply(cb, { ok: true, id: r.id }); push(r);
  });
  socket.on('settings', ({ quotas } = {}, cb) => {
    const r = rooms.get(socket.data.room);
    if (!authorized(socket, r) || socket.data.side !== 0 || r.phase !== 'setup' || r.players.some(p => p?.ready))
      return reply(cb, { ok: false, error: '設定は準備完了前のルームオーナーだけが変更できます' });
    if (!Array.isArray(quotas) || quotas.length !== 2) return reply(cb, { ok: false, error: '設定が不正です' });
    const parsed = quotas.map(parseQuota);
    if (parsed.some(q => !q)) return reply(cb, { ok: false, error: '各艦種は0〜5隻、合計1〜25隻にしてください' });
    r.quotas = parsed; reply(cb, { ok: true }); push(r);
  });
  socket.on('place', ({ ships } = {}, cb) => {
    const r = rooms.get(socket.data.room), s = socket.data.side;
    if (!authorized(socket, r) || r.phase !== 'setup' || r.players[s].ready)
      return reply(cb, { ok: false, error: '配置できません' });
    if (!ships || typeof ships !== 'object' || Array.isArray(ships))
      return reply(cb, { ok: false, error: '配置が不正です' });
    const entries = Object.entries(ships), counts = { S: 0, J: 0, K: 0 };
    for (const [p, t] of entries) {
      if (!valid(p) || !hpByType[t]) return reply(cb, { ok: false, error: '不正な配置です' });
      counts[t]++;
    }
    if (Object.keys(counts).some(t => counts[t] !== r.quotas[s][t]))
      return reply(cb, { ok: false, error: '設定された艦数どおりに配置してください' });
    r.players[s].ships = Object.fromEntries(entries.map(([p, t]) => [p, { hp: hpByType[t] }]));
    r.players[s].ready = true;
    if (r.players.every(p => p?.ready)) {
      r.phase = 'play'; r.turn = 0;
      r.players.forEach(p => p.ownLog.push('両者準備完了。対戦開始！'));
    }
    reply(cb, { ok: true }); push(r);
  });
  socket.on('action', ({ from, to, kind } = {}, cb) => {
    const r = rooms.get(socket.data.room), s = socket.data.side;
    if (!authorized(socket, r) || r.phase !== 'play' || r.turn !== s)
      return reply(cb, { ok: false, error: '今はあなたのターンではありません' });
    const me = r.players[s], opp = r.players[1 - s];
    if (!opp || !valid(from) || !valid(to) || !me.ships[from])
      return reply(cb, { ok: false, error: '自分の艦を選んでください' });
    const [a, b] = dist(from, to);
    if (kind === 'move') {
      if (a + b !== 1 || me.ships[to])
        return reply(cb, { ok: false, error: '上下左右の空きマスに1マスだけ移動できます' });
      me.ships[to] = me.ships[from]; delete me.ships[from];
      me.ownLog.push(`${from} → ${to} に移動`);
      opp.enemyLog.push(`敵艦が${a === 1 ? (from[0] < to[0] ? '南' : '北') : (Number(from[1]) < Number(to[1]) ? '東' : '西')}へ1マス移動`);
      r.lastAttack = null;
    } else if (kind === 'fire') {
      if (Math.max(a, b) !== 1) return reply(cb, { ok: false, error: '周囲8マスだけ攻撃できます' });
      const shots = me.ships[from].hp, target = opp.ships[to], hit = !!target;
      r.lastAttack = { seq: ++r.seq, attacker: s, from, to, shots, hit };
      me.ownLog.push(`${from} → ${to} に魚雷${shots}発発射`);
      opp.enemyLog.push(`${to} に敵の魚雷${shots}発が着弾`);
      if (hit) {
        target.hp -= shots;
        const status = target.hp <= 0 ? '沈没' : target.hp === 1 ? '大破' : '小破';
        if (target.hp <= 0) delete opp.ships[to];
        me.ownLog.push(`命中！ ${status}`); opp.enemyLog.push(`${to} が被弾！ ${status}`);
        notice(r, s, `命中！ ${status}`); notice(r, 1 - s, `${to} が被弾！ ${status}`);
      } else {
        const nearest = Math.min(99, ...Object.keys(opp.ships).map(p => Math.max(...dist(p, to))));
        const result = nearest === 1 ? '危うし' : 'さざ波';
        me.ownLog.push(result); opp.enemyLog.push(`判定：${result}`); notice(r, s, result);
      }
    } else return reply(cb, { ok: false, error: '不正な操作です' });
    if (Object.keys(opp.ships).length === 0) {
      r.phase = 'ended'; r.win = s; me.ownLog.push('勝利！'); opp.enemyLog.push('敗北');
    } else r.turn = 1 - s;
    reply(cb, { ok: true }); push(r);
  });
  socket.on('disconnect', () => {
    const r = rooms.get(socket.data.room), s = socket.data.side;
    if (!authorized(socket, r)) return;
    if (r.phase === 'play') { r.phase = 'ended'; r.win = 1 - s; }
    r.players[s] = null; push(r);
    if (r.players.every(p => !p)) rooms.delete(r.id);
  });
});

http.listen(process.env.PORT || 3000, () => console.log('Fleet Tactics v2 ready'));

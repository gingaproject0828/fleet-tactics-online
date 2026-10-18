import express from 'express';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {randomInt} from 'node:crypto';
const app=express(),http=createServer(app),io=new Server(http);app.use(express.static('public'));
const rooms=new Map(),types={S:3,J:2,K:1},quota={S:1,J:2,K:3};
const valid=p=>typeof p==='string'&&/^[A-E][1-5]$/.test(p);
const dist=(a,b)=>{let x=a.charCodeAt(0)-b.charCodeAt(0),y=Number(a[1])-Number(b[1]);return [Math.abs(x),Math.abs(y)]};
function view(room,side){const p=room.players[side],other=room.players[1-side];return {id:room.id,side,phase:room.phase,turn:room.turn,ready:p.ready,opponentReady:other?.ready||false,ships:p.ships,events:p.events,opponentConnected:!!other,win:room.win};}
function push(room){room.players.forEach((p,i)=>{if(p)io.to(p.id).emit('state',view(room,i))})}
function notify(room,side,msg){io.to(room.players[side].id).emit('notice',msg)}

function makeRoom() {
  let id;
  do {
    id = String(randomInt(0, 100000)).padStart(5, '0');
  } while (rooms.has(id));
  return id;
}

io.on('connection',socket=>{
 socket.on('create',(_,cb)=>{let id=makeRoom(),room={id,phase:'setup',turn:0,players:[{id:socket.id,ready:false,ships:{},events:[]},null],win:null};rooms.set(id,room);socket.data.room=id;socket.data.side=0;socket.join(id);cb({ok:true,id});push(room)});
 socket.on('join',({id},cb)=>{let r=rooms.get(String(id));if(!r||r.players[1]||r.phase!=='setup')return cb({ok:false,error:'ルームがないか、満員です'});r.players[1]={id:socket.id,ready:false,ships:{},events:[]};socket.data.room=r.id;socket.data.side=1;socket.join(r.id);cb({ok:true,id:r.id});push(r)});
 socket.on('place',({ships},cb)=>{let r=rooms.get(socket.data.room),s=socket.data.side;if(!r||r.phase!=='setup'||r.players[s]?.id!==socket.id)return cb({ok:false,error:'配置できません'});let entries=Object.entries(ships||{}),counts={S:0,J:0,K:0};for(let [p,t] of entries){if(!valid(p)||!types[t])return cb({ok:false,error:'不正な配置'});counts[t]++}if(Object.keys(quota).some(k=>counts[k]!==quota[k]))return cb({ok:false,error:'S1隻・J2隻・K3隻を配置してください'});r.players[s].ships=Object.fromEntries(entries.map(([p,t])=>[p,{hp:types[t]}]));r.players[s].ready=true;if(r.players.every(p=>p?.ready)){r.phase='play';r.turn=0;r.players.forEach(p=>p.events.push('両者準備完了。対戦開始！'))}cb({ok:true});push(r)});
 socket.on('action',({from,to,kind},cb)=>{let r=rooms.get(socket.data.room),s=socket.data.side;if(!r||r.phase!=='play'||r.turn!==s||r.players[s]?.id!==socket.id)return cb({ok:false,error:'今はあなたのターンではありません'});let me=r.players[s],opp=r.players[1-s];if(!valid(from)||!valid(to)||!me.ships[from])return cb({ok:false,error:'自分の艦を選んでください'});let [a,b]=dist(from,to);if(kind==='move'){if(a+b!==1||me.ships[to])return cb({ok:false,error:'上下左右の空きマスに1マスだけ移動できます'});me.ships[to]=me.ships[from];delete me.ships[from];me.events.push(`${from} → ${to} に移動`);opp.events.push(`相手が${a===1?(from[0]<to[0]?'南':'北'):(Number(from[1])<Number(to[1])?'東':'西')}へ1マス移動`)}else if(kind==='fire'){if(Math.max(a,b)!==1)return cb({ok:false,error:'周囲8マスだけ攻撃できます'});let shots=me.ships[from].hp,target=opp.ships[to];me.events.push(`${to} に${shots}発発射`);opp.events.push(`相手が${to}に${shots}発発射`);if(target){target.hp-=shots;let status=target.hp<=0?'沈没':target.hp===1?'大破':'小破';if(target.hp<=0)delete opp.ships[to];me.events.push(`命中！ ${status}`);opp.events.push(`${to}が被弾！ ${status}`);notify(r,s,`命中！ ${status}`);notify(r,1-s,`${to}が被弾！ ${status}`)}else{let nearest=Math.min(...Object.keys(opp.ships).map(p=>Math.max(...dist(p,to))),99);let result=nearest===1?'危うし':'さざ波';me.events.push(result);opp.events.push(`判定：${result}`);notify(r,s,result)} }else return cb({ok:false,error:'不正な操作'});
 if(Object.keys(opp.ships).length===0){r.phase='ended';r.win=s;me.events.push('勝利！');opp.events.push('敗北')}else r.turn=1-s;cb({ok:true});push(r)});
 socket.on('disconnect',()=>{let r=rooms.get(socket.data.room);if(!r)return;let s=socket.data.side;if(r.players[s]?.id===socket.id){if(r.phase==='play'){r.phase='ended';r.win=1-s}r.players[s]=null;push(r);if(r.players.every(p=>!p))rooms.delete(r.id)}})
});
http.listen(process.env.PORT||3000,()=>console.log('Fleet online ready'));

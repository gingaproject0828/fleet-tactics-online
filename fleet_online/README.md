# FLEET TACTICS ONLINE

Two-player room-ID naval game. Server required: this cannot run by opening index.html alone.

## Run locally

Install Node.js 18+ then run:

```sh
npm install
npm start
```

Open http://localhost:3000 on two browser tabs for a test. For play across devices, deploy this folder to a Node.js host supporting persistent Socket.IO WebSocket connections (e.g. Render Web Service). Build command `npm install`, start command `npm start`.

## Rules

5x5, 1 S (3 HP), 2 J (2 HP), 3 K (1 HP); one orthogonal square per move, or fire at one of eight neighboring squares, using all current HP as shots. Damage reduces HP, downranking S->J->K; all 6 enemy ships sunk wins. Radar notes are local, manually entered and never auto-filled. No account system, reconnect recovery, or persistent storage in this prototype. Rooms disappear on server restart.

import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:3011');
ws.on('open', () => {
  console.log('Connected!');
  ws.send(JSON.stringify({ type: 'control', command: 'start' }));
  setTimeout(() => process.exit(0), 1000);
});
ws.on('message', (data) => console.log('Received:', data.toString()));
ws.on('error', (err) => { console.error('WS Error:', err); process.exit(1); });

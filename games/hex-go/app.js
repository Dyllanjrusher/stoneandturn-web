import { newGame, play, replay, score, BONUS } from './rules.js';
import { games } from '../../catalog.js';

const $ = id => document.getElementById(id);
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  sound:'<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted:'<path d="M3 9h4l5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>',
  hex:'<path d="m12 2 8.7 5v10L12 22l-8.7-5V7z"/><path d="m8 9 4-2.3L16 9v5l-4 2.3L8 14z"/>',
  book:'<path d="M12 6C9 4 6 4 2.5 5v14c3.5-1 6.5-1 9.5 1 3-2 6-2 9.5-1V5c-3.5-1-6.5-1-9.5 1Zm0 0v14"/>',
  sliders:'<path d="M3 7h4m5 0h9M3 17h10m5 0h3"/><circle cx="9.5" cy="7" r="2.5"/><circle cx="15.5" cy="17" r="2.5"/>',
  pass:'<path d="M5 6l8 6-8 6zm10 0v12m4-12v12"/>',
  undo:'<path d="m8 5-5 5 5 5m-5-5h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  history:'<path d="M3 10a9 9 0 1 1 1.8 7M3 5v5h5m4-4v6l4 2"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 9 9 5 9-5" transform="translate(0 -1) scale(1 .95)"/>',
  list:'<path d="M9 6h11M9 12h8M9 18h10"/><circle cx="4" cy="6" r=".7"/><circle cx="4" cy="12" r=".7"/><circle cx="4" cy="18" r=".7"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
const icon = name => '<svg aria-hidden="true" class="icon" viewBox="0 0 24 24">' + icons[name] + '</svg>';
document.querySelectorAll('i[data-icon]').forEach(i => { i.outerHTML = icon(i.dataset.icon); });
const cap = text => text[0].toUpperCase() + text.slice(1);
const saveKey = 'gridroom.hex-go.v1';
let game = newGame();
let sound = false;
let audio;
let timer;
let focusIndex;
function notice(message) {
  $('notice').textContent = message;
  clearTimeout(timer);
  timer = setTimeout(() => { $('notice').textContent = ''; }, 4200);
}
try {
  sound = localStorage.getItem('gridroom.sound') === 'on';
  const saved = JSON.parse(localStorage.getItem(saveKey));
  if (saved) game = replay(saved.side, saved.moves);
} catch { notice('The saved game could not be loaded. A fresh board is ready.'); }
function save() {
  try { localStorage.setItem(saveKey, JSON.stringify({ side: game.side, moves: game.moves })); }
  catch { notice('This browser could not save the match. You can still play here.'); }
}
function clickSound(freq = 420) {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    audio.resume().then(() => {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq,t);
      oscillator.frequency.exponentialRampToValueAtTime(freq/2,t+.09);
      gain.gain.setValueAtTime(.12,t); gain.gain.exponentialRampToValueAtTime(.001,t+.09);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(t); oscillator.stop(t+.1);
    }).catch(() => {});
  } catch { /* Audio is optional. */ }
}
function soundButton() {
  $('sound').innerHTML = icon(sound ? 'sound' : 'muted');
  $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', 'Game sound');
  $('sound').title = sound ? 'Mute sound' : 'Enable sound';
}
$('sound').onclick = () => {
  sound = !sound; soundButton(); clickSound();
  try { localStorage.setItem('gridroom.sound', sound ? 'on' : 'off'); } catch {}
};

const R = 22, W = Math.sqrt(3)*R;
const vertices = [];
for (let k=0; k<6; k++) {
  const angle = (k*60-90)*Math.PI/180;
  vertices.push((R*Math.cos(angle)).toFixed(3)+','+(R*Math.sin(angle)).toFixed(3));
}
const hex = vertices.join(' ');
const defs = '<defs><radialGradient id="darkStone" cx=".32" cy=".24" r=".79"><stop stop-color="#626b68"/><stop offset=".32" stop-color="#3b4440"/><stop offset=".76" stop-color="#19201e"/><stop offset="1" stop-color="#0a0f0e"/></radialGradient><radialGradient id="lightStone" cx=".33" cy=".25" r=".8"><stop stop-color="#fff"/><stop offset=".5" stop-color="#e2e9e2"/><stop offset="1" stop-color="#9aaba3"/></radialGradient></defs>';
function renderBoard() {
  const board = $('board'), range = game.side-1;
  const width = W*(2*range+1)+60, height = R*(3*range+2)+40;
  board.setAttribute('viewBox', [-width/2,-height/2,width,height].join(' '));
  let rows = '', tiles = '';
  const latest = game.moves.findLast(m => m.type === 'place');
  const final = game.ended ? score(game) : null;
  const paint = ['#253630','#293b34','#2a3d36','#253831','#2d4038','#293b34'];
  focusIndex ??= Math.floor(game.cells.length/2);
  game.cells.forEach(({ q,r,name },i) => {
    const x = W*(q+r/2), y = R*1.5*r;
    if (name.endsWith('1') && name.length === 2) {
      rows += '<text class="board-letter" text-anchor="middle" x="'+(x-W*.87)+'" y="'+(y+3)+'">'+name[0]+'</text>';
    }
    const color = game.stones[i], last = latest?.cell === i;
    const dist = Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));
    const star = dist === 0 || (dist === range-2 && (q===0 || r===0 || q+r===0));
    let mark = star ? '<circle r="2" fill="#8da596"/>' : '';
    if (color) {
      mark = '<circle cy="1.7" r="15.5" fill="#08120d" opacity=".6"/><circle r="15.2" fill="url(#'+(color==='black'?'darkStone':'lightStone')+')" stroke="'+(color==='black'?'#78847a':'#d0dbd1')+'" stroke-width=".7"/>';
      if (last) mark += '<circle r="3.4" fill="none" stroke="'+(color==='black'?'#b6e7ca':'#486458')+'" stroke-width="1.1"/>';
    } else if (final?.ownership[i]) {
      mark = '<rect x="-3.5" y="-3.5" width="7" height="7" rx="1" fill="'+(final.ownership[i]==='black'?'#111714':'#e5ece6')+'" stroke="#83948a" stroke-width=".6"/>';
    }
    const label = name+', '+(color || 'empty');
    tiles += '<g class="cell" tabindex="'+(i===focusIndex?0:-1)+'" role="button" aria-label="'+label+'" data-i="'+i+'" transform="translate('+x+','+y+')"><title>'+label+'</title><polygon class="tile" points="'+hex+'" fill="'+paint[(i*7+Math.abs(r*3+q))%paint.length]+'"/><g pointer-events="none">'+mark+'</g></g>';
  });
  board.innerHTML = defs+rows+tiles;
}

function render() {
  renderBoard();
  const num = game.moves.length;
  $('sizeText').textContent = game.cells.length+' hexes';
  $('moveNumber').textContent = 'Move '+String(num).padStart(2,'0');
  $('blackCaptures').textContent = game.captures.black;
  $('whiteCaptures').textContent = game.captures.white;
  const points = game.ended ? score(game).points : null;
  const current = points ? (points.black > points.white ? 'black':'white') : game.turn;
  $('turnStone').className = 'stone '+current;
  $('turnLabel').textContent = game.ended ? 'FINAL RESULT' : 'CURRENT TURN';
  $('turn').textContent = cap(current)+(game.ended ? ' wins' : ' to play');
  $('pass').innerHTML = icon(game.ended?'layers':'pass')+(game.ended?'View score':'Pass turn');
  $('undo').disabled = !num;
  $('count').textContent = num;
  $('history').innerHTML = num ? game.moves.map((m,j) =>
    '<div class="history-row"><span class="move-index">'+String(j+1).padStart(2,'0')+'</span><span class="stone '+m.color+'"></span>'+cap(m.color)+'<span class="coord">'+(m.type==='pass'?'Pass':game.cells[m.cell].name+(m.taken?' · captured '+m.taken:''))+'</span></div>'
  ).reverse().join('') : '<div class="empty-history">'+icon('list')+'<strong>No moves yet</strong><span>Place a stone to begin.</span></div>';
}
function show(title, content) {
  $('dialogTitle').textContent = title; $('dialogBody').innerHTML = content;
  $('modal').setAttribute('aria-labelledby','dialogTitle');
  $('modal').showModal();
}
function result() {
  const { points } = score(game);
  show($('turn').textContent, '<p>Each stone and each owned empty hex scores one point.</p><div class="result">Black<strong>'+points.black+'</strong></div><div class="result">White<strong>'+points.white+'</strong></div><p>White’s total includes the '+BONUS+' tie-break bonus. Small squares mark owned empty cells on the board.</p><button class="primary" id="review">Review board</button>');
  $('review').onclick = () => $('modal').close();
}
function submit(action) {
  try { game = play(game, action); } catch (error) { notice(error.message); return; }
  clickSound(game.turn==='black'?480:360);
  save(); render();
  const move = game.moves.at(-1);
  if (game.ended) { result(); return; }
  const next = cap(game.turn)+' to play.';
  notice(move.type === 'pass' ? cap(move.color)+' passed. '+next+' A second pass ends the game.' :
    cap(move.color)+' played '+game.cells[move.cell].name+'. '+(move.taken?'Captured '+move.taken+'. ':'')+next);
}
const board = $('board');
board.onclick = e => {
  const cell = e.target.closest('.cell'); if (!cell || game.ended) return;
  focusIndex = Number(cell.dataset.i); submit({ type: 'place', cell: focusIndex });
};
board.onkeydown = e => {
  const cell = e.target.closest('.cell'); if (!cell) return;
  const i = Number(cell.dataset.i), { q, r } = game.cells[i];
  if (e.key==='Enter' || e.key===' ') {
    e.preventDefault();
    if (!game.ended) { focusIndex=i; submit({type:'place', cell:i}); if (!$('modal').open) board.querySelector('[data-i="'+i+'"]').focus(); }
    return;
  }
  const steps = {ArrowRight:[1,0], ArrowLeft:[-1,0], ArrowUp:[e.shiftKey?1:0,-1], ArrowDown:[e.shiftKey?-1:0,1]};
  if (!steps[e.key]) return;
  e.preventDefault();
  const [dq,dr] = steps[e.key], dest = game.cells.findIndex(n => n.q===q+dq && n.r===r+dr);
  if (dest >= 0) { board.querySelector('[tabindex="0"]').setAttribute('tabindex','-1'); const target=board.querySelector('[data-i="'+dest+'"]'); target.setAttribute('tabindex','0'); focusIndex=dest; target.focus(); }
};
$('pass').onclick = () => game.ended ? result() : submit({ type: 'pass' });
$('undo').onclick = () => {
  if (!game.moves.length) return;
  game = replay(game.side, game.moves.slice(0,-1)); save(); render(); notice('Last turn undone. '+cap(game.turn)+' to play.');
};
$('new').onclick = () => {
  show('New game','<p>Start a fresh local match for two players.'+(game.moves.length?' This replaces the current match.':'')+'</p><label for="size">Board size</label><select id="size"><option value="4">Small · 37 hexes</option><option value="5">Standard · 61 hexes</option><option value="6">Large · 91 hexes</option></select><button class="primary" id="start">Start game</button>');
  $('size').value = game.side;
  $('start').onclick = () => { game=newGame(Number($('size').value)); focusIndex=undefined; save(); render(); $('modal').close(); notice('New match. Black to play.'); };
};
$('rules').onclick = () => show('How to play','<p>Claim the most area on the hex board. Share one device and take turns, starting with Black.</p><ol><li><strong>Place a stone.</strong> Choose any empty hex. Friendly stones that share an edge form a group.</li><li><strong>Keep a liberty.</strong> Each empty hex touching a group by an edge is a liberty. Fill its last liberty to capture the entire group. The edge of the board provides no liberties.</li><li><strong>Capture first.</strong> Remove surrounded enemy groups, then check your own. Your group must have a liberty, and a placement must leave a board position that has never appeared in this match.</li><li><strong>Pass to finish.</strong> Play out disputed captures before passing. Two consecutive passes end the match. Stones still on the board count as alive.</li><li><strong>Count area.</strong> Score one point per stone and per empty hex in a connected region touching only your color. Mixed or unbordered regions score zero. Captures do not add points. White receives half a point to break ties.</li></ol><p>Keyboard play uses the arrow keys and Enter. Hold Shift with Up or Down for the other diagonal.</p>');
$('library').onclick = () => {
  show('Game library', games.map(g => '<a class="game-card" href="'+g.path+'">'+icon('hex')+'<span><strong>'+g.title+'</strong><small>'+g.genre+' · '+g.players+'</small></span><span class="coord">Play</span></a>').join(''));
};
$('close').onclick = () => $('modal').close();
$('modal').onclick = e => {
  if (e.target !== $('modal')) return;
  const rect=$('modal').getBoundingClientRect();
  if (e.clientX<rect.left || e.clientX>rect.right || e.clientY<rect.top || e.clientY>rect.bottom) $('modal').close();
};
soundButton(); render();

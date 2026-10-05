import * as THREE from 'three';
import { createStage, makePlush } from './scene.js';
import { Character } from './character.js';
import { Director, ACTIONS, EMOTIONS } from './actions.js';

// URL options:  ?obs  -> transparent background, no control panel (for OBS)
//               ?demo -> start the auto demo loop
const params = new URLSearchParams(location.search);
const obs = params.has('obs');
if (obs) document.body.classList.add('obs');

const { renderer, scene, camera, desk } = createStage(document.getElementById('stage'), { transparent: obs });
const character = new Character();
scene.add(character.root);

const bubble = document.getElementById('bubble');
const director = new Director({
  character, scene, desk, plush: makePlush(),
  onSay: text => {
    bubble.textContent = text;
    bubble.style.display = text ? 'block' : 'none';
  },
});

// Console / later-stage hook:  vtuber.command({ action: 'jump', emotion: 'happy', say: "LET'S GO" })
window.vtuber = { command: cmd => director.command(cmd) };

// ---------- control panel ----------
const emotionSel = document.getElementById('emotion');
for (const e of EMOTIONS) emotionSel.add(new Option(e, e));
const sayInput = document.getElementById('say');

function send(action) {
  director.command({ action, emotion: emotionSel.value, say: sayInput.value });
  sayInput.value = '';
}

const actionRow = document.getElementById('actions');
ACTIONS.filter(a => a !== 'idle').forEach((a, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${a}`;
  b.onclick = () => send(a);
  actionRow.appendChild(b);
});

sayInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') send('idle');
  e.stopPropagation();
});
window.addEventListener('keydown', e => {
  const a = ACTIONS.filter(x => x !== 'idle')[Number(e.key) - 1];
  if (a) send(a);
});

// ---------- auto demo (stand-in for the AI brain until Stage 4) ----------
const DEMO = [
  { action: 'jump',  emotion: 'happy',     say: "LET'S GOOO! Did you SEE that?!" },
  { action: 'angry', emotion: 'angry',     say: 'Are you KIDDING me right now?' },
  { action: 'throw', emotion: 'angry',     say: "That's it. I'm done. I'm DONE." },
  { action: 'sit',   emotion: 'neutral',   say: 'Okay okay, back to watching.' },
  { action: 'wave',  emotion: 'happy',     say: 'Hi chat!' },
  { action: 'walk',  emotion: 'surprised', say: 'Wait wait wait... what?' },
  { action: 'idle',  emotion: 'sad',       say: 'Bro... that was my favorite.' },
];
const demoBox = document.getElementById('demo');
demoBox.checked = params.has('demo');
let demoTimer = 3;

// ---------- main loop ----------
const queueLabel = document.getElementById('queue');
const headPos = new THREE.Vector3();
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (demoBox.checked && !director.busy) {
    demoTimer -= dt;
    if (demoTimer <= 0) {
      director.command(DEMO[Math.floor(Math.random() * DEMO.length)]);
      demoTimer = 3 + Math.random() * 4;
    }
  }

  director.update(dt);
  character.update(dt, t);
  renderer.render(scene, camera);

  if (bubble.style.display === 'block') {
    character.headWorldPosition(headPos).project(camera);
    bubble.style.left = `${(headPos.x * 0.5 + 0.5) * innerWidth}px`;
    bubble.style.top = `${(-headPos.y * 0.5 + 0.5) * innerHeight}px`;
  }
  queueLabel.textContent = director.busy ? `busy, ${director.queue.length} queued` : 'ready';
});

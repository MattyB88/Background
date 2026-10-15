// Fridge display: polls the Pi's game state and animates between polls.
(() => {
  const $ = (id) => document.getElementById(id);
  const POLL_MS = 400;

  let state = { phase: "idle" };
  let lastPhase = null;
  let deadline = 0; // performance.now() ms when the current countdown hits 0
  let lastTick = -1;

  // ---------------------------------------------------------------- sound
  // Chromium kiosk is started with --autoplay-policy=no-user-gesture-required.
  let audio;
  function tone(freq, start, dur, type = "square", vol = 0.15) {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime + start;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
  const sounds = {
    announce: () => { for (let i = 0; i < 6; i++) { tone(880, i * 0.25, 0.12); tone(660, i * 0.25 + 0.12, 0.12); } },
    go: () => tone(1320, 0, 0.4),
    tick: () => tone(1000, 0, 0.06, "sine", 0.2),
    success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.25, "triangle", 0.25)),
    fail: () => [392, 370, 349, 262].forEach((f, i) => tone(f, i * 0.4, i === 3 ? 1.0 : 0.38, "sawtooth", 0.15)),
  };
  function play(name) { try { sounds[name](); } catch (e) { /* no audio device */ } }

  // ---------------------------------------------------------------- render
  function renderClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }

  function renderIdle(s) {
    const n = s.events_left_today;
    $("lurking").textContent = s.paused ? "" :
      n === 0 ? "No more challenges today… or are there? 👀" :
      `⚡ ${n} challenge${n === 1 ? "" : "s"} still lurking today…`;
    $("board").innerHTML = "";
    for (const row of s.leaderboard || []) {
      const li = document.createElement("li");
      li.innerHTML = `<span></span><span class="pts"></span>`;
      li.children[0].textContent = row.name;
      li.children[1].textContent = `${row.points} pts`;
      $("board").appendChild(li);
    }
    $("owed").textContent = s.chores_owed
      ? `🧹 Family chores owed: ${s.chores_owed}` : "";
  }

  function renderChallenge(s) {
    $("name").textContent = s.member;
    $("task").textContent = s.challenge;
    const active = s.phase === "active";
    $("banner").textContent = active ? `${s.points} point${s.points === 1 ? "" : "s"} up for grabs` : "⚡ CHALLENGE TIME ⚡";
    $("hint").textContent = active ? "Done it? SMASH THE BUZZER!" : "Get ready…";
    $("screenBuzzer").hidden = !(active && s.allow_screen_press);
  }

  function renderResult(s) {
    if (s.success) {
      $("resultTitle").textContent = `🎉 ${s.member} did it!`;
      $("resultDetail").textContent = `+${s.points} point${s.points === 1 ? "" : "s"} in ${s.reaction_seconds}s`;
      $("resultPunishment").textContent = "";
    } else {
      $("resultTitle").textContent = "⏰ Too slow!";
      $("resultDetail").textContent = `${s.member} didn't hit the buzzer. Everyone must:`;
      $("resultPunishment").textContent = s.punishment;
    }
  }

  function render(s) {
    document.body.className = `phase-${s.phase}`;
    $("paused").hidden = !s.paused;
    if (s.phase === "idle") renderIdle(s);
    else if (s.phase === "announce" || s.phase === "active") renderChallenge(s);
    else renderResult(s);

    if (s.phase !== lastPhase) {
      if (s.phase === "announce") play("announce");
      if (s.phase === "active") play("go");
      if (s.phase === "success") play("success");
      if (s.phase === "fail") play("fail");
      lastPhase = s.phase;
    }
  }

  // Smooth countdown between polls.
  function frame() {
    if (state.phase === "idle") renderClock();
    if (state.phase === "announce" || state.phase === "active") {
      const left = Math.max(0, (deadline - performance.now()) / 1000);
      const secs = Math.ceil(left);
      $("count").textContent = secs;
      if (state.phase === "active") {
        $("fill").style.width = `${(left / state.time_limit) * 100}%`;
        const hurry = left <= 10;
        document.body.classList.toggle("hurry", hurry);
        if (hurry && secs !== lastTick && secs > 0) { play("tick"); }
      }
      lastTick = secs;
    }
    requestAnimationFrame(frame);
  }

  async function poll() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      state = await res.json();
      if (state.seconds_left !== undefined) deadline = performance.now() + state.seconds_left * 1000;
      render(state);
      $("offline").hidden = true;
    } catch (e) {
      $("offline").hidden = false;
    }
    setTimeout(poll, POLL_MS);
  }

  async function screenPress() {
    await fetch("/api/press", { method: "POST" }).catch(() => {});
  }
  $("screenBuzzer").addEventListener("click", screenPress);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && state.allow_screen_press) screenPress();
  });

  renderClock();
  poll();
  requestAnimationFrame(frame);
})();

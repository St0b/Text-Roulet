export async function playStartupChime() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  let context;
  try {
    context = new Audio();
    await context.resume();
    const time = context.currentTime;
    for (const [offset,frequency] of [[0,392],[.095,493.88],[.19,587.33],[.33,783.99]]) {
      const note = context.createOscillator();
      const level = context.createGain();
      const start = time + offset;
      note.type = 'sine';
      note.frequency.value = frequency;
      level.gain.setValueAtTime(.0001,start);
      level.gain.exponentialRampToValueAtTime(.07,start + .06);
      level.gain.exponentialRampToValueAtTime(.0001,start + .5);
      note.connect(level).connect(context.destination);
      note.start(start);
      note.stop(start + .53);
    }
    setTimeout(() => context.close().catch(() => {}), 1050);
  } catch {
    if (context?.state !== 'closed') context?.close().catch(() => {});
  }
}

// Small, self-cleaning burst animations for pipeline moves.
// celebrate('done' | 'review' | 'archive', { x, y }) — x/y in viewport pixels (defaults to screen centre).

const PALETTES = {
  done: ['#1FA971', '#FFC21A', '#3D5AFE', '#8B5CF6', '#E5484D', '#0EA5B7'],
  review: ['#8B5CF6', '#B79CFF', '#3D5AFE', '#FFC21A'],
  archive: ['#8D94B3', '#5B6386', '#C9CEE0'],
};
const LABEL = { done: 'Completed', review: 'Sent for review', archive: 'Archived' };
const ICON = {
  done: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  review: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" fill="none" stroke="white" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="white"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5" fill="none" stroke="white" stroke-width="2.2"/><path d="M5 9v9.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V9M10 13h4" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
};
const BG = { done: '#1FA971', review: '#8B5CF6', archive: '#5B6386' };

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function celebrate(kind = 'done', at) {
  if (typeof document === 'undefined' || !LABEL[kind]) return;
  const x = at?.x ?? window.innerWidth / 2;
  const y = at?.y ?? window.innerHeight / 2;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(layer);
  const done = [];

  // Badge that pops at the drop point
  const badge = document.createElement('div');
  badge.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);display:flex;align-items:center;gap:8px;padding:8px 14px 8px 8px;border-radius:999px;background:${BG[kind]};color:#fff;font:600 13px Figtree Variable,system-ui,sans-serif;box-shadow:0 12px 30px -10px ${BG[kind]}aa;white-space:nowrap`;
  badge.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" style="background:rgba(255,255,255,.18);border-radius:999px;padding:3px">${ICON[kind]}</svg>${LABEL[kind]}`;
  layer.appendChild(badge);
  done.push(badge.animate([
    { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%,-60%) scale(1.08)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-65%) scale(1)', opacity: 1, offset: 0.75 },
    { transform: 'translate(-50%,-95%) scale(.96)', opacity: 0 },
  ], { duration: reduced() ? 900 : 1500, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished);

  if (!reduced()) {
    const colors = PALETTES[kind];
    if (kind === 'done') {
      // Confetti burst
      for (let i = 0; i < 46; i += 1) {
        const p = document.createElement('i');
        const w = 5 + Math.random() * 6; const h = Math.random() > 0.5 ? w : w * 0.45;
        p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${colors[i % colors.length]};border-radius:${Math.random() > 0.7 ? '999px' : '2px'}`;
        layer.appendChild(p);
        const a = (Math.PI * 2 * i) / 46 + Math.random() * 0.3;
        const v = 90 + Math.random() * 150;
        const dx = Math.cos(a) * v; const dy = Math.sin(a) * v - 80;
        done.push(p.animate([
          { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx * 1.15}px,${dy + 160}px) rotate(${Math.random() * 900}deg)`, opacity: 0 },
        ], { duration: 1200 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.3,1)' }).finished);
      }
    } else if (kind === 'review') {
      // Expanding rings + sparkles
      for (let r = 0; r < 3; r += 1) {
        const ring = document.createElement('i');
        ring.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:40px;height:40px;border-radius:999px;border:2px solid ${colors[r]};transform:translate(-50%,-50%)`;
        layer.appendChild(ring);
        done.push(ring.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0.9 }, { transform: 'translate(-50%,-50%) scale(5)', opacity: 0 }],
          { duration: 1100, delay: r * 160, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }).finished);
      }
      for (let i = 0; i < 14; i += 1) {
        const s = document.createElement('i');
        s.textContent = '✦';
        s.style.cssText = `position:absolute;left:${x}px;top:${y}px;color:${colors[i % colors.length]};font-size:${10 + Math.random() * 10}px;font-style:normal`;
        layer.appendChild(s);
        const a = Math.random() * Math.PI * 2; const v = 60 + Math.random() * 90;
        done.push(s.animate([{ transform: 'translate(-50%,-50%) scale(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v}px) scale(1)`, opacity: 1, offset: 0.6 }, { transform: `translate(${Math.cos(a) * v * 1.2}px,${Math.sin(a) * v * 1.2}px) scale(.2)`, opacity: 0 }],
          { duration: 1000 + Math.random() * 400, easing: 'ease-out' }).finished);
      }
    } else {
      // Archive: dust falls into the box
      for (let i = 0; i < 18; i += 1) {
        const d = document.createElement('i');
        const sz = 4 + Math.random() * 5;
        const sx = x + (Math.random() - 0.5) * 160; const sy = y - 80 - Math.random() * 60;
        d.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;width:${sz}px;height:${sz}px;border-radius:2px;background:${colors[i % colors.length]}`;
        layer.appendChild(d);
        done.push(d.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translate(${x - sx}px,${y - sy}px) rotate(${Math.random() * 360}deg) scale(.3)`, opacity: 0 }],
          { duration: 800 + Math.random() * 300, delay: Math.random() * 250, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'backwards' }).finished);
      }
    }
  }
  Promise.allSettled(done).then(() => layer.remove());
  setTimeout(() => layer.remove(), 3000);
}

/** Where to burst from: a mouse/drag event, an element, or nothing (centre). */
export function pointOf(src) {
  if (!src) return undefined;
  if (src.clientX != null && (src.clientX || src.clientY)) return { x: src.clientX, y: src.clientY };
  const el = src.currentTarget || src.target || src;
  const r = el?.getBoundingClientRect?.();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined;
}

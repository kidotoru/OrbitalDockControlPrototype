import './style.css';
import { createWorld } from './world';
import { Game } from './game';
import { UI } from './ui';

const world = createWorld(document.getElementById('app')!);
const game = new Game(world);
const ui = new UI(game);

// キャンバス上のタップ／クリックで機体・ポートを選択（ドラッグは視点操作）
const canvas = world.renderer.domElement;
let downX = 0, downY = 0, downAt = 0;
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX; downY = e.clientY; downAt = performance.now();
});
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || performance.now() - downAt > 500) return;
  const targets = [...game.ships.map((s) => s.hit), ...game.ports.map((p) => p.hit)];
  const hit = world.pick(e.clientX, e.clientY, targets);
  if (!hit) { game.select(null); return; }
  const { shipId, portId } = hit.object.userData as { shipId?: number; portId?: string };
  if (shipId != null) game.select(shipId);
  else if (portId) game.portClicked(portId);
});

// デバッグ用にコンソールから触れるように
(window as unknown as { game: Game }).game = game;

let last = performance.now();
function frame(now: number) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.update(realDt);
  ui.update();
  world.render(realDt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

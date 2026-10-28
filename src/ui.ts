import type { Game } from './game';
import { STATE_LABEL, type Ship } from './ship';

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const STATE_ORDER: Record<string, number> = { ready: 0, holding: 1, arriving: 2, approaching: 3, docked: 4, departing: 5, leaving: 6 };

export class UI {
  private game: Game;
  private el = {} as Record<'score' | 'clock' | 'done' | 'missed' | 'crash' | 'traffic' | 'detail' | 'ports' | 'log' | 'intro', HTMLElement>;
  private rows = new Map<number, HTMLElement>();
  private portRows = new Map<string, HTMLElement>();
  private detailSig = '';
  private shownLog = 0;

  constructor(game: Game) {
    this.game = game;
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <header class="topbar">
        <div class="brand">ORBITAL DOCK CONTROL</div>
        <div class="stats">
          <div class="stat"><span>スコア</span><b data-k="score">0</b></div>
          <div class="stat"><span>経過</span><b data-k="clock">00:00</b></div>
          <div class="stat"><span>出発</span><b data-k="done">0</b></div>
          <div class="stat"><span>離脱</span><b data-k="missed">0</b></div>
          <div class="stat"><span>衝突</span><b data-k="crash">0</b></div>
        </div>
      </header>
      <aside class="panel">
        <section class="detail" data-k="detail"></section>
        <section>
          <h3>交通</h3>
          <div class="traffic" data-k="traffic"></div>
        </section>
      </aside>
      <div class="left-col">
        <section class="ports-panel">
          <h3>ドッキングポート</h3>
          <div class="ports" data-k="ports"></div>
        </section>
        <div class="log" data-k="log"></div>
      </div>
      <div class="intro" data-k="intro">
        <div class="intro-card">
          <h1>ORBITAL DOCK CONTROL</h1>
          <p>軌道ステーションの管制官として、到着する宇宙機をドッキングポートへ誘導し、作業を終えた機体に出発許可を出してください。</p>
          <ul>
            <li><b>待機中</b>の機体を選び、<b>サイズが合う空きポート</b>（S &lt; M &lt; L、大きいポートは小型機も可）を指定します。</li>
            <li>作業が終わると<b>出発待ち</b>になります。早めに出発許可を出すほど高得点です。</li>
            <li>待たせすぎると機体は離脱します。経路が交差すると<b>接近警報</b>、ぶつかると衝突事故です。</li>
            <li>ドラッグで視点回転、ホイール／ピンチでズーム。ラベルやポートはタップで選択できます。</li>
          </ul>
          <button class="primary" data-start>管制開始</button>
        </div>
      </div>`;
    document.body.appendChild(hud);
    hud.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => {
      (this.el as Record<string, HTMLElement>)[e.dataset.k!] = e;
    });

    hud.querySelector('[data-start]')!.addEventListener('click', () => {
      this.el.intro.remove();
      game.paused = false;
    });


    // 詳細パネルのボタン
    this.el.detail.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      const sel = game.selected;
      if (!sel) return;
      if (t.dataset.assign) game.assign(sel.id, t.dataset.assign);
      if (t.dataset.depart != null) game.clearDeparture(sel.id);
      if (t.dataset.deselect != null) game.select(null);
    });

    // 3Dラベルのクリック
    document.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sl = t.closest<HTMLElement>('.ship-label');
      if (sl?.dataset.shipId) { game.select(Number(sl.dataset.shipId)); return; }
      const pl = t.closest<HTMLElement>('.port-label');
      if (pl?.dataset.portId) game.portClicked(pl.dataset.portId);
    });

    for (const p of game.ports) {
      const row = document.createElement('button');
      row.className = 'port-row';
      row.addEventListener('click', () => game.portClicked(p.id));
      this.el.ports.appendChild(row);
      this.portRows.set(p.id, row);
    }

  }

  update() {
    const g = this.game;
    this.el.score.textContent = String(g.score);
    this.el.score.classList.toggle('neg', g.score < 0);
    this.el.clock.textContent = fmtTime(g.time);
    this.el.done.textContent = String(g.completed);
    this.el.missed.textContent = String(g.missed);
    this.el.crash.textContent = String(g.collisions);

    this.updateTraffic();
    this.updatePorts();
    this.updateDetail();
    this.updateLog();
  }

  private barFor(s: Ship): { pct: number; tone: string } | null {
    if (s.state === 'holding') {
      const pct = s.patience / s.patienceMax;
      return { pct, tone: pct < 0.25 ? 'bad' : pct < 0.5 ? 'warn' : 'ok' };
    }
    if (s.state === 'docked') return { pct: 1 - s.service / s.serviceMax, tone: 'info' };
    if (s.state === 'ready') {
      const pct = Math.max(0, 1 - s.readyWait / 40);
      return { pct, tone: s.readyWait > 20 ? 'bad' : s.readyWait > 12 ? 'warn' : 'ok' };
    }
    return null;
  }

  private updateTraffic() {
    const g = this.game;
    const live = new Set(g.ships.map((s) => s.id));
    for (const [id, row] of this.rows) {
      if (!live.has(id)) { row.remove(); this.rows.delete(id); }
    }
    const sorted = [...g.ships].sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || a.id - b.id);
    sorted.forEach((s, i) => {
      let row = this.rows.get(s.id);
      if (!row) {
        row = document.createElement('button');
        row.className = 'ship-row';
        row.innerHTML = `<span class="cs"></span><span class="sz"></span><span class="st"></span><span class="bar"><i></i></span>`;
        row.addEventListener('click', () => g.select(s.id));
        this.rows.set(s.id, row);
      }
      if (this.el.traffic.children[i] !== row) this.el.traffic.insertBefore(row, this.el.traffic.children[i] ?? null);
      const warn = g.warnings.has(s.id);
      row.className = `ship-row s-${s.state}${s.id === g.selectedId ? ' selected' : ''}${warn ? ' warn' : ''}`;
      (row.children[0] as HTMLElement).textContent = s.callsign;
      (row.children[1] as HTMLElement).textContent = s.type.size;
      let st = STATE_LABEL[s.state];
      if (s.portId && (s.state === 'approaching' || s.state === 'docked' || s.state === 'ready' || s.state === 'departing')) st += ` ${s.portId}`;
      if (warn) st = '⚠ ' + st;
      (row.children[2] as HTMLElement).textContent = st;
      const bar = this.barFor(s);
      const barEl = row.children[3] as HTMLElement;
      barEl.style.visibility = bar ? 'visible' : 'hidden';
      if (bar) {
        const i2 = barEl.firstElementChild as HTMLElement;
        i2.style.width = `${Math.round(bar.pct * 100)}%`;
        i2.className = bar.tone;
      }
    });
    if (!g.ships.length && !this.el.traffic.querySelector('.empty')) {
      this.el.traffic.innerHTML = '<div class="empty">交通なし</div>';
    } else if (g.ships.length) {
      this.el.traffic.querySelector('.empty')?.remove();
    }
  }

  private updatePorts() {
    const g = this.game;
    const sel = g.selected;
    const assigning = sel && (sel.state === 'holding' || sel.state === 'arriving');
    for (const p of g.ports) {
      const row = this.portRows.get(p.id)!;
      const occ = g.shipById(p.shipId);
      const status = p.state === 'free' ? '空き' : p.state === 'reserved' ? `予約 ${occ?.callsign ?? ''}` : `${occ?.callsign ?? ''}`;
      const html = `<b>${p.id}</b><span class="sz">${p.size}</span><span class="ps">${status}</span>`;
      if (row.dataset.html !== html) { row.dataset.html = html; row.innerHTML = html; }
      let cls = `port-row ${p.state}`;
      if (assigning) cls += g.canAssign(sel, p) ? ' target' : ' dim';
      if (row.className !== cls) row.className = cls;
    }
  }

  private updateDetail() {
    const g = this.game;
    const s = g.selected;
    const portsSig = g.ports.map((p) => p.state[0]).join('');
    const sig = s ? `${s.id}|${s.state}|${s.state === 'holding' || s.state === 'arriving' ? portsSig : ''}` : 'none';
    if (sig !== this.detailSig) {
      this.detailSig = sig;
      if (!s) {
        this.el.detail.innerHTML = `<div class="hint">宇宙機を選択してください<small>リストの行、または3D上のラベルをタップ</small></div>`;
      } else {
        let body = '';
        if (s.state === 'holding' || s.state === 'arriving') {
          body = `<p class="prompt">ドッキングポートを指定</p><div class="assign">${g.ports.map((p) => {
            const ok = g.canAssign(s, p);
            const why = p.state !== 'free' ? '使用中' : !ok ? 'サイズ不可' : '空き';
            return `<button data-assign="${p.id}" ${ok ? '' : 'disabled'}><b>${p.id}</b><span>${p.size}</span><small>${why}</small></button>`;
          }).join('')}</div>`;
        } else if (s.state === 'approaching') {
          body = `<p class="prompt">${s.portId} へ進入中</p>`;
        } else if (s.state === 'docked') {
          body = `<p class="prompt">${s.portId} で作業中 <b data-live="service"></b></p>`;
        } else if (s.state === 'ready') {
          body = `<p class="prompt">${s.portId} で出発許可待ち <b data-live="wait"></b></p><button class="primary depart" data-depart>出発許可</button>`;
        } else if (s.state === 'departing') {
          body = `<p class="prompt">出発中</p>`;
        } else if (s.state === 'leaving') {
          body = `<p class="prompt">離脱中</p>`;
        }
        this.el.detail.innerHTML = `
          <div class="dhead">
            <div><b class="cs">${s.callsign}</b><span class="tag">${s.type.label}</span><span class="tag sz">${s.type.size}</span></div>
            <button class="x" data-deselect aria-label="選択解除">×</button>
          </div>
          ${body}`;
      }
    }
    if (s) {
      const sv = this.el.detail.querySelector('[data-live="service"]');
      if (sv) sv.textContent = `残り ${Math.ceil(s.service)}s`;
      const wv = this.el.detail.querySelector('[data-live="wait"]');
      if (wv) wv.textContent = `待機 ${Math.floor(s.readyWait)}s`;
    }
  }

  private updateLog() {
    const g = this.game;
    const fresh = g.log.filter((l) => l.id > this.shownLog);
    for (const l of fresh) {
      this.shownLog = l.id;
      const d = document.createElement('div');
      d.className = `toast ${l.kind}`;
      d.textContent = l.text;
      this.el.log.prepend(d);
      setTimeout(() => d.classList.add('fade'), 4500);
      setTimeout(() => d.remove(), 5200);
    }
    while (this.el.log.children.length > 5) this.el.log.lastElementChild!.remove();
  }
}

import { fmtMoney, type Game } from './game';
import { ECONOMY } from './config';
import { ROLE_INFO, STATE_LABEL, type Ship } from './ship';

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const fmtPrice = (v: number) => `$${v.toFixed(2)}`;

const STATE_ORDER: Record<string, number> = { ready: 0, holding: 1, arriving: 2, approaching: 3, docked: 4, departing: 5, leaving: 6 };

type ElKey = 'credit' | 'stock' | 'stockBar' | 'rep' | 'clock' | 'done' | 'missed' | 'crash'
  | 'traffic' | 'detail' | 'ports' | 'log' | 'intro' | 'over';

export class UI {
  private game: Game;
  private el = {} as Record<ElKey, HTMLElement>;
  private rows = new Map<number, HTMLElement>();
  private portRows = new Map<string, HTMLElement>();
  private detailSig = '';
  private shownLog = 0;
  private overShown = false;

  constructor(game: Game) {
    this.game = game;
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <header class="topbar">
        <div class="brand">ORBITAL DOCK CONTROL</div>
        <div class="stats">
          <div class="stat money"><span>クレジット</span><b data-k="credit">$0</b></div>
          <div class="stat stock"><span>リソース在庫</span><b data-k="stock">0</b><i class="meter"><i data-k="stockBar"></i></i></div>
          <div class="stat"><span>評判</span><b data-k="rep">0</b></div>
          <div class="stat"><span>経過</span><b data-k="clock">00:00</b></div>
          <div class="stat minor"><span>出発</span><b data-k="done">0</b></div>
          <div class="stat minor"><span>離脱</span><b data-k="missed">0</b></div>
          <div class="stat minor"><span>衝突</span><b data-k="crash">0</b></div>
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
      </div>
      <div class="log" data-k="log"></div>
      <div class="intro" data-k="intro">
        <div class="intro-card">
          <h1>ORBITAL DOCK CONTROL</h1>
          <p>軌道ステーションの管制官として、リソースを仕入れて売り、ステーションのクレジットを増やしてください。</p>
          <ul>
            <li><b class="c-supplier">サプライヤー</b>はリソースを運んでくる船です。1u あたり ${fmtPrice(ECONOMY.buyPrice[0])}〜${fmtPrice(ECONOMY.buyPrice[1])} で買い取ります。</li>
            <li><b class="c-consumer">コンシューマー</b>はリソースを補給しに来る船です。1u あたり ${fmtPrice(ECONOMY.sellPrice)} で売ります。</li>
            <li>待機中の船を選び、サイズが合う空きポートを指定します（S &lt; M &lt; L。大きいポートには小型の船も入れます）。取引はドッキング中に少しずつ進み、終わったら出発許可を出します。</li>
            <li>在庫・クレジット・貯蔵庫の空きが尽きると、取引はその時点で打ち切られ、評判が下がります。待たせすぎた船は離脱します。衝突すると修理費がかかります。</li>
            <li>ステーション自身も毎秒 ${ECONOMY.consumptionPerSec}u のリソースを消費します。<b>在庫が 0 になるとゲームオーバー</b>です。売りすぎにも注意してください。</li>
            <li>評判が高いほど船がたくさん来ます。</li>
          </ul>
          <button class="primary" data-start>管制開始</button>
        </div>
      </div>
      <div class="intro over" data-k="over" hidden></div>`;
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
    this.el.credit.textContent = fmtMoney(g.credit);
    this.el.credit.classList.toggle('neg', g.credit < 0);
    this.el.stock.textContent = `${Math.floor(g.stock)} / ${g.capacity}u`;
    const fill = g.stock / g.capacity;
    this.el.stockBar.style.width = `${(fill * 100).toFixed(1)}%`;
    const low = g.stock < ECONOMY.lowStockBad ? 'bad' : g.stock < ECONOMY.lowStockWarn ? 'warn' : '';
    this.el.stockBar.className = low || (fill > 0.9 ? 'warn' : 'ok');
    this.el.stock.classList.toggle('neg', low === 'bad');
    this.el.stock.classList.toggle('warn', low === 'warn');
    this.el.rep.textContent = `${Math.round(g.reputation)}`;
    this.el.rep.className = g.reputation < 30 ? 'neg' : g.reputation < 50 ? 'warn' : '';
    this.el.clock.textContent = fmtTime(g.time);
    this.el.done.textContent = String(g.completed);
    this.el.missed.textContent = String(g.missed);
    this.el.crash.textContent = String(g.collisions);

    this.updateTraffic();
    this.updatePorts();
    this.updateDetail();
    this.updateLog();
    if (g.gameOver && !this.overShown) this.showGameOver();
  }

  private barFor(s: Ship): { pct: number; tone: string } | null {
    if (s.state === 'holding') {
      const pct = s.patience / s.patienceMax;
      return { pct, tone: pct < 0.25 ? 'bad' : pct < 0.5 ? 'warn' : 'ok' };
    }
    if (s.state === 'docked') return { pct: s.progress, tone: s.stalled > 0 ? 'bad' : 'info' };
    if (s.state === 'ready') return { pct: s.progress, tone: s.progress < 0.999 ? 'warn' : 'ok' };
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
        row.innerHTML = `<em class="role ${s.role}">${ROLE_INFO[s.role].short}</em><span class="cs"></span><span class="sz"></span><span class="st"></span><span class="bar"><i></i></span>`;
        row.addEventListener('click', () => g.select(s.id));
        this.rows.set(s.id, row);
      }
      if (this.el.traffic.children[i] !== row) this.el.traffic.insertBefore(row, this.el.traffic.children[i] ?? null);
      const warn = g.warnings.has(s.id);
      row.className = `ship-row s-${s.state}${s.id === g.selectedId ? ' selected' : ''}${warn ? ' warn' : ''}`;
      (row.children[1] as HTMLElement).textContent = s.callsign;
      (row.children[2] as HTMLElement).textContent = s.size;
      let st = STATE_LABEL[s.state];
      if (s.portId && (s.state === 'approaching' || s.state === 'docked' || s.state === 'ready' || s.state === 'departing')) st += ` ${s.portId}`;
      if (s.state === 'docked' && s.stalled > 0) st += ' 停止';
      if (warn) st = '⚠ ' + st;
      (row.children[3] as HTMLElement).textContent = st;
      const bar = this.barFor(s);
      const barEl = row.children[4] as HTMLElement;
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

  /** 取引の見込み・進み具合 */
  private tradeBlock(s: Ship): string {
    const verb = s.role === 'supplier' ? '買い取り' : '販売';
    const sign = s.role === 'supplier' ? '−' : '+';
    if (s.state === 'holding' || s.state === 'arriving' || s.state === 'approaching') {
      return `<dl class="trade">
        <div><dt>${verb}予定</dt><dd>${s.cargo}u</dd></div>
        <div><dt>単価</dt><dd>${fmtPrice(s.price)}</dd></div>
        <div><dt>金額</dt><dd class="${s.role}">${sign}${fmtMoney(s.plannedValue)}</dd></div>
      </dl>`;
    }
    return `<dl class="trade">
      <div><dt>${verb}</dt><dd data-live="units"></dd></div>
      <div><dt>単価</dt><dd>${fmtPrice(s.price)}</dd></div>
      <div><dt>金額</dt><dd class="${s.role}" data-live="value"></dd></div>
    </dl>
    <div class="progress"><i data-live="bar"></i></div>`;
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
          body = `<p class="prompt">${s.portId} で取引中 <b data-live="status"></b></p>`;
        } else if (s.state === 'ready') {
          const partial = s.progress < 0.999;
          body = `<p class="prompt">${s.portId} で出発許可待ち${partial ? ' <b class="warn">部分取引</b>' : ''}</p><button class="primary depart" data-depart>出発許可</button>`;
        } else if (s.state === 'departing') {
          body = `<p class="prompt">出発中</p>`;
        } else if (s.state === 'leaving') {
          body = `<p class="prompt">離脱中</p>`;
        }
        this.el.detail.innerHTML = `
          <div class="dhead">
            <div><b class="cs">${s.callsign}</b><span class="tag ${s.role}">${ROLE_INFO[s.role].label}</span><span class="tag sz">${s.size}</span></div>
            <button class="x" data-deselect aria-label="選択解除">×</button>
          </div>
          ${s.state === 'leaving' ? '' : this.tradeBlock(s)}
          ${body}`;
      }
    }
    if (s) {
      const q = (k: string) => this.el.detail.querySelector<HTMLElement>(`[data-live="${k}"]`);
      const sign = s.role === 'supplier' ? '−' : '+';
      const units = q('units');
      if (units) units.textContent = `${Math.floor(s.transferred)} / ${s.cargo}u`;
      const value = q('value');
      if (value) value.textContent = `${sign}${fmtMoney(s.value)}`;
      const bar = q('bar');
      if (bar) {
        bar.style.width = `${(s.progress * 100).toFixed(1)}%`;
        bar.className = s.stalled > 0 ? 'bad' : s.state === 'ready' && s.progress < 0.999 ? 'warn' : '';
      }
      const status = q('status');
      if (status) {
        status.textContent = s.stalled > 0 ? `停止：${s.stallReason}` : `${Math.round(s.progress * 100)}%`;
        status.classList.toggle('bad', s.stalled > 0);
      }
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

  private showGameOver() {
    this.overShown = true;
    const g = this.game;
    const t = g.totals;
    const margin = t.soldValue - t.boughtCost;
    this.el.over.innerHTML = `
      <div class="intro-card">
        <h1>RESOURCE DEPLETED</h1>
        <p>リソースが尽き、ステーションは運用停止になりました。運営期間 ${fmtTime(g.time)}、最終クレジット ${fmtMoney(g.credit)}。</p>
        <dl class="trade summary">
          <div><dt>買い取り</dt><dd>${Math.round(t.bought)}u / −${fmtMoney(t.boughtCost)}</dd></div>
          <div><dt>販売</dt><dd>${Math.round(t.sold)}u / +${fmtMoney(t.soldValue)}</dd></div>
          <div><dt>売買差益</dt><dd>${fmtMoney(margin)}</dd></div>
          <div><dt>ステーション消費</dt><dd>${Math.round(t.consumed)}u</dd></div>
          <div><dt>修理費</dt><dd>−${fmtMoney(t.fines)}</dd></div>
          <div><dt>出発 / 離脱 / 衝突</dt><dd>${g.completed} / ${g.missed} / ${g.collisions}</dd></div>
        </dl>
        <button class="primary" data-restart>もう一度</button>
      </div>`;
    this.el.over.hidden = false;
    this.el.over.querySelector('[data-restart]')!.addEventListener('click', () => location.reload());
  }
}

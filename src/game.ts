import * as THREE from 'three';
import type { World } from './world';
import { buildStation, SIZE_RANK, type Port } from './station';
import { Ship, SHIP_TYPES, type ShipType, type Waypoint } from './ship';

export type LogKind = 'info' | 'good' | 'warn' | 'bad';
export interface LogEntry { id: number; time: number; text: string; kind: LogKind }

const SPAWN_R = 230;
const HOLD_R = 66;
const GATE_DIST = 36;     // ポート法線方向のゲート（最終進入コリドー入口）
const APPROACH_DIST = 12; // 最終進入開始点
const CRUISE = 11;
const MAX_WAITING = 6;

const AXES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const PREFIXES = ['KPL', 'ARX', 'NOV', 'VEG', 'LYR', 'ORN', 'HLX', 'TAU', 'CYG', 'DRA'];
const DEG = Math.PI / 180;

/** 方向を球殻上で補間しながら from→to の経由点を作る（ステーションを避けて回り込む） */
function arcPoints(from: THREE.Vector3, to: THREE.Vector3, speed: number): Waypoint[] {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  const angle = a.angleTo(b);
  const n = Math.max(1, Math.ceil(angle / (8 * DEG)));
  const q = new THREE.Quaternion().setFromUnitVectors(a, b);
  const id = new THREE.Quaternion();
  const ra = from.length(), rb = to.length();
  const out: Waypoint[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const qt = id.clone().slerp(q, t);
    const r = ra + (rb - ra) * t;
    out.push({ p: a.clone().applyQuaternion(qt).multiplyScalar(r), speed });
  }
  out[out.length - 1].p.copy(to);
  return out;
}

export class Game {
  readonly world: World;
  readonly ports: Port[];
  ships: Ship[] = [];
  time = 0;
  score = 0;
  completed = 0;
  missed = 0;
  collisions = 0;
  /** イントロ画面を閉じるまで止めておく */
  paused = true;
  selectedId: number | null = null;
  log: LogEntry[] = [];
  warnings = new Set<number>();

  private logSeq = 0;
  private nextId = 1;
  private spawnTimer = 1.5;
  private usedCallsigns = new Set<string>();
  private selRing: THREE.Mesh;
  private warnLines: THREE.LineSegments;
  private effects: { mesh: THREE.Mesh; t: number }[] = [];
  private pulse = 0;

  constructor(world: World) {
    this.world = world;
    const st = buildStation();
    world.scene.add(st.group);
    this.ports = st.ports;

    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.12, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
    this.selRing.renderOrder = 10;
    this.selRing.visible = false;
    world.scene.add(this.selRing);

    this.warnLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 6), 3)),
      new THREE.LineBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.warnLines.frustumCulled = false;
    this.warnLines.renderOrder = 9;
    world.scene.add(this.warnLines);
  }

  // ---------- 参照 ----------

  get selected(): Ship | null {
    return this.ships.find((s) => s.id === this.selectedId) ?? null;
  }

  port(id: string): Port {
    return this.ports.find((p) => p.id === id)!;
  }

  shipById(id: number | null): Ship | null {
    return id == null ? null : this.ships.find((s) => s.id === id) ?? null;
  }

  canAssign(ship: Ship, port: Port): boolean {
    return (ship.state === 'holding' || ship.state === 'arriving')
      && port.state === 'free'
      && SIZE_RANK[ship.type.size] <= SIZE_RANK[port.size];
  }

  // ---------- プレイヤー操作 ----------

  select(id: number | null) {
    this.selectedId = id;
  }

  assign(shipId: number, portId: string): boolean {
    const ship = this.shipById(shipId);
    const port = this.port(portId);
    if (!ship || !this.canAssign(ship, port)) return false;

    port.state = 'reserved';
    port.shipId = ship.id;
    ship.portId = port.id;
    ship.state = 'approaching';

    const n = port.normal;
    const L = ship.type.length;
    const gate = port.position.clone().addScaledVector(n, GATE_DIST);
    const app = port.position.clone().addScaledVector(n, APPROACH_DIST);
    const dock = port.position.clone().addScaledVector(n, L / 2);
    const inward = n.clone().negate();

    // 現在地が遠い（到着中）なら、まず待機殻まで降りてから回り込む
    const start = ship.position.clone();
    const wps: Waypoint[] = [];
    if (start.length() > HOLD_R + 5) {
      const mid = start.clone().setLength(HOLD_R);
      wps.push({ p: mid, speed: CRUISE });
      wps.push(...arcPoints(mid, gate, CRUISE));
    } else {
      wps.push(...arcPoints(start, gate, CRUISE));
    }
    wps.push({ p: app, speed: 3.5, face: inward });
    wps.push({ p: dock, speed: 1.2, face: inward });

    ship.setPath(wps, () => {
      ship.state = 'docked';
      ship.speed = 0;
      port.state = 'occupied';
      const [a, b] = ship.type.service;
      ship.serviceMax = a + Math.random() * (b - a);
      ship.service = ship.serviceMax;
      this.addLog(`${ship.callsign} が ${port.id} にドッキング`, 'info');
    });
    this.addLog(`${ship.callsign} に ${port.id} への進入を許可`, 'info');
    return true;
  }

  clearDeparture(shipId: number): boolean {
    const ship = this.shipById(shipId);
    if (!ship || ship.state !== 'ready' || !ship.portId) return false;
    const port = this.port(ship.portId);
    const n = port.normal;
    const app = port.position.clone().addScaledVector(n, APPROACH_DIST);
    const gate = port.position.clone().addScaledVector(n, GATE_DIST);
    const exit = gate.clone().setLength(SPAWN_R + 20);
    const facePort = n.clone().negate();
    const wait = ship.readyWait;

    ship.state = 'departing';
    ship.speed = 0;
    ship.setPath(
      [
        {
          p: app, speed: 2.2, face: facePort,
          onReach: () => {
            // 最終進入コリドーを抜けたらポート開放
            if (port.shipId === ship.id) { port.state = 'free'; port.shipId = null; }
          },
        },
        { p: gate, speed: 7 },
        { p: exit, speed: 14 },
      ],
      () => { ship.state = 'gone'; },
    );

    const delay = Math.max(0, wait - 15);
    const pts = Math.max(20, Math.round(100 - delay * 3));
    this.score += pts;
    this.completed++;
    this.addLog(`${ship.callsign} 出発許可 +${pts}${delay > 0 ? `（遅延 ${Math.round(delay)}s）` : ''}`, 'good');
    return true;
  }

  /** 3D/リストでポートを押したとき */
  portClicked(portId: string) {
    const port = this.port(portId);
    const sel = this.selected;
    if (sel && this.canAssign(sel, port)) {
      this.assign(sel.id, port.id);
      return;
    }
    if (sel && (sel.state === 'holding' || sel.state === 'arriving')) {
      if (port.state !== 'free') this.addLog(`${port.id} は使用中です`, 'warn');
      else this.addLog(`${sel.callsign}（${sel.type.size}）は ${port.id}（${port.size}）に入りません`, 'warn');
      return;
    }
    if (port.shipId != null) this.select(port.shipId);
  }

  // ---------- 進行 ----------

  update(realDt: number) {
    const dt = this.paused ? 0 : realDt;
    if (dt > 0) {
      const n = Math.ceil(dt / 0.04);
      for (let i = 0; i < n; i++) this.step(dt / n);
    }
    this.updateVisuals(realDt);
  }

  private step(dt: number) {
    this.time += dt;

    // 出現
    this.spawnTimer -= dt;
    const waiting = this.ships.filter((s) => s.state === 'arriving' || s.state === 'holding').length;
    if (this.spawnTimer <= 0) {
      if (waiting < MAX_WAITING) this.spawn();
      const interval = Math.max(8, 20 - this.time / 30);
      this.spawnTimer = interval * (0.7 + Math.random() * 0.6);
    }

    for (const s of this.ships) {
      s.update(dt);
      if (s.state === 'holding') {
        s.patience -= dt;
        if (s.patience <= 0) this.shipGivesUp(s);
      } else if (s.state === 'docked') {
        s.service -= dt;
        if (s.service <= 0) {
          s.service = 0;
          s.state = 'ready';
          s.readyWait = 0;
          this.addLog(`${s.callsign} 出発準備完了（${s.portId}）`, 'info');
        }
      } else if (s.state === 'ready') {
        s.readyWait += dt;
      }
    }

    this.checkProximity();

    // 退場した機体を片付け
    for (const s of this.ships.filter((x) => x.state === 'gone')) this.removeShip(s);
  }

  private spawn() {
    const r = Math.random();
    const type: ShipType = r < 0.4 ? SHIP_TYPES[0] : r < 0.75 ? SHIP_TYPES[1] : SHIP_TYPES[2];
    const dir = this.pickHoldDir();
    const ship = new Ship(this.nextId++, this.makeCallsign(), type, dir);
    ship.position.copy(dir).multiplyScalar(SPAWN_R);
    ship.body.lookAt(ship.position.clone().negate());
    const hold = dir.clone().multiplyScalar(HOLD_R);
    ship.setPath(
      [
        { p: dir.clone().multiplyScalar(HOLD_R + 25), speed: 14 },
        { p: hold, speed: 3 },
      ],
      () => {
        if (ship.state === 'arriving') {
          ship.state = 'holding';
          ship.speed = 0;
        }
      },
    );
    this.ships.push(ship);
    this.world.scene.add(ship.root);
    this.world.scene.add(ship.pathLine);
    this.addLog(`${ship.callsign}（${type.label}・${type.size}）接近中`, 'info');
  }

  private pickHoldDir(): THREE.Vector3 {
    const others = this.ships.filter((s) => s.state === 'arriving' || s.state === 'holding').map((s) => s.holdDir);
    let best = new THREE.Vector3().randomDirection();
    let bestScore = -Infinity;
    for (let i = 0; i < 60; i++) {
      const d = new THREE.Vector3().randomDirection();
      d.y *= 0.6; // 上下に偏りすぎないように
      d.normalize();
      const axisMin = Math.min(...AXES.map((a) => a.angleTo(d)));
      const otherMin = others.length ? Math.min(...others.map((o) => o.angleTo(d))) : Math.PI;
      if (axisMin > 22 * DEG && otherMin > 18 * DEG) return d;
      const score = Math.min(axisMin / (22 * DEG), otherMin / (18 * DEG));
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  private makeCallsign(): string {
    for (;;) {
      const cs = `${PREFIXES[Math.floor(Math.random() * PREFIXES.length)]}-${10 + Math.floor(Math.random() * 890)}`;
      if (!this.usedCallsigns.has(cs)) {
        this.usedCallsigns.add(cs);
        return cs;
      }
    }
  }

  private shipGivesUp(s: Ship) {
    s.state = 'leaving';
    s.patience = 0;
    s.setPath([{ p: s.position.clone().setLength(SPAWN_R + 20), speed: 12 }], () => { s.state = 'gone'; });
    this.score -= 80;
    this.missed++;
    this.addLog(`${s.callsign} が待ちきれず離脱 −80`, 'bad');
  }

  private checkProximity() {
    this.warnings.clear();
    const active = this.ships.filter((s) => s.state !== 'docked' && s.state !== 'ready' && s.state !== 'gone');
    const pairs: [Ship, Ship][] = [];
    const crashed = new Set<Ship>();
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (!a.isMoving && !b.isMoving) continue;
        const d = a.position.distanceTo(b.position);
        const rr = a.radius + b.radius;
        if (d < rr) {
          crashed.add(a); crashed.add(b);
        } else if (d < rr + 6) {
          this.warnings.add(a.id); this.warnings.add(b.id);
          pairs.push([a, b]);
        }
      }
    }
    if (crashed.size) {
      const list = [...crashed];
      const mid = new THREE.Vector3();
      list.forEach((s) => mid.add(s.position));
      mid.divideScalar(list.length);
      this.explode(mid);
      this.score -= 250;
      this.collisions++;
      this.addLog(`衝突事故！ ${list.map((s) => s.callsign).join(' / ')} −250`, 'bad');
      for (const s of list) this.removeShip(s);
    }

    const attr = this.warnLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(pairs.length, 40);
    for (let k = 0; k < n; k++) {
      const [a, b] = pairs[k];
      attr.setXYZ(k * 2, a.position.x, a.position.y, a.position.z);
      attr.setXYZ(k * 2 + 1, b.position.x, b.position.y, b.position.z);
    }
    attr.needsUpdate = true;
    this.warnLines.geometry.setDrawRange(0, n * 2);
  }

  private removeShip(s: Ship) {
    if (s.portId) {
      const p = this.port(s.portId);
      if (p.shipId === s.id) { p.state = 'free'; p.shipId = null; }
    }
    s.dispose();
    this.ships = this.ships.filter((x) => x !== s);
    if (this.selectedId === s.id) this.selectedId = null;
  }

  private explode(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.position.copy(at);
    this.world.scene.add(mesh);
    this.effects.push({ mesh, t: 0 });
  }

  addLog(text: string, kind: LogKind) {
    this.log.push({ id: ++this.logSeq, time: this.time, text, kind });
    if (this.log.length > 30) this.log.shift();
  }

  // ---------- 表示 ----------

  private updateVisuals(realDt: number) {
    this.pulse += realDt;
    const sel = this.selected;
    const assigning = sel && (sel.state === 'holding' || sel.state === 'arriving');

    for (const s of this.ships) s.updateVisuals(s.id === this.selectedId, this.warnings.has(s.id));

    // 選択リング
    if (sel) {
      this.selRing.visible = true;
      this.selRing.position.copy(sel.position);
      this.selRing.quaternion.copy(this.world.camera.quaternion);
      const sc = Math.max(2.4, sel.type.length * 0.85) * (1 + 0.06 * Math.sin(this.pulse * 5));
      this.selRing.scale.setScalar(sc);
    } else {
      this.selRing.visible = false;
    }

    // ポート表示
    const colors = { free: 0x4ade80, reserved: 0xfacc15, occupied: 0xf87171 };
    for (const p of this.ports) {
      p.ringMat.color.setHex(colors[p.state]);
      let opacity = 0.85, scale = 1;
      let cls = `port-label ${p.state}`;
      if (assigning) {
        if (this.canAssign(sel, p)) {
          opacity = 0.75 + 0.25 * Math.sin(this.pulse * 6);
          scale = 1.12 + 0.06 * Math.sin(this.pulse * 6);
          cls += ' target';
        } else {
          opacity = 0.2;
          cls += ' dim';
        }
      }
      p.ringMat.opacity = opacity;
      p.ring.scale.setScalar(scale);
      if (p.labelEl.className !== cls) p.labelEl.className = cls;
    }

    // 爆発エフェクト
    for (const e of this.effects) {
      e.t += realDt;
      e.mesh.scale.setScalar(1 + e.t * 14);
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - e.t / 1.2);
    }
    for (const e of this.effects.filter((x) => x.t > 1.2)) {
      e.mesh.removeFromParent();
      e.mesh.geometry.dispose();
      (e.mesh.material as THREE.Material).dispose();
    }
    this.effects = this.effects.filter((x) => x.t <= 1.2);
  }
}

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Size } from './station';
import { SHIP_SIZE, CARGO_JITTER, ECONOMY } from './config';

export type ShipState =
  | 'arriving'    // 到着中（待機ポイントへ移動）
  | 'holding'     // 待機中（ポート割り当て待ち）
  | 'approaching' // 進入中
  | 'docked'      // ドッキング中（作業中）
  | 'ready'       // 出発準備完了（出発許可待ち）
  | 'departing'   // 出発中
  | 'leaving'     // 待ちきれず離脱
  | 'gone';

export const STATE_LABEL: Record<ShipState, string> = {
  arriving: '到着中',
  holding: '待機中',
  approaching: '進入中',
  docked: '取引中',
  ready: '出発待ち',
  departing: '出発中',
  leaving: '離脱',
  gone: '—',
};

/** supplier: ステーションにリソースを売りに来る / consumer: ステーションからリソースを買いに来る */
export type Role = 'supplier' | 'consumer';

export const ROLE_INFO: Record<Role, { label: string; short: string; color: number }> = {
  supplier: { label: 'サプライヤー', short: '供給', color: 0xffb35c },
  consumer: { label: 'コンシューマー', short: '補給', color: 0x5fd4ff },
};

export interface Waypoint {
  p: THREE.Vector3;
  speed: number;
  /** 機首を向けたい方向（省略時は進行方向） */
  face?: THREE.Vector3;
  onReach?: () => void;
}

const ACCEL = 5;
const TURN_RATE = 1.6;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _to = new THREE.Vector3();
const _zero = new THREE.Vector3();
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_X = new THREE.Vector3(1, 0, 0);

export class Ship {
  readonly id: number;
  readonly callsign: string;
  readonly role: Role;
  readonly size: Size;
  readonly length: number;
  state: ShipState = 'arriving';

  /** 位置のみ（ラベルはここにぶら下げて回転させない） */
  readonly root = new THREE.Group();
  /** 機体（回転する） */
  readonly body = new THREE.Group();
  readonly hit: THREE.Mesh;
  readonly labelEl: HTMLDivElement;
  readonly pathLine: THREE.Line;
  private readonly engineMat: THREE.MeshBasicMaterial;
  private lastLabel = '';

  waypoints: Waypoint[] = [];
  onPathEnd?: () => void;
  speed = 12;

  patience: number;
  readonly patienceMax: number;
  /** 予定取引量（u） */
  readonly cargo: number;
  /** 取引単価（$/u）。サプライヤーは買い取り価格、コンシューマーは販売価格 */
  readonly price: number;
  /** 取引済み量（u） */
  transferred = 0;
  /** 取引済み金額（$） */
  value = 0;
  /** 在庫などが尽きて取引が止まっている時間 */
  stalled = 0;
  /** 取引が止まっている理由 */
  stallReason = '';
  readyWait = 0;
  portId: string | null = null;
  holdDir: THREE.Vector3;

  constructor(id: number, callsign: string, role: Role, size: Size, holdDir: THREE.Vector3) {
    this.id = id;
    this.callsign = callsign;
    this.role = role;
    this.size = size;
    const spec = SHIP_SIZE[size];
    this.length = spec.length;
    this.holdDir = holdDir.clone();
    this.patienceMax = spec.patience;
    this.patience = spec.patience;
    this.cargo = Math.round(spec.cargo * (1 + (Math.random() * 2 - 1) * CARGO_JITTER));
    const [lo, hi] = ECONOMY.buyPrice;
    this.price = role === 'supplier' ? Math.round((lo + Math.random() * (hi - lo)) * 100) / 100 : ECONOMY.sellPrice;
    const color = ROLE_INFO[role].color;

    const L = this.length;
    const r = L * 0.17;
    const noseLen = L * 0.25;
    const bodyLen = L - noseLen;
    const hull = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, metalness: 0.3, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({
      color, metalness: 0.2, roughness: 0.4, emissive: color, emissiveIntensity: 0.3,
    });

    const bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bodyLen, 14), hull);
    bodyMesh.rotation.x = Math.PI / 2;
    bodyMesh.position.z = -L / 2 + bodyLen / 2;
    this.body.add(bodyMesh);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(r, noseLen, 14), accent);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = L / 2 - noseLen / 2;
    this.body.add(nose);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, L * 0.08, 14), accent);
    band.rotation.x = Math.PI / 2;
    band.position.z = -L * 0.15;
    this.body.add(band);

    if (size === 'L') {
      for (const s of [1, -1]) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, r * 0.9, bodyLen * 0.7), hull);
        pod.position.set(s * r * 1.35, 0, -L * 0.12);
        this.body.add(pod);
      }
    } else if (size === 'M') {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(L * 1.3, 0.05, r * 1.4),
        new THREE.MeshStandardMaterial({ color: 0x1b2a6b, metalness: 0.6, roughness: 0.3, emissive: 0x0a1030 }),
      );
      wing.position.z = -L * 0.2;
      this.body.add(wing);
    }

    this.engineMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.9 });
    const engine = new THREE.Mesh(new THREE.SphereGeometry(r * 0.65, 12, 8), this.engineMat);
    engine.position.z = -L / 2;
    this.body.add(engine);

    this.root.add(this.body);

    this.hit = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(2.2, L * 0.75), 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    this.hit.userData.shipId = id;
    this.root.add(this.hit);

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'ship-label';
    this.labelEl.dataset.shipId = String(id);
    const label = new CSS2DObject(this.labelEl);
    label.position.set(0, r + 1.6, 0);
    this.root.add(label);

    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3)),
      new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.5 }),
    );
    this.pathLine.frustumCulled = false;
    this.pathLine.visible = false;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get radius(): number {
    return this.length * 0.45;
  }

  /** 取引の進み具合 0..1 */
  get progress(): number {
    return this.cargo > 0 ? this.transferred / this.cargo : 1;
  }

  /** 取引予定額（$） */
  get plannedValue(): number {
    return this.cargo * this.price;
  }

  get isMoving(): boolean {
    return this.state === 'arriving' || this.state === 'approaching' || this.state === 'departing' || this.state === 'leaving';
  }

  setPath(wps: Waypoint[], onEnd?: () => void) {
    this.waypoints = wps;
    this.onPathEnd = onEnd;
  }

  update(dt: number) {
    const pos = this.root.position;
    let face: THREE.Vector3 | null = null;
    const wp = this.waypoints[0];
    if (wp) {
      const dv = wp.speed - this.speed;
      this.speed += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, dv));
      _to.subVectors(wp.p, pos);
      const dist = _to.length();
      const step = Math.max(0.05, this.speed) * dt;
      if (dist > 0.01) face = wp.face ?? _to.clone().divideScalar(dist);
      if (dist <= step) {
        pos.copy(wp.p);
        this.waypoints.shift();
        wp.onReach?.();
        if (this.waypoints.length === 0) {
          const cb = this.onPathEnd;
          this.onPathEnd = undefined;
          cb?.();
        }
      } else {
        pos.addScaledVector(_to, step / dist);
      }
    } else if (this.state === 'holding') {
      this.speed = 0;
      face = pos.clone().negate().normalize();
    }

    if (face) {
      const up = Math.abs(face.y) > 0.95 ? UP_X : UP_Y;
      _m.lookAt(face, _zero, up);
      _q.setFromRotationMatrix(_m);
      this.body.quaternion.rotateTowards(_q, TURN_RATE * dt);
    }

    const moving = this.waypoints.length > 0;
    this.engineMat.opacity = moving ? 0.5 + Math.min(0.5, this.speed / 20) : 0.15;
  }

  /** パス表示と3Dラベルの更新（描画フレームごと） */
  updateVisuals(selected: boolean, warning: boolean) {
    const showPath = this.waypoints.length > 0 && (this.state === 'approaching' || this.state === 'departing' || selected);
    this.pathLine.visible = showPath;
    if (showPath) {
      const attr = this.pathLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const pts = [this.position, ...this.waypoints.map((w) => w.p)].slice(0, 64);
      pts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
      attr.needsUpdate = true;
      this.pathLine.geometry.setDrawRange(0, pts.length);
      this.pathLine.computeLineDistances();
      (this.pathLine.material as THREE.LineDashedMaterial).opacity = selected ? 0.95 : 0.4;
    }

    let sub = STATE_LABEL[this.state];
    if (this.state === 'holding') sub += ` ${Math.ceil(this.patience)}s`;
    else if (this.state === 'docked') sub += this.stalled > 0 ? ' 停止' : ` ${Math.round(this.progress * 100)}%`;
    else if (this.state === 'approaching' || this.state === 'departing') sub += ` → ${this.portId}`;
    const text = `${this.callsign}|${sub}`;
    if (text !== this.lastLabel) {
      this.lastLabel = text;
      this.labelEl.innerHTML = `<em class="role ${this.role}">${ROLE_INFO[this.role].short}</em><b>${this.callsign}</b><i>${this.size}</i><span>${sub}</span>`;
    }
    const cls = `ship-label s-${this.state}${selected ? ' selected' : ''}${warning ? ' warn' : ''}`
      + (this.state === 'holding' && this.patience < 12 ? ' urgent' : '')
      + (this.state === 'docked' && this.stalled > 0 ? ' urgent' : '');
    if (this.labelEl.className !== cls) this.labelEl.className = cls;
  }

  dispose() {
    this.root.removeFromParent();
    this.pathLine.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.pathLine.geometry.dispose();
    (this.pathLine.material as THREE.Material).dispose();
  }
}

import * as THREE from "three";
import { ECHO, type EchoLook } from "@monumental/shared";
import { TeenRig, type TeenMove } from "./teen";

/** A friend in the dark: their teen, their outfit, their moves, and their light. */
export class Avatar {
  readonly root = new THREE.Group();
  private rig: TeenRig;
  private label: THREE.Sprite;
  private lookKey = "";
  private lastX = 0;
  private lastZ = 0;
  speed = 0;

  constructor(name: string, color: string, look: EchoLook, shadows: boolean) {
    // their light: as strong as the old torch, no shadow map (one per friend would be too costly), a faint beam in the air
    this.rig = new TeenRig({ intensity: 55, distance: 22, decay: 2, shadows: false, beam: 0.045 }, shadows);
    this.rig.root.rotation.y = Math.PI; // the rig faces +z, the game's "forward" is -z
    this.root.add(this.rig.root);
    this.setLook(look);
    this.label = makeLabel(name, color);
    this.label.position.y = 2.05;
    this.root.add(this.label);
  }

  /** Rebuild only when the outfit actually changed. */
  setLook(look: EchoLook) {
    const key = JSON.stringify(look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.rig.build(look);
  }

  /** Called every frame with the smoothed position of this friend. */
  update(x: number, y: number, z: number, yaw: number, pitch: number, torch: boolean, crouch: boolean, talk: boolean, dt: number, seen: boolean, near: number) {
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    const inst = dt > 0 && moved < 3 ? moved / dt : 0;
    this.speed = this.speed * 0.8 + inst * 0.2;
    this.lastX = x; this.lastZ = z;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const sp = this.speed;
    const move: TeenMove = crouch ? (sp > 0.3 ? "crouch" : "crouchIdle") : sp > ECHO.WALK + 0.6 ? "run" : sp > 0.35 ? "walk" : "idle";
    this.rig.update(dt, { move, speed: Math.max(0.6, sp), pitch, lightOn: torch, talk });
    // the name only shows when you can actually see them, close by
    this.label.visible = seen && near < 9;
    (this.label.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (9 - near) / 3));
  }

  dispose() {
    this.rig.dispose();
    const m = this.label.material as THREE.SpriteMaterial;
    m.map?.dispose(); m.dispose();
  }
}

function makeLabel(name: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 28px 'IBM Plex Sans Arabic', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(0,0,0,0.55)";
  const w = Math.min(250, g.measureText(name).width + 28);
  g.beginPath();
  g.roundRect(128 - w / 2, 12, w, 40, 10);
  g.fill();
  g.fillStyle = color;
  g.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.0, 0.25, 1);
  return s;
}

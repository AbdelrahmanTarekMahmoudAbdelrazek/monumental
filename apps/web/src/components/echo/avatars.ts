import * as THREE from "three";
import { ECHO, type EchoLook } from "@monumental/shared";
import { TeenRig, type TeenMove } from "./teen";
import { RealBody, TEEN_CHARACTER, realPeople, type ClipName } from "./realPeople";

/** A friend in the dark: their teen, their outfit, their moves, and their light. */
export class Avatar {
  readonly root = new THREE.Group();
  private rig: TeenRig | null = null;
  /** v35: a real person (Mixamo) when the people loaded; the drawn teen otherwise. */
  private body: RealBody | null = null;
  private bodyTeen = "";
  private torch: THREE.SpotLight | null = null;
  private shadows: boolean;
  private label: THREE.Sprite;
  private lookKey = "";
  private lastX = 0;
  private lastZ = 0;
  speed = 0;

  constructor(name: string, color: string, look: EchoLook, shadows: boolean) {
    this.shadows = shadows;
    if (!realPeople()) {
      // their light: as strong as the old torch, no shadow map (one per friend would be too costly), a faint beam in the air
      this.rig = new TeenRig({ intensity: 55, distance: 22, decay: 2, shadows: false, beam: 0.045 }, shadows);
      this.rig.root.rotation.y = Math.PI; // the rig faces +z, the game's "forward" is -z
      this.root.add(this.rig.root);
    } else {
      this.torch = new THREE.SpotLight(0xfff0d8, 55, 22, 0.45, 0.5, 2);
      this.torch.position.set(0.18, 1.35, -0.25);
      this.torch.target.position.set(0.1, 1.2, -4);
      this.root.add(this.torch, this.torch.target);
    }
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
    // Nora's headlamp is the strong one
    const nora = look.teen === "nora";
    const people = realPeople();
    if (people && this.torch) {
      this.torch.intensity = nora ? 85 : 55; this.torch.distance = nora ? 30 : 22;
      if (this.bodyTeen !== look.teen) {
        this.body?.dispose();
        this.body = new RealBody(people, TEEN_CHARACTER[look.teen], this.shadows);
        this.body.play("idle", 0);
        this.root.add(this.body.root);
        this.bodyTeen = look.teen;
      }
      return;
    }
    if (!this.rig) return;
    this.rig.light = { ...this.rig.light, intensity: nora ? 85 : 55, distance: nora ? 30 : 22 };
    this.rig.build(look);
  }

  /** Called every frame with the smoothed position of this friend. */
  update(x: number, y: number, z: number, yaw: number, pitch: number, torch: boolean, crouch: boolean, talk: boolean, dt: number, seen: boolean, near: number, radio = false) {
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    const inst = dt > 0 && moved < 3 ? moved / dt : 0;
    this.speed = this.speed * 0.8 + inst * 0.2;
    this.lastX = x; this.lastZ = z;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const sp = this.speed;
    const move: TeenMove = crouch ? (sp > 0.3 ? "crouch" : "crouchIdle") : sp > ECHO.WALK + 0.6 ? "run" : sp > 0.35 ? "walk" : radio ? "radio" : "idle";
    if (this.body && this.torch) {
      const clip: ClipName = move === "crouch" ? "crouched_walking" : move === "crouchIdle" ? "crouch_idle" : move === "run" ? "running" : move === "walk" ? "walking" : "idle";
      this.body.play(clip, 0.25);
      // match the feet to the ground speed (the clips were captured near these speeds)
      this.body.setSpeed(clip === "walking" ? Math.max(0.6, Math.min(1.8, sp / 1.5)) : clip === "running" ? Math.max(0.7, Math.min(1.6, sp / 3.6)) : clip === "crouched_walking" ? Math.max(0.6, Math.min(1.8, sp / 1.1)) : 1);
      if (seen || near < 25) this.body.update(dt);
      this.torch.visible = torch;
      this.torch.target.position.set(0.1, 1.2 + Math.sin(pitch) * 4, -4 * Math.cos(pitch));
    } else this.rig?.update(dt, { move, speed: Math.max(0.6, sp), pitch, lightOn: torch, talk: talk || radio });
    // the name only shows when you can actually see them, close by
    this.label.visible = seen && near < 9;
    (this.label.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (9 - near) / 3));
  }

  dispose() {
    this.rig?.dispose();
    this.body?.dispose();
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

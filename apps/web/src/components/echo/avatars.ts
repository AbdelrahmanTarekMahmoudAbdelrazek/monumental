import * as THREE from "three";

/** A friend in the dark: coat, walking legs, a head that looks where they look, and their torch beam. */
export class Avatar {
  readonly root = new THREE.Group();
  readonly light: THREE.SpotLight;
  private body = new THREE.Group();
  private head: THREE.Mesh;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armR: THREE.Group;
  private lens: THREE.MeshBasicMaterial;
  private label: THREE.Sprite;
  private walk = 0;
  private lastX = 0;
  private lastZ = 0;
  speed = 0;

  constructor(name: string, color: string, shadows: boolean) {
    const coat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.85 });
    const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a68a, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.4 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 10), coat);
    torso.position.y = 1.18;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.07, 14), accent);
    band.position.y = 1.32;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), skin);
    this.head.position.y = 1.66;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), coat);
    hood.rotation.x = 0.35;
    this.head.add(hood);

    const leg = () => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.86, 8), dark);
      m.position.y = -0.43;
      g.add(m);
      g.position.y = 0.88;
      return g;
    };
    this.legL = leg(); this.legL.position.x = -0.11;
    this.legR = leg(); this.legR.position.x = 0.11;

    // right arm holds the torch forward
    this.armR = new THREE.Group();
    this.armR.position.set(0.27, 1.42, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8), coat);
    arm.rotation.x = Math.PI / 2;
    arm.position.z = -0.25;
    this.armR.add(arm);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.2, 10), dark);
    torch.rotation.x = Math.PI / 2;
    torch.position.z = -0.58;
    this.armR.add(torch);
    this.lens = new THREE.MeshBasicMaterial({ color: 0xfff1cc });
    const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.034, 12), this.lens);
    lensMesh.position.z = -0.685;
    lensMesh.rotation.y = Math.PI;
    this.armR.add(lensMesh);
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8), coat);
    armL.position.set(-0.29, 1.16, 0);
    armL.rotation.z = 0.12;

    this.body.add(torso, band, this.head, this.legL, this.legR, this.armR, armL);
    this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
    this.root.add(this.body);

    // their torch: a real light so you see their beam sweep the corridor
    this.light = new THREE.SpotLight(0xfff0d0, 0, 22, 0.42, 0.6, 2);
    this.light.position.set(0, 0, -0.69);
    this.light.target.position.set(0, 0, -5);
    this.armR.add(this.light, this.light.target);

    this.label = makeLabel(name, color);
    this.label.position.y = 2.05;
    this.root.add(this.label);
  }

  /** Called every frame with the smoothed position of this friend. */
  update(x: number, y: number, z: number, yaw: number, pitch: number, torch: boolean, crouch: boolean, dt: number, seen: boolean, near: number) {
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.speed = this.speed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
    this.lastX = x; this.lastZ = z;
    this.walk += moved * 3.2;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const swing = Math.min(1, this.speed / 2.6) * 0.55;
    this.legL.rotation.x = Math.sin(this.walk) * swing;
    this.legR.rotation.x = -Math.sin(this.walk) * swing;
    this.body.position.y = Math.abs(Math.sin(this.walk)) * 0.04 * Math.min(1, this.speed / 2.6);
    this.body.scale.y += ((crouch ? 0.72 : 1) - this.body.scale.y) * Math.min(1, dt * 10);
    this.head.rotation.x = -pitch * 0.6;
    this.armR.rotation.x = -pitch * 0.85;
    this.light.intensity = torch ? 55 : 0;
    this.lens.color.setHex(torch ? 0xfff1cc : 0x222222);
    // the name only shows when you can actually see them, close by
    this.label.visible = seen && near < 9;
    (this.label.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (9 - near) / 3));
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
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

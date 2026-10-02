import type { Silhouette } from "./types";

/**
 * Original, hand-authored SVG silhouettes.
 * Every silhouette lives in a box `w` units wide and exactly 100 units tall;
 * y = 100 is the ground line, y = 0 is the monument's recorded height.
 * Because height is normalised to 100, the game scales a silhouette by
 * (height_m / pixelsPerMetre) and the aspect ratio is preserved automatically.
 *
 * Paths are unions of clockwise sub-paths and MUST be rendered with the default
 * `nonzero` fill rule; cut-outs (Eiffel arch, Arc de Triomphe) are wound
 * counter-clockwise on purpose.
 */

type Pt = [number, number];
const poly = (pts: Pt[]) => "M" + pts.map((p) => p.join(",")).join(" L") + " Z";
const rect = (x: number, y: number, w: number, h: number) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
/** half-ellipse dome: centre cx, base y, radius rx, height ry */
const dome = (cx: number, y: number, rx: number, ry: number) =>
  `M${cx - rx},${y} A${rx},${ry} 0 0 1 ${cx + rx},${y} Z`;
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r},${cy} a${r},${r} 0 1 1 ${2 * r},0 a${r},${r} 0 1 1 ${-2 * r},0 Z`;
const spire = (cx: number, yTop: number, yBase: number, halfW: number) =>
  poly([[cx - halfW, yBase], [cx, yTop], [cx + halfW, yBase]]);
const join = (...parts: string[]) => parts.join(" ");

/** A thin minaret / column with a small cap. */
const minaret = (cx: number, yTop: number, yBase: number, halfW: number) =>
  join(rect(cx - halfW, yTop + 4, halfW * 2, yBase - yTop - 4), spire(cx, yTop, yTop + 5, halfW * 1.4));

export const SILHOUETTES: Record<string, Silhouette> = {
  // ---------- EGYPT ----------
  great_pyramid: { w: 165, d: poly([[0, 100], [82.5, 0], [165, 100]]) },
  khafre: { w: 158, d: join(poly([[0, 100], [79, 0], [158, 100]]), /* casing cap */ poly([[66, 16], [79, 0], [92, 16]])) },
  menkaure: { w: 170, d: poly([[0, 100], [85, 0], [170, 100]]) },
  sphinx: {
    w: 360,
    d: join(
      // body lying down, head at the left
      poly([[40, 100], [40, 35], [48, 22], [56, 8], [70, 0], [84, 2], [92, 12], [94, 30], [90, 42], [96, 52], [140, 52], [200, 50], [280, 48], [340, 52], [360, 100]]),
      // headdress flare
      poly([[36, 40], [44, 14], [52, 8], [50, 42]]),
      // front paws
      rect(0, 70, 120, 30),
    ),
  },
  abu_simbel: {
    w: 70,
    d: join(
      // seated colossus: crown, head, torso, legs, throne
      poly([[22, 0], [48, 0], [46, 18], [42, 22], [40, 32], [52, 36], [54, 56], [66, 56], [70, 100], [0, 100], [4, 56], [16, 56], [18, 36], [30, 32], [28, 22], [24, 18]]),
    ),
  },
  cairo_tower: {
    w: 24,
    d: join(
      rect(10, 0, 4, 10), // antenna mast
      poly([[6, 10], [18, 10], [19, 16], [5, 16]]), // crown / observation deck
      poly([[8, 16], [16, 16], [15, 100], [9, 100]]), // lattice shaft
      poly([[0, 92], [24, 92], [24, 100], [0, 100]]),
    ),
  },
  luxor_obelisk: { w: 14, d: join(poly([[4, 10], [7, 0], [10, 10]]), poly([[4, 10], [10, 10], [12, 100], [2, 100]])) },

  // ---------- ANCIENT / RELIGIOUS ----------
  taj_mahal: {
    w: 150,
    d: join(
      // central onion dome with finial
      rect(74, 0, 2, 8),
      `M52,38 C52,20 66,8 75,8 C84,8 98,20 98,38 Z`,
      rect(52, 38, 46, 4),
      // main cube with iwan
      poly([[30, 42], [120, 42], [120, 100], [30, 100]]),
      // four chhatris
      dome(40, 40, 8, 8), dome(110, 40, 8, 8),
      // corner minarets
      minaret(8, 22, 100, 3), minaret(142, 22, 100, 3),
      rect(0, 92, 150, 8),
    ),
  },
  angkor_wat: {
    w: 140,
    d: join(
      // central lotus tower
      poly([[70, 0], [60, 10], [58, 40], [82, 40], [80, 10]]),
      poly([[50, 40], [90, 40], [92, 70], [48, 70]]),
      // flanking towers
      poly([[22, 24], [16, 36], [14, 70], [34, 70], [32, 36]]),
      poly([[118, 24], [112, 36], [110, 70], [130, 70], [128, 36]]),
      // galleries
      rect(0, 70, 140, 30),
    ),
  },
  el_castillo: {
    w: 150,
    d: join(
      // temple on top
      poly([[55, 0], [95, 0], [97, 20], [53, 20]]),
      // 9 stepped terraces
      poly([[50, 20], [100, 20], [106, 30], [112, 40], [118, 50], [124, 60], [130, 70], [136, 80], [142, 90], [150, 100], [0, 100], [8, 90], [14, 80], [20, 70], [26, 60], [32, 50], [38, 40], [44, 30]]),
      // staircase
      poly([[66, 20], [84, 20], [92, 100], [58, 100]]),
    ),
  },
  pyramid_sun: {
    w: 340,
    d: poly([[0, 100], [40, 78], [60, 72], [90, 52], [110, 46], [140, 20], [160, 14], [170, 0], [180, 14], [200, 20], [230, 46], [250, 52], [280, 72], [300, 78], [340, 100]]),
  },
  tikal_iv: {
    w: 90,
    d: join(
      // roof comb
      poly([[30, 0], [60, 0], [58, 26], [32, 26]]),
      poly([[22, 26], [68, 26], [72, 46], [18, 46]]),
      // stepped base
      poly([[18, 46], [72, 46], [80, 64], [86, 82], [90, 100], [0, 100], [4, 82], [10, 64]]),
    ),
  },
  parthenon: {
    w: 220,
    d: join(
      poly([[0, 32], [110, 0], [220, 32]]), // pediment
      rect(0, 32, 220, 12), // entablature
      ...Array.from({ length: 8 }, (_, i) => rect(8 + i * 29, 44, 10, 46)),
      rect(0, 90, 220, 10),
    ),
  },
  colosseum: {
    w: 420,
    d: join(
      // outer wall silhouette with partial collapse on the right
      poly([[0, 0], [250, 0], [260, 6], [300, 22], [330, 40], [360, 48], [420, 50], [420, 100], [0, 100]]),
    ),
  },
  pantheon: {
    w: 120,
    d: join(dome(60, 44, 56, 44), rect(4, 44, 112, 56), poly([[12, 50], [60, 32], [108, 50]]), rect(14, 50, 92, 50)),
  },
  petra_treasury: {
    w: 70,
    d: join(
      // urn on tholos
      circle(35, 6, 5), rect(33, 8, 4, 6),
      dome(35, 24, 10, 12),
      // upper storey with broken pediment
      poly([[2, 44], [10, 30], [22, 34], [24, 24], [46, 24], [48, 34], [60, 30], [68, 44]]),
      rect(2, 44, 66, 10),
      // lower portico
      poly([[8, 54], [35, 44], [62, 54]]),
      rect(2, 54, 66, 46),
    ),
  },
  stonehenge: { w: 200, d: join(rect(0, 0, 200, 12), rect(10, 12, 40, 88), rect(80, 12, 40, 88), rect(150, 12, 40, 88)) },
  kaaba: { w: 110, d: rect(0, 0, 110, 100) },
  hagia_sophia: {
    w: 230,
    d: join(
      dome(115, 30, 44, 30),
      rect(66, 30, 98, 6),
      poly([[50, 36], [180, 36], [182, 100], [48, 100]]),
      dome(40, 56, 28, 16), dome(190, 56, 28, 16),
      rect(12, 56, 206, 44),
      minaret(6, 8, 100, 3), minaret(224, 8, 100, 3),
    ),
  },
  st_peters: {
    w: 220,
    d: join(
      rect(109, 0, 2, 6), circle(110, 8, 3),
      poly([[104, 10], [116, 10], [120, 22], [100, 22]]), // lantern
      `M64,54 C64,30 86,22 110,22 C134,22 156,30 156,54 Z`,
      rect(60, 54, 100, 12),
      // facade + wings
      poly([[0, 70], [40, 60], [180, 60], [220, 70], [220, 100], [0, 100]]),
    ),
  },
  milan_cathedral: {
    w: 200,
    d: join(
      spire(100, 0, 42, 6), // Madonnina spire
      ...Array.from({ length: 9 }, (_, i) => spire(12 + i * 22, 30 + Math.abs(4 - i) * 6, 60, 4)),
      poly([[0, 60], [200, 60], [200, 100], [0, 100]]),
    ),
  },
  cologne_cathedral: {
    w: 110,
    d: join(
      spire(20, 0, 42, 10), rect(10, 42, 20, 58),
      spire(90, 0, 42, 10), rect(80, 42, 20, 58),
      spire(56, 32, 56, 5), rect(30, 56, 50, 44),
    ),
  },
  ulm_minster: { w: 90, d: join(spire(45, 0, 40, 12), rect(33, 40, 24, 60), rect(0, 62, 90, 38)) },
  sagrada_familia: {
    w: 150,
    d: join(
      // Tower of Jesus with cross
      rect(74, 0, 2, 8), rect(70, 3, 10, 2),
      spire(75, 8, 46, 8), rect(67, 46, 16, 54),
      // Mary tower + evangelist towers
      spire(50, 20, 60, 6), rect(44, 60, 12, 40),
      spire(100, 20, 60, 6), rect(94, 60, 12, 40),
      // façade towers (tapered)
      ...[14, 30, 120, 136].map((cx) => poly([[cx - 5, 100], [cx - 2, 42], [cx, 36], [cx + 2, 42], [cx + 5, 100]])),
      rect(0, 70, 150, 30),
    ),
  },
  blue_mosque: {
    w: 180,
    d: join(
      dome(90, 46, 36, 30), rect(56, 46, 68, 6),
      dome(50, 60, 22, 14), dome(130, 60, 22, 14),
      rect(24, 60, 132, 40),
      minaret(8, 0, 100, 2.5), minaret(172, 0, 100, 2.5), minaret(20, 14, 100, 2.5), minaret(160, 14, 100, 2.5),
    ),
  },
  dome_of_rock: { w: 120, d: join(rect(59, 0, 2, 14), `M40,56 C40,24 60,14 60,14 C60,14 80,24 80,56 Z`, rect(36, 56, 48, 6), poly([[0, 62], [120, 62], [120, 100], [0, 100]])) },
  hassan_ii: { w: 60, d: join(rect(24, 0, 12, 6), rect(20, 6, 20, 70), poly([[0, 76], [60, 76], [60, 100], [0, 100]])) },
  qutb_minar: { w: 24, d: join(dome(12, 8, 5, 6), poly([[7, 8], [17, 8], [21, 100], [3, 100]])) },
  lotus_temple: {
    w: 200,
    d: join(
      `M100,0 C80,20 72,50 70,66 L130,66 C128,50 120,20 100,0 Z`,
      `M60,14 C40,34 30,58 28,66 L68,66 C68,52 70,30 60,14 Z`,
      `M140,14 C160,34 170,58 172,66 L132,66 C132,52 130,30 140,14 Z`,
      poly([[0, 100], [20, 66], [180, 66], [200, 100]]),
    ),
  },
  shwedagon: { w: 110, d: join(rect(54, 0, 2, 10), `M46,34 C46,16 52,8 55,10 C58,8 64,16 64,34 Z`, poly([[40, 34], [70, 34], [84, 62], [26, 62]]), poly([[14, 62], [96, 62], [110, 100], [0, 100]])) },
  potala: {
    w: 320,
    d: join(
      poly([[100, 0], [220, 0], [224, 40], [96, 40]]), // Red Palace
      poly([[40, 40], [280, 40], [300, 70], [20, 70]]), // White Palace
      poly([[0, 70], [320, 70], [320, 100], [0, 100]]),
    ),
  },
  himeji: {
    w: 150,
    d: join(
      poly([[40, 20], [75, 0], [110, 20], [100, 24], [50, 24]]),
      poly([[30, 42], [50, 24], [100, 24], [120, 42], [110, 46], [40, 46]]),
      poly([[20, 66], [40, 46], [110, 46], [130, 66], [120, 70], [30, 70]]),
      poly([[0, 100], [30, 70], [120, 70], [150, 100]]),
    ),
  },
  kinkakuji: { w: 150, d: join(poly([[60, 0], [90, 0], [110, 26], [40, 26]]), rect(44, 26, 62, 20), poly([[20, 46], [130, 46], [140, 62], [10, 62]]), rect(16, 62, 118, 16), poly([[0, 78], [150, 78], [150, 100], [0, 100]])) },
  wat_arun: { w: 70, d: join(poly([[35, 0], [26, 30], [20, 60], [50, 60], [44, 30]]), poly([[10, 60], [60, 60], [70, 100], [0, 100]])) },
  leshan_buddha: {
    w: 70,
    d: join(
      // head & topknot
      dome(35, 14, 10, 10), circle(35, 6, 4),
      // shoulders & body
      poly([[16, 28], [54, 28], [60, 44], [64, 70], [68, 100], [2, 100], [6, 70], [10, 44]]),
    ),
  },
  spring_temple_buddha: {
    w: 46,
    d: join(dome(23, 12, 7, 9), circle(23, 4, 3), poly([[10, 20], [36, 20], [40, 36], [38, 70], [44, 100], [2, 100], [8, 70], [6, 36]])),
  },
  big_buddha_hk: { w: 110, d: join(dome(55, 28, 14, 16), circle(55, 10, 6), poly([[32, 36], [78, 36], [86, 56], [92, 68], [110, 72], [110, 100], [0, 100], [0, 72], [18, 68], [24, 56]])) },
  motherland_calls: {
    w: 70,
    d: join(
      // sword
      poly([[30, 0], [34, 0], [38, 46], [26, 46]]),
      // figure with raised arm, flowing dress
      poly([[26, 40], [38, 40], [36, 50], [44, 54], [48, 62], [46, 70], [56, 100], [6, 100], [14, 70], [16, 56], [26, 52]]),
      circle(32, 56, 6),
    ),
  },
  christ_redeemer: {
    w: 100,
    d: join(
      circle(50, 10, 7), // head
      rect(0, 20, 100, 8), // outstretched arms
      poly([[36, 28], [64, 28], [66, 60], [70, 100], [30, 100], [34, 60]]),
    ),
  },
  statue_of_liberty: {
    w: 60,
    d: join(
      // torch & raised arm
      poly([[40, 0], [46, 0], [48, 6], [38, 6]]), rect(40, 6, 5, 24),
      // crown + head
      poly([[22, 28], [26, 20], [30, 26], [34, 20], [38, 28]]), circle(30, 32, 6),
      // body/robe
      poly([[18, 38], [42, 38], [46, 56], [48, 72], [12, 72], [14, 56]]),
      // pedestal (included in the 93 m height)
      poly([[8, 72], [52, 72], [54, 84], [6, 84]]), poly([[0, 84], [60, 84], [60, 100], [0, 100]]),
    ),
  },
  statue_of_unity: {
    w: 46,
    d: join(circle(23, 6, 5), poly([[14, 12], [32, 12], [36, 24], [40, 40], [34, 44], [36, 100], [10, 100], [12, 44], [6, 40], [10, 24]])),
  },
  moai: { w: 36, d: join(poly([[8, 0], [28, 0], [30, 24], [28, 60], [36, 64], [36, 100], [0, 100], [0, 64], [8, 60], [6, 24]])) },
  mount_rushmore: {
    w: 300,
    d: join(
      // four faces as a rock-face profile
      poly([[0, 100], [0, 36], [20, 30], [36, 8], [60, 4], [78, 20], [90, 42], [110, 40], [130, 10], [150, 6], [168, 26], [182, 46], [202, 44], [218, 12], [242, 4], [262, 22], [278, 44], [300, 50], [300, 100]]),
    ),
  },
  great_wall_tower: { w: 60, d: join(...Array.from({ length: 4 }, (_, i) => rect(4 + i * 16, 0, 8, 8)), rect(0, 8, 60, 92)) },

  // ---------- TOWERS ----------
  eiffel_tower: {
    w: 130,
    d: join(
      rect(64, 0, 2, 12), // antenna (included in 330 m)
      poly([[58, 12], [72, 12], [74, 20], [56, 20]]),
      // tapering lattice
      poly([[60, 20], [70, 20], [78, 50], [84, 50], [90, 72], [100, 72], [130, 100], [0, 100], [30, 72], [40, 72], [46, 50], [52, 50]]),
      // arch cut-out
      `M112,100 C100,78 30,78 18,100 Z`,
    ),
  },
  cn_tower: { w: 40, d: join(rect(19, 0, 2, 26), poly([[14, 26], [26, 26], [28, 42], [12, 42]]), poly([[16, 42], [24, 42], [26, 100], [14, 100]]), rect(10, 56, 20, 4)) },
  tokyo_skytree: { w: 60, d: join(rect(29, 0, 2, 18), poly([[24, 18], [36, 18], [38, 30], [22, 30]]), poly([[26, 30], [34, 30], [37, 54], [23, 54]]), poly([[20, 54], [40, 54], [42, 62], [18, 62]]), poly([[22, 62], [38, 62], [60, 100], [0, 100]])) },
  space_needle: { w: 70, d: join(rect(34, 0, 2, 14), poly([[20, 14], [50, 14], [56, 24], [14, 24]]), poly([[30, 24], [40, 24], [38, 80], [32, 80]]), poly([[0, 100], [26, 80], [44, 80], [70, 100]])) },
  kl_tower: { w: 40, d: join(rect(19, 0, 2, 14), poly([[12, 14], [28, 14], [30, 26], [10, 26]]), poly([[16, 26], [24, 26], [28, 100], [12, 100]])) },
  washington_monument: { w: 20, d: join(poly([[6, 10], [10, 0], [14, 10]]), poly([[6, 10], [14, 10], [16, 100], [4, 100]])) },
  elizabeth_tower: { w: 30, d: join(spire(15, 0, 28, 9), rect(6, 28, 18, 72), rect(4, 40, 22, 12)) },
  leaning_tower: {
    w: 42,
    d: join(
      // tilted cylinder (≈ 4°)
      poly([[12, 0], [34, 0], [42, 100], [20, 100]]),
      // ring arcades implied by slight step at top
      poly([[10, 8], [36, 8], [37, 14], [11, 14]]),
    ),
  },
  giralda: { w: 26, d: join(circle(13, 4, 3), rect(11, 6, 4, 8), rect(8, 14, 10, 10), rect(4, 24, 18, 76)) },
  nelsons_column: { w: 24, d: join(circle(12, 6, 4), rect(9, 10, 6, 8), rect(6, 18, 12, 6), rect(8, 24, 8, 62), rect(2, 86, 20, 14)) },
  trajans_column: { w: 24, d: join(circle(12, 6, 4), rect(9, 10, 6, 6), rect(7, 16, 10, 72), rect(0, 88, 24, 12)) },
  mole_antonelliana: { w: 50, d: join(rect(24, 0, 2, 10), spire(25, 10, 46, 4), poly([[14, 46], [36, 46], [40, 62], [10, 62]]), rect(6, 62, 38, 38)) },
  monas: { w: 36, d: join(poly([[12, 0], [18, 8], [24, 0], [24, 12], [12, 12]]), poly([[14, 12], [22, 12], [24, 82], [12, 82]]), rect(0, 82, 36, 18)) },
  obelisco_ba: { w: 14, d: join(poly([[4, 6], [7, 0], [10, 6]]), poly([[4, 6], [10, 6], [12, 100], [2, 100]])) },
  atomium: {
    w: 100,
    d: join(
      circle(50, 10, 10), circle(50, 56, 10), circle(18, 36, 10), circle(82, 36, 10), circle(18, 80, 10), circle(82, 80, 10),
      poly([[47, 20], [53, 20], [53, 46], [47, 46]]), poly([[47, 66], [53, 66], [53, 100], [47, 100]]),
      poly([[26, 32], [44, 16], [46, 20], [28, 36]]), poly([[74, 32], [56, 16], [54, 20], [72, 36]]),
      poly([[24, 74], [44, 60], [46, 64], [26, 78]]), poly([[76, 74], [56, 60], [54, 64], [74, 78]]),
    ),
  },
  gateway_arch: { w: 110, d: `M0,100 L18,100 C26,40 40,14 55,14 C70,14 84,40 92,100 L110,100 C100,30 82,0 55,0 C28,0 10,30 0,100 Z` },
  arc_de_triomphe: { w: 100, d: join(rect(0, 0, 100, 100), `M72,100 L72,56 A22,22 0 0 0 28,56 L28,100 Z`) },
  brandenburg_gate: {
    w: 250,
    d: join(
      // quadriga
      poly([[112, 0], [138, 0], [142, 10], [108, 10]]), poly([[96, 6], [112, 2], [112, 12], [100, 14]]), poly([[154, 6], [138, 2], [138, 12], [150, 14]]),
      rect(90, 14, 70, 10),
      rect(0, 24, 250, 14),
      ...Array.from({ length: 6 }, (_, i) => rect(8 + i * 46, 38, 14, 62)),
      rect(0, 94, 250, 6),
    ),
  },
  tower_bridge: {
    w: 220,
    d: join(
      spire(50, 0, 14, 8), rect(36, 14, 28, 86), spire(170, 0, 14, 8), rect(156, 14, 28, 86),
      rect(64, 36, 92, 6), rect(64, 70, 92, 6), rect(0, 76, 220, 6),
    ),
  },
  golden_gate_tower: {
    w: 60,
    d: join(
      rect(10, 0, 10, 100), rect(40, 0, 10, 100),
      rect(10, 8, 40, 6), rect(10, 30, 40, 6), rect(10, 52, 40, 6), rect(10, 74, 40, 6),
      rect(0, 68, 60, 4), // road deck
    ),
  },
  sydney_harbour_bridge: { w: 440, d: join(`M0,100 L0,40 C100,-10 340,-10 440,40 L440,100 L420,100 L420,46 C340,8 100,8 20,46 L20,100 Z`, rect(0, 60, 440, 5), rect(0, 34, 16, 66), rect(424, 34, 16, 66)) },
  sydney_opera: {
    w: 280,
    d: join(
      `M20,100 C40,40 90,10 120,0 C110,30 112,70 130,100 Z`,
      `M110,100 C128,46 170,20 200,12 C186,40 190,72 210,100 Z`,
      `M190,100 C204,66 232,46 260,40 C248,60 250,84 266,100 Z`,
      rect(0, 90, 280, 10),
    ),
  },
  lincoln_memorial: { w: 220, d: join(rect(0, 0, 220, 14), ...Array.from({ length: 12 }, (_, i) => rect(6 + i * 18, 14, 8, 70)), rect(0, 84, 220, 16)) },
  neuschwanstein: {
    w: 180,
    d: join(
      spire(30, 0, 24, 8), rect(22, 24, 16, 76), spire(150, 6, 28, 8), rect(142, 28, 16, 72),
      poly([[60, 40], [120, 40], [122, 46], [58, 46]]), rect(62, 46, 56, 54), spire(90, 22, 40, 8),
      rect(38, 60, 24, 40), rect(118, 60, 24, 40), rect(0, 80, 180, 20),
    ),
  },
  hollywood_sign: { w: 600, d: join(...Array.from({ length: 9 }, (_, i) => rect(i * 68, 0, 48, 100))) },
  cleopatras_needle: { w: 12, d: join(poly([[3, 6], [6, 0], [9, 6]]), poly([[3, 6], [9, 6], [11, 100], [1, 100]])) },
  white_tower: { w: 110, d: join(rect(0, 0, 16, 100), rect(94, 0, 16, 100), rect(16, 10, 78, 90), rect(48, 4, 14, 8)) },
  great_mosque_djenne: { w: 200, d: join(poly([[90, 0], [110, 0], [116, 40], [84, 40]]), poly([[20, 10], [40, 10], [46, 40], [14, 40]]), poly([[160, 10], [180, 10], [186, 40], [154, 40]]), poly([[0, 40], [200, 40], [200, 100], [0, 100]])) },

  // ---------- SKYSCRAPERS ----------
  burj_khalifa: {
    w: 60,
    d: join(
      rect(29, 0, 2, 12),
      poly([[27, 12], [33, 12], [34, 30], [26, 30]]),
      poly([[24, 30], [36, 30], [38, 50], [22, 50]]),
      poly([[19, 50], [41, 50], [44, 70], [16, 70]]),
      poly([[12, 70], [48, 70], [52, 86], [8, 86]]),
      poly([[0, 86], [60, 86], [60, 100], [0, 100]]),
    ),
  },
  empire_state: {
    w: 70,
    d: join(
      rect(34, 0, 2, 14), // antenna (included in 443 m)
      rect(30, 14, 10, 10),
      rect(26, 24, 18, 16),
      rect(20, 40, 30, 34),
      rect(10, 74, 50, 14),
      rect(0, 88, 70, 12),
    ),
  },
  chrysler: { w: 60, d: join(rect(29, 0, 2, 10), poly([[24, 10], [36, 10], [38, 18], [22, 18]]), poly([[20, 18], [40, 18], [42, 26], [18, 26]]), poly([[16, 26], [44, 26], [46, 34], [14, 34]]), rect(12, 34, 36, 54), rect(0, 88, 60, 12)) },
  petronas: {
    w: 120,
    d: join(
      ...[30, 90].map((cx) => join(rect(cx - 1, 0, 2, 10), spire(cx, 10, 18, 5), rect(cx - 8, 18, 16, 12), rect(cx - 12, 30, 24, 20), rect(cx - 16, 50, 32, 50))),
      rect(44, 60, 32, 4), // skybridge
      rect(0, 92, 120, 8),
    ),
  },
  taipei_101: {
    w: 60,
    d: join(
      rect(29, 0, 2, 12),
      rect(24, 12, 12, 10),
      ...Array.from({ length: 8 }, (_, i) => poly([[18, 22 + i * 8], [42, 22 + i * 8], [44, 30 + i * 8], [16, 30 + i * 8]])),
      rect(10, 86, 40, 14),
      rect(0, 92, 60, 8),
    ),
  },
  shanghai_tower: { w: 70, d: join(poly([[30, 0], [44, 0], [52, 40], [58, 100], [12, 100], [18, 40]]), rect(0, 94, 70, 6)) },
  one_wtc: { w: 60, d: join(rect(29, 0, 2, 24), rect(22, 24, 16, 6), poly([[20, 30], [40, 30], [48, 92], [12, 92]]), rect(0, 92, 60, 8)) },
  merdeka_118: { w: 60, d: join(rect(29, 0, 2, 18), spire(30, 18, 34, 6), poly([[22, 34], [38, 34], [42, 60], [18, 60]]), poly([[14, 60], [46, 60], [50, 100], [10, 100]])) },
  lotte_world: { w: 50, d: join(rect(24, 0, 2, 8), poly([[20, 8], [30, 8], [38, 100], [12, 100]])) },
  the_shard: { w: 50, d: join(poly([[22, 0], [28, 0], [40, 100], [10, 100]])) },
  burj_al_arab: { w: 90, d: join(rect(44, 0, 2, 10), `M18,100 L18,40 C18,20 40,10 46,10 L54,10 L54,100 Z`, poly([[54, 10], [60, 10], [90, 100], [54, 100]]), rect(10, 36, 10, 64)) },
  gherkin: { w: 60, d: `M6,100 C0,60 10,20 30,0 C50,20 60,60 54,100 Z` },
  kingdom_centre: { w: 70, d: join(`M0,100 L0,40 C0,10 20,0 35,0 C50,0 70,10 70,40 L70,100 L58,100 L58,60 C58,40 48,30 35,30 C22,30 12,40 12,60 L12,100 Z`, rect(10, 24, 50, 6)) },
  willis_tower: { w: 70, d: join(rect(19, 0, 2, 20), rect(49, 0, 2, 40), rect(14, 20, 20, 20), rect(14, 40, 42, 20), rect(0, 60, 56, 20), rect(0, 80, 70, 20)) },
};

/** Lookup a silhouette; falls back to a generic obelisk-ish block. */
export function getSilhouette(id: string): Silhouette {
  return SILHOUETTES[id] ?? { w: 30, d: rect(0, 0, 30, 100) };
}

export const _shapeHelpers = { poly, rect, dome, circle, spire, join };

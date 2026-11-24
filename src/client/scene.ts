import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { boxes } from '../shared/world'
import { EYE, spray, type Weapon } from '../shared/physics'
import type { GameEvent, Player } from '../shared/protocol'

// Bab al-Sahar palette: sunlit sandstone, glazed turquoise, brass, dyed cloth.
const palette = {
  sand: 0xcfa977,
  tile: 0x2a6469,
  wood: 0x6b4629,
  plaster: 0xefe1c5,
  trim: 0xc9973d,
  fabric: 0x8f3524,
}

type Attire = {
  robe: number
  cloak: number
  trim: number
  wrap: number
  agal: number
  sash: number
  skin: number
  head: 'keffiyeh' | 'turban' | 'veil'
}

// Five travelling fighters, each with a different robe, bisht and headwear.
const attire: Attire[] = [
  { robe: 0xf1e6cd, cloak: 0x1d4f57, trim: 0xd8a845, wrap: 0xf7f0dd, agal: 0x2a2119, sash: 0x8c2f22, skin: 0xb47c4f, head: 'keffiyeh' },
  { robe: 0xe8dcc0, cloak: 0x8f3524, trim: 0xe3b75f, wrap: 0xe9d4a6, agal: 0x3b2a1c, sash: 0x2f4d5a, skin: 0x8d5a34, head: 'turban' },
  { robe: 0xded4bc, cloak: 0x3d3a63, trim: 0xcf9a45, wrap: 0xf2e8d3, agal: 0x241d18, sash: 0x6d1f1c, skin: 0xc08a5c, head: 'veil' },
  { robe: 0xf3ead6, cloak: 0x4a6b3d, trim: 0xd9b45c, wrap: 0xefe3ca, agal: 0x30251b, sash: 0x8f5a24, skin: 0x9a6438, head: 'keffiyeh' },
  { robe: 0xe8dcc4, cloak: 0x7a3f57, trim: 0xe6c377, wrap: 0xf7f0e0, agal: 0x2b2119, sash: 0x33565b, skin: 0xc9946a, head: 'turban' },
]

export class World {
  renderer: T.WebGLRenderer
  scene = new T.Scene()
  camera = new T.PerspectiveCamera(85, 1, 0.06, 220)
  viewScene = new T.Scene()
  viewCamera = new T.PerspectiveCamera(63, 1, 0.02, 10)
  rifle = new T.Group()
  knife = new T.Group()
  muzzle: T.Mesh
  players = new Map<
    string,
    { root: T.Group; legs: T.Group[]; arms: T.Group[]; shadow: T.Mesh }
  >()
  effects: { mesh: T.Object3D; life: number; velocity?: T.Vector3 }[] = []
  lamps: T.PointLight[] = []
  dust?: T.Points
  kick = 0
  slash = 0
  reload = 0
  bob = 0
  landing = 0
  aim = 0
  lastY = 0
  wasGrounded = false
  fov = 85
  time = 0
  menu = true
  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.scene.fog = new T.Fog(0xdca878, 66, 178)
    this.scene.add(this.sky())
    this.scene.add(new T.HemisphereLight(0x9dc2e6, 0x8f6742, 1.75))
    const sun = new T.DirectionalLight(0xffd09a, 2.9)
    sun.position.set(-34, 44, 26)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, {
      left: -42,
      right: 42,
      top: 42,
      bottom: -42,
      near: 1,
      far: 140,
    })
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.035
    this.scene.add(sun)
    const bounce = new T.DirectionalLight(0xffab74, 0.34)
    bounce.position.set(30, 14, -32)
    this.scene.add(bounce)
    this.buildMap()
    for (const [x, y, z] of [
      [-16, 4.6, -5.4],
      [12, 4.6, 6],
      [-2, 4.4, 14],
      [19, 4.4, -16],
    ] as const) {
      const lamp = new T.PointLight(0xffb05e, 26, 20, 2)
      lamp.position.set(x, y, z)
      this.scene.add(lamp)
      this.lamps.push(lamp)
    }
    this.viewScene.add(new T.HemisphereLight(0xfff0d8, 0x8d6a4a, 1.7))
    const light = new T.DirectionalLight(0xfff0cf, 2.6)
    light.position.set(-2, 4, 1)
    this.viewScene.add(light)
    this.rifle = this.makeBanduq()
    this.knife = this.makeKhanjar()
    this.viewScene.add(this.rifle, this.knife)
    this.muzzle = new T.Mesh(
      new T.ConeGeometry(0.07, 0.19, 5),
      new T.MeshBasicMaterial({
        color: 0xffe4a1,
        transparent: true,
        opacity: 0.92,
      }),
    )
    this.muzzle.rotation.x = -Math.PI / 2
    this.muzzle.position.set(0, 0.034, -0.9)
    this.rifle.add(this.muzzle)
    this.muzzle.visible = false
    this.dust = this.makeDust()
    this.scene.add(this.dust)
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }
  sky() {
    const material = new T.ShaderMaterial({
      uniforms: {
        high: { value: new T.Color(0x2a4a6d) },
        mid: { value: new T.Color(0xdc9560) },
        low: { value: new T.Color(0xf6cb96) },
      },
      vertexShader:
        'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 high; uniform vec3 mid; uniform vec3 low; varying vec3 vDir; void main() { float h = clamp(normalize(vDir).y * 1.15 + 0.1, 0.0, 1.0); vec3 c = mix(low, mid, smoothstep(0.0, 0.42, h)); c = mix(c, high, smoothstep(0.34, 1.0, h)); gl_FragColor = vec4(c, 1.0); }',
      side: T.BackSide,
      depthWrite: false,
    })
    const mesh = new T.Mesh(new T.SphereGeometry(165, 28, 18), material)
    mesh.frustumCulled = false
    return mesh
  }
  makeDust() {
    const count = 340,
      positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 62
      positions[i * 3 + 1] = Math.random() * 6.5 + 0.3
      positions[i * 3 + 2] = (Math.random() - 0.5) * 56
    }
    const geometry = new T.BufferGeometry()
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
    return new T.Points(
      geometry,
      new T.PointsMaterial({
        color: 0xf0cf9e,
        size: 0.05,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    )
  }
  resize() {
    const w = innerWidth,
      h = innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.viewCamera.aspect = w / h
    // Hold a constant horizontal view so the weapon never swallows a narrow view.
    this.viewCamera.fov =
      (2 * Math.atan(Math.tan((63 * Math.PI) / 360) * (1.6 / Math.max(0.5, w / h))) * 180) /
      Math.PI
    this.viewCamera.updateProjectionMatrix()
  }
  buildMap() {
    const batches = new Map<number, T.BufferGeometry[]>()
    const glass: T.BufferGeometry[] = []
    const add = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
      ry = 0,
    ) => {
      const g = new T.BoxGeometry(w, h, d)
      if (ry) g.rotateY(ry)
      g.translate(x, y, z)
      let list = batches.get(color)
      if (!list) batches.set(color, (list = []))
      list.push(g)
    }
    const glow = (x: number, y: number, z: number, s: number) => {
      const g = new T.BoxGeometry(s, s * 1.2, s)
      g.translate(x, y, z)
      glass.push(g)
    }
    for (const b of boxes) {
      add(b.x, b.y, b.z, b.w, b.h, b.d, palette[b.material])
      if ((b.material === 'sand' || b.material === 'plaster') && b.h > 2)
        add(b.x, b.y + b.h / 2 + 0.07, b.z, b.w + 0.16, 0.14, b.d + 0.16, palette.trim)
      if (b.material === 'sand' && b.h < 1 && b.w > 5) {
        // Courtyard paving is cut into courses.
        add(b.x, b.y + b.h / 2 + 0.005, b.z, b.w - 0.3, 0.01, 0.04, 0xc09c73)
      }
    }
    // Paving joints across the courtyard.
    for (let z = -20; z < 23; z += 4)
      for (let x = -22; x < 24; x += 4) {
        add(x, 0.006, z, 3.98, 0.008, 0.025, 0xc0a077)
        add(x, 0.008, z, 0.025, 0.008, 3.98, 0xc0a077)
      }
    // Brass inlay: a compass ring around the open southern court.
    for (let n = 0; n < 26; n++) {
      const a = (n / 26) * Math.PI * 2
      add(Math.cos(a) * 6.4, 0.016, Math.sin(a) * 6.4 + 14, 0.86, 0.02, 0.17, palette.trim, a)
    }
    // Pointed arcades with glazed spandrels on the long walls.
    const facade = (z: number, face: number) => {
      for (let x = -18; x <= 18; x += 9) {
        add(x - 1.72, 2.6, z, 0.34, 5.2, 0.24, palette.plaster)
        add(x + 1.72, 2.6, z, 0.34, 5.2, 0.24, palette.plaster)
        add(x - 1.02, 5.3, z, 1.48, 0.3, 0.22, palette.plaster)
        add(x + 1.02, 5.3, z, 1.48, 0.3, 0.22, palette.plaster)
        add(x - 0.54, 5.62, z, 0.92, 0.28, 0.2, palette.plaster)
        add(x + 0.54, 5.62, z, 0.92, 0.28, 0.2, palette.plaster)
        add(x, 5.88, z, 0.4, 0.32, 0.22, palette.trim)
        add(x, 2.9, z + face * 0.16, 2.94, 4.6, 0.06, palette.fabric)
        add(x, 0.62, z + face * 0.16, 2.94, 0.34, 0.06, palette.tile)
        add(x, 3.5, z + face * 0.17, 2.4, 0.12, 0.05, palette.trim)
      }
    }
    facade(-21.82, 1)
    facade(21.82, -1)
    // Mashrabiya screens on the side walls.
    for (const side of [-1, 1]) {
      const x = side * 23.82
      for (const z of [-16, -7, 2, 11]) {
        add(x, 3.72, z, 0.12, 0.26, 3.7, palette.trim)
        add(x, 0.42, z, 0.12, 0.26, 3.7, palette.trim)
        for (let i = -3; i <= 3; i++)
          add(x, 2.05, z + i * 0.46, 0.1, 3.3, 0.08, palette.tile)
        for (let i = -2; i <= 2; i++)
          add(x, 2.05 + i * 0.66, z, 0.1, 0.07, 3.3, 0x1f4f54)
      }
    }
    // Brass lanterns: gold frame, warm glass.
    const lamp = (x: number, y: number, z: number, chain: number) => {
      add(x, y + 0.05, z, 0.18, 0.07, 0.18, palette.trim)
      add(x, y - 0.23, z, 0.15, 0.06, 0.15, palette.trim)
      glow(x, y - 0.1, z, 0.17)
      for (const [dx, dz] of [
        [-0.09, -0.09],
        [0.09, -0.09],
        [-0.09, 0.09],
        [0.09, 0.09],
      ])
        add(x + dx, y - 0.1, z + dz, 0.022, 0.26, 0.022, palette.trim)
      if (chain) add(x, y + 0.09 + chain / 2, z, 0.018, chain, 0.018, 0x3c3126)
    }
    for (const x of [-20, -16, -12, -8]) lamp(x, 5.1, -5.6, 0.7)
    for (const z of [-16, -8, 0, 8, 16]) {
      lamp(-23.1, 5.7, z, 0.5)
      lamp(23.1, 5.7, z, 0.5)
    }
    lamp(3.4, 8.4, -2.1, 0.4)
    // Arcade roof shading battens and a striped valance over the gate.
    for (let x = -21.5; x < -8; x += 0.65)
      add(x, 6, -5.2, 0.22, 0.18, 5.6, 0xb9a581)
    for (let z = -20; z < 22; z += 2.4)
      add(-23.3, 5.5, z, 1.5, 0.12, 2.3, z % 4.8 ? palette.fabric : palette.plaster)
    // Tiled basins are filled to the brass rim.
    const water = (x: number, y: number, z: number, w: number, d: number) => {
      const mesh = new T.Mesh(
        new T.PlaneGeometry(w, d),
        new T.MeshStandardMaterial({
          color: 0x2f8189,
          roughness: 0.08,
          metalness: 0.3,
          transparent: true,
          opacity: 0.94,
        }),
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(x, y, z)
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }
    water(-10, 3.06, 8, 2.95, 6.15)
    water(13, 2.88, -11, 5.15, 2.75)
    // Carpet bales, rope battens and a market stack of dyed cloth.
    for (const b of boxes.filter((b) => b.material === 'wood')) {
      for (let h = -b.h / 2 + 0.1; h < b.h / 2; h += 0.3)
        add(b.x, b.y + h, b.z + b.d / 2 + 0.01, b.w, 0.022, 0.03, 0x4a3120)
      for (const x of [-0.32, 0.32])
        add(b.x + x * b.w, b.y, b.z + b.d / 2 + 0.03, 0.1, b.h, 0.05, 0xa8512b)
      add(b.x, b.y + b.h / 2 + 0.06, b.z, b.w - 0.15, 0.1, b.d - 0.15, 0xa8492c)
    }
    // Hand-knotted rugs.
    const rug = (
      x: number,
      z: number,
      w: number,
      d: number,
      ry: number,
      base: number,
      inner: number,
    ) => {
      add(x, 0.014, z, w, 0.028, d, base, ry)
      add(x, 0.026, z, w - 0.42, 0.024, d - 0.42, inner, ry)
      add(x, 0.036, z, w - 0.9, 0.02, d - 0.9, base, ry)
    }
    rug(-18, 16, 5.4, 3.6, 0.1, 0x8f3524, palette.trim)
    rug(9, 9, 4.6, 3.2, -0.18, 0x255c66, 0xe4d2ab)
    rug(-14, 2, 4.2, 2.8, 0.32, 0x6b3a63, palette.trim)
    // Central pavilion: brass drum, turquoise dome and a gilded finial.
    const dome = new T.Mesh(
      new T.SphereGeometry(2.5, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new T.MeshStandardMaterial({
        color: 0x2f7d81,
        roughness: 0.4,
        metalness: 0.34,
        flatShading: true,
      }),
    )
    dome.position.set(-1, 3.2, -1)
    dome.castShadow = true
    this.scene.add(dome)
    const drum = new T.Mesh(
      new T.CylinderGeometry(2.58, 2.58, 0.7, 16),
      new T.MeshStandardMaterial({ color: palette.plaster, roughness: 0.92 }),
    )
    drum.position.set(-1, 3.0, -1)
    drum.castShadow = true
    this.scene.add(drum)
    const finial = new T.Mesh(
      new T.ConeGeometry(0.18, 0.7, 8),
      new T.MeshStandardMaterial({ color: palette.trim, roughness: 0.35, metalness: 0.75 }),
    )
    finial.position.set(-1, 5.95, -1)
    this.scene.add(finial)
    // Palms beyond the walls.
    const palm = (x: number, z: number, h: number) => {
      const lean = 0.9
      for (let y = 0; y < h; y += 0.5)
        add(x + Math.sin(y * 0.35) * lean * (y / h), y + 0.25, z, 0.42, 0.52, 0.42, 0x6b4e30)
      const top = x + Math.sin(h * 0.35) * lean
      for (let n = 0; n < 8; n++) {
        const a = (n / 8) * Math.PI * 2
        add(
          top + Math.cos(a) * 1.5,
          h + 0.2,
          z - Math.sin(a) * 1.5,
          2.4,
          0.14,
          0.52,
          n % 2 ? 0x4d7a44 : 0x3b6738,
          a,
        )
      }
      add(top, h + 0.14, z, 0.52, 0.42, 0.52, 0x7d5c34)
    }
    palm(-34, 27, 9)
    palm(31, 31, 10)
    palm(37, -9, 8.5)
    palm(-36, -19, 9.5)
    palm(8, 34, 11)
    // A minaret and a second far tower give the fort its silhouette.
    const minaret = (x: number, z: number, scale = 1) => {
      add(x, 6 * scale, z, 3.4, 12 * scale, 3.4, palette.plaster)
      add(x, 12.2 * scale, z, 3.9, 0.32, 3.9, palette.trim)
      add(x, 13.8 * scale, z, 2.9, 2.8 * scale, 2.9, palette.plaster)
      add(x, 15.3 * scale, z, 2.6, 0.26, 2.6, palette.trim)
      add(x, 16.2 * scale, z, 2.1, 2.2 * scale, 2.1, palette.plaster)
      add(x, 17.4 * scale, z, 2.4, 0.22, 2.4, palette.trim)
      add(x, 18.4 * scale, z, 1.2, 1.9 * scale, 1.2, palette.plaster)
    }
    minaret(33, -30, 1)
    minaret(-32, 31, 0.82)
    const cap = new T.Mesh(
      new T.ConeGeometry(1.05, 2.4, 12),
      new T.MeshStandardMaterial({ color: 0x2f7d81, roughness: 0.42, metalness: 0.3, flatShading: true }),
    )
    cap.position.set(33, 20.8, -30)
    this.scene.add(cap)
    // Flat-roofed houses ringing the courtyard, then dunes.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2,
        r = 60 + Math.sin(i * 2.3) * 6,
        h = 6 + Math.abs(Math.sin(i * 1.7)) * 12
      add(
        Math.cos(a) * r,
        h / 2 - 0.6,
        Math.sin(a) * r,
        9 + (i % 3) * 4,
        h,
        8 + (i % 2) * 5,
        i % 3 === 0 ? 0xcbaa80 : 0xbf9d74,
        a * 0.5,
      )
      add(Math.cos(a) * r, h - 0.3, Math.sin(a) * r, 2.4, 1.6, 2.4, 0x90705a, a * 0.5)
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2,
        r = 98 + Math.sin(i * 1.9) * 9
      add(Math.cos(a) * r, 1.4, Math.sin(a) * r, 46, 9, 40, 0xcaa87c, a)
    }
    add(0, -1.6, 0, 280, 1, 280, 0xc2a077)
    // Bolts of dyed cloth hung on the arcade front.
    for (const [x, color] of [
      [-19.5, 0x8f3524],
      [-16.5, 0x2b5a63],
      [-13.5, 0x7a3f57],
      [-10.5, 0x9c6a2c],
    ] as const) {
      add(x, 3.4, -7.42, 1.7, 2.3, 0.06, color)
      add(x, 4.58, -7.4, 1.9, 0.12, 0.1, 0x4a3120)
      add(x, 2.2, -7.4, 1.5, 0.1, 0.06, palette.trim)
    }
    // A rope of pennants across the court.
    for (let i = 0; i <= 22; i++) {
      const t = i / 22,
        x = -23 + t * 46,
        y = 6.9 - Math.sin(t * Math.PI) * 1.7
      add(x, y - 0.3, 0, 0.42, 0.52, 0.04, i % 2 ? palette.fabric : 0x2b5a63)
    }
    const rope = new T.Line(
      new T.BufferGeometry().setFromPoints(
        Array.from({ length: 24 }, (_, i) => {
          const t = i / 23
          return new T.Vector3(-23 + t * 46, 6.9 - Math.sin(t * Math.PI) * 1.7, 0)
        }),
      ),
      new T.LineBasicMaterial({ color: 0x3c3126 }),
    )
    this.scene.add(rope)
    // Glazed tile band running under the parapet of every wall.
    for (let x = -22; x <= 22; x += 2) {
      add(x, 7.15, -21.86, 1.9, 0.34, 0.06, palette.tile)
      add(x, 7.15, 21.86, 1.9, 0.34, 0.06, palette.tile)
    }
    for (let z = -20; z <= 20; z += 2) {
      add(-23.86, 7.15, z, 0.06, 0.34, 1.9, palette.tile)
      add(23.86, 7.15, z, 0.06, 0.34, 1.9, palette.tile)
    }
    // Brass braziers in front of the pavilion.
    for (const [bx, bz] of [
      [-4.6, 3.6],
      [2.8, 3.6],
    ] as const) {
      add(bx, 0.55, bz, 0.5, 1.1, 0.5, palette.trim)
      add(bx, 1.18, bz, 0.74, 0.18, 0.74, palette.trim)
      glow(bx, 1.42, bz, 0.34)
    }
    for (const [color, geoms] of batches) {
      const merged = mergeGeometries(geoms)
      const mesh = new T.Mesh(
        merged,
        new T.MeshStandardMaterial({
          color,
          roughness: 0.9,
          metalness: color === palette.trim ? 0.45 : 0,
          flatShading: true,
        }),
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
      for (const g of geoms) g.dispose()
    }
    const glassMesh = new T.Mesh(
      mergeGeometries(glass),
      new T.MeshStandardMaterial({
        color: 0xffd48a,
        emissive: 0xffa749,
        emissiveIntensity: 1.8,
        roughness: 0.4,
        flatShading: true,
      }),
    )
    this.scene.add(glassMesh)
    for (const g of glass) g.dispose()
    this.addSigns()
  }
  signs: { canvas: HTMLCanvasElement; texture: T.CanvasTexture }[] = []
  // Painted Arabic plaques: gate name and the courtyard mark.
  addSigns() {
    const signs: [string, number, number, number, number, number][] = [
      ['باب السحر', -15, 5.05, -7.38, 3.4, 1.0],
      ['ميدان', 3.4, 6.6, -2.66, 1.6, 0.9],
    ]
    const created = signs.map(([text, x, y, z, w, h]) => {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = Math.round((512 * h) / w)
      const texture = new T.CanvasTexture(canvas)
      texture.colorSpace = T.SRGBColorSpace
      const mesh = new T.Mesh(
        new T.PlaneGeometry(w, h),
        new T.MeshBasicMaterial({ map: texture, transparent: true }),
      )
      mesh.position.set(x, y, z)
      this.scene.add(mesh)
      const entry = { canvas, texture }
      this.paintSign(entry, text)
      this.signs.push(entry)
      return entry
    })
    document.fonts?.ready.then(() =>
      created.forEach((entry, n) => this.paintSign(entry, signs[n][0])),
    )
  }
  paintSign(
    entry: { canvas: HTMLCanvasElement; texture: T.CanvasTexture },
    text: string,
  ) {
    const ctx = entry.canvas.getContext('2d')
    if (!ctx) return
    const w = entry.canvas.width,
      h = entry.canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#123a3d'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#d8b26a'
    ctx.lineWidth = Math.max(4, w * 0.012)
    ctx.strokeRect(w * 0.02, h * 0.05, w * 0.96, h * 0.9)
    ctx.fillStyle = '#f3dfae'
    ctx.font = `700 ${Math.round(h * 0.56)}px Amiri, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h * 0.54)
    entry.texture.needsUpdate = true
  }
  part(
    group: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    rx = 0,
  ) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshStandardMaterial({
        color,
        roughness: color === palette.trim ? 0.38 : 0.66,
        metalness: color === palette.trim ? 0.7 : 0,
        flatShading: true,
      }),
    )
    mesh.position.set(x, y, z)
    mesh.rotation.x = rx
    group.add(mesh)
    return mesh
  }
  // A matchlock rifle: walnut stock and fore-end, steel barrel with brass bands.
  makeBanduq() {
    const g = new T.Group(),
      p = this.part.bind(this, g)
    p(0, 0.0, 0.06, 0.1, 0.12, 0.32, 0x53381f)
    p(0, -0.046, 0.27, 0.092, 0.17, 0.24, 0x5f4229)
    p(0, -0.075, 0.39, 0.098, 0.19, 0.045, 0x382514)
    p(0, -0.005, -0.32, 0.078, 0.08, 0.5, 0x6b4a2c)
    p(0, 0.034, -0.5, 0.044, 0.05, 0.66, 0x9d9a90)
    p(0, 0.062, -0.5, 0.018, 0.012, 0.62, 0xb9b3a3)
    p(0, 0.034, -0.84, 0.054, 0.058, 0.07, palette.trim)
    p(0, 0.034, -0.66, 0.05, 0.054, 0.035, palette.trim)
    p(0, 0.034, -0.3, 0.05, 0.054, 0.035, palette.trim)
    p(0.046, 0.0, -0.05, 0.035, 0.1, 0.1, palette.trim)
    p(0.062, 0.055, 0.01, 0.03, 0.09, 0.045, 0xc9973d)
    p(0, -0.086, 0.04, 0.035, 0.05, 0.09, 0x7d6a4a)
    // Right hand on the wrist of the stock, left hand under the fore-end.
    p(0.012, -0.108, 0.12, 0.088, 0.085, 0.11, 0xa9774e)
    p(0.02, -0.24, 0.34, 0.088, 0.1, 0.18, 0xdcc9a5, -0.45)
    p(0.02, -0.196, 0.27, 0.094, 0.026, 0.045, palette.trim)
    p(-0.02, -0.03, -0.38, 0.085, 0.07, 0.12, 0xa9774e)
    p(-0.1, -0.14, -0.38, 0.085, 0.098, 0.18, 0xdcc9a5, -0.6)
    p(-0.078, -0.152, -0.29, 0.09, 0.024, 0.042, palette.trim)
    return g
  }
  // A curved khanjar with an ivory hilt and a gilded guard.
  makeKhanjar() {
    const g = new T.Group(),
      p = this.part.bind(this, g)
    p(0, -0.08, 0.02, 0.06, 0.065, 0.2, 0xe8dec4)
    p(0, -0.08, 0.125, 0.072, 0.08, 0.04, palette.trim)
    p(0, -0.08, -0.09, 0.135, 0.034, 0.045, palette.trim)
    for (let n = 0; n < 5; n++)
      p(0, -0.068 + n * 0.011, -0.16 - n * 0.07, 0.03, 0.046 - n * 0.005, 0.076, 0xd6ddd6, -0.1 - n * 0.07)
    p(0.01, -0.08, 0.02, 0.026, 0.026, 0.035, 0x2f7c74)
    p(0.012, -0.13, 0.07, 0.09, 0.08, 0.11, 0xa9774e)
    p(0.016, -0.23, 0.26, 0.088, 0.098, 0.18, 0xdcc9a5, -0.5)
    p(0.016, -0.192, 0.2, 0.094, 0.024, 0.042, palette.trim)
    return g
  }
  // A fighter in a thobe, open bisht, sash and keffiyeh with an agal cord.
  actor(p: Player) {
    const a = attire[[...p.id].reduce((n, c) => n + c.charCodeAt(0), 0) % attire.length]
    const root = new T.Group(),
      part = this.part.bind(this, root)
    part(0, 1.02, 0, 0.52, 0.6, 0.3, a.robe)
    part(0.3, 1.02, 0.02, 0.1, 0.62, 0.34, a.cloak)
    part(-0.3, 1.02, 0.02, 0.1, 0.62, 0.34, a.cloak)
    part(0, 1.04, 0.18, 0.66, 0.64, 0.09, a.cloak)
    part(0, 1.32, 0.19, 0.6, 0.06, 0.1, palette.trim)
    part(0, 0.77, 0, 0.54, 0.11, 0.33, a.sash)
    part(0, 0.77, -0.165, 0.11, 0.1, 0.035, palette.trim)
    part(0, 1.47, 0, 0.34, 0.35, 0.32, a.skin)
    if (a.head === 'turban') {
      part(0, 1.66, 0, 0.45, 0.2, 0.43, a.wrap)
      part(0, 1.79, 0, 0.37, 0.1, 0.35, a.wrap)
      part(0, 1.855, 0, 0.2, 0.08, 0.2, a.trim)
      part(0.2, 1.6, 0.11, 0.06, 0.3, 0.18, a.wrap)
      part(-0.2, 1.6, 0.11, 0.06, 0.3, 0.18, a.wrap)
    } else {
      part(0, 1.665, 0, 0.42, 0.14, 0.4, a.wrap)
      part(0.21, 1.5, 0.02, 0.06, 0.34, 0.36, a.wrap)
      part(-0.21, 1.5, 0.02, 0.06, 0.34, 0.36, a.wrap)
      part(0, 1.56, 0.185, 0.38, 0.3, 0.06, a.wrap)
      part(0, 1.61, 0, 0.44, 0.055, 0.42, a.agal)
    }
    part(0, 1.505, -0.172, 0.25, 0.045, 0.03, 0x33261c)
    part(0.075, 1.44, -0.172, 0.05, 0.028, 0.02, 0x241a13)
    part(-0.075, 1.44, -0.172, 0.05, 0.028, 0.02, 0x241a13)
    if (a.head === 'veil') part(0, 1.37, -0.171, 0.31, 0.17, 0.035, a.cloak)
    else part(0, 1.35, -0.168, 0.16, 0.03, 0.03, 0x8d5a3c)
    // Curved dagger at the sash.
    part(0.19, 0.93, -0.15, 0.05, 0.3, 0.06, palette.trim)
    part(0.19, 1.05, -0.15, 0.09, 0.05, 0.07, 0xd9dcc9)
    const legs: T.Group[] = [],
      arms: T.Group[] = []
    for (const side of [-1, 1]) {
      const leg = new T.Group()
      leg.position.set(side * 0.16, 0.78, 0)
      this.part(leg, 0, -0.31, 0, 0.24, 0.58, 0.25, a.robe)
      this.part(leg, 0, -0.68, -0.045, 0.26, 0.19, 0.34, 0x3c2a1c)
      root.add(leg)
      legs.push(leg)
      const arm = new T.Group()
      arm.position.set(side * 0.35, 1.22, 0)
      this.part(arm, 0, -0.2, -0.06, 0.2, 0.42, 0.22, a.robe, -0.4)
      this.part(arm, 0, -0.4, -0.16, 0.17, 0.14, 0.17, a.skin)
      this.part(arm, 0, -0.32, -0.11, 0.21, 0.05, 0.2, a.trim, -0.4)
      root.add(arm)
      arms.push(arm)
    }
    part(0.22, 0.98, -0.45, 0.07, 0.08, 0.58, 0x4a3220)
    part(0.22, 1.0, -0.66, 0.05, 0.06, 0.12, 0xc08f3d)
    const shadow = new T.Mesh(
      new T.CircleGeometry(0.52, 20),
      new T.MeshBasicMaterial({
        color: 0x3a2c1e,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    this.scene.add(shadow, root)
    this.players.set(p.id, { root, legs, arms, shadow })
    return this.players.get(p.id)!
  }
  updatePlayers(players: Player[], localId: string) {
    const seen = new Set<string>()
    for (const p of players) {
      if (p.id === localId) continue
      seen.add(p.id)
      const a = this.players.get(p.id) ?? this.actor(p)
      a.root.visible = p.health > 0
      a.shadow.visible = p.health > 0
      a.root.position.set(p.x, p.y, p.z)
      a.root.rotation.y = p.yaw
      a.shadow.position.set(p.x, 0.018, p.z)
      a.shadow.scale.setScalar(1 + Math.max(0, p.y) * 0.1)
      const walk = Math.min(1, Math.hypot(p.vx, p.vz) / 6)
      a.legs.forEach(
        (leg, n) =>
          (leg.rotation.x =
            Math.sin(this.time * 13 + n * Math.PI) * 0.65 * walk),
      )
      a.arms.forEach((arm) => (arm.rotation.x = -p.pitch))
    }
    for (const [id, a] of this.players)
      if (!seen.has(id)) {
        this.scene.remove(a.root, a.shadow)
        a.root.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.geometry.dispose()
            ;(o.material as T.Material).dispose()
          }
        })
        a.shadow.geometry.dispose()
        ;(a.shadow.material as T.Material).dispose()
        this.players.delete(id)
      }
  }
  shot(weapon: Weapon) {
    if (weapon === 'rifle') {
      this.kick = Math.min(0.12, this.kick + 0.065)
      this.muzzle.visible = true
      setTimeout(() => (this.muzzle.visible = false), 35)
    } else this.slash = 1
  }
  event(e: GameEvent, localId: string) {
    if (e.type !== 'shot') return
    if (e.id !== localId && e.weapon === 'rifle') {
      const points = [
        new T.Vector3(e.from.x, e.from.y - 0.2, e.from.z),
        new T.Vector3(e.to.x, e.to.y, e.to.z),
      ]
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(points),
        new T.LineBasicMaterial({
          color: 0xffd79b,
          transparent: true,
          opacity: 0.7,
        }),
      )
      this.scene.add(line)
      this.effects.push({ mesh: line, life: 0.06 })
    }
    if (e.weapon === 'rifle') {
      for (let n = 0; n < (e.hit ? 5 : 3); n++) {
        const mesh = new T.Mesh(
          new T.BoxGeometry(0.035, 0.035, 0.035),
          new T.MeshBasicMaterial({ color: e.hit ? 0xc9603f : 0xf2ddb5 }),
        )
        mesh.position.set(e.to.x, e.to.y, e.to.z)
        this.scene.add(mesh)
        this.effects.push({
          mesh,
          life: 0.25 + Math.random() * 0.15,
          velocity: new T.Vector3(
            (Math.random() - 0.5) * 3,
            Math.random() * 3,
            (Math.random() - 0.5) * 3,
          ),
        })
      }
    }
  }
  render(
    dt: number,
    local?: Player,
    look?: { yaw: number; pitch: number; aim: boolean },
    idle = false,
  ) {
    this.time += dt
    for (let n = this.effects.length - 1; n >= 0; n--) {
      const e = this.effects[n]
      e.life -= dt
      if (e.velocity) {
        e.velocity.y -= 10 * dt
        e.mesh.position.addScaledVector(e.velocity, dt)
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh)
        const m = e.mesh as T.Mesh
        m.geometry.dispose()
        ;(m.material as T.Material).dispose()
        this.effects.splice(n, 1)
      }
    }
    if (this.dust) {
      this.dust.rotation.y += dt * 0.012
      this.dust.position.y = Math.sin(this.time * 0.22) * 0.18
    }
    this.lamps.forEach((lamp, n) => {
      lamp.intensity = 24 + Math.sin(this.time * 2.3 + n * 1.7) * 3.4
    })
    this.kick *= Math.exp(-dt * 19)
    this.slash *= Math.exp(-dt * 10)
    if (!local) {
      const a = Math.sin(this.time * 0.045) * 0.09
      this.camera.position.set(33 + Math.sin(a) * 6, 20, 35)
      this.camera.lookAt(-2, 4, -1)
      this.camera.fov = 50
      this.camera.updateProjectionMatrix()
    } else if (look) {
      const speed = Math.hypot(local.vx, local.vz)
      this.bob += dt * speed * 1.5
      if (!this.wasGrounded && local.grounded) this.landing = 0.055
      this.wasGrounded = local.grounded
      this.landing *= Math.exp(-dt * 14)
      this.aim +=
        (Number(look.aim && local.weapon === 'rifle') - this.aim) *
        (1 - Math.exp(-dt * 15))
      this.camera.position.set(
        local.x,
        local.y +
          EYE -
          this.landing +
          (local.grounded ? Math.sin(this.bob * 2) * 0.012 : 0),
        local.z,
      )
      const recoil = spray(Math.max(0, local.shot - 1), look.aim)
      this.camera.rotation.order = 'YXZ'
      this.camera.rotation.set(
        look.pitch + this.kick * 0.24 + recoil.pitch,
        look.yaw + recoil.yaw,
        0,
      )
      this.camera.fov = this.fov - this.aim * 18 + Math.max(0, speed - 8) * 0.35
      this.camera.updateProjectionMatrix()
      this.rifle.visible = local.weapon === 'rifle' && local.health > 0
      this.knife.visible = local.weapon === 'knife' && local.health > 0
      const reload =
        local.reloadUntil > 0
          ? Math.sin(Math.max(0, Math.min(1, this.reload)) * Math.PI)
          : 0
      const g = local.weapon === 'rifle' ? this.rifle : this.knife
      g.scale.setScalar(0.86)
      g.position.set(
        0.27 * (1 - this.aim) + Math.cos(this.bob) * 0.007,
        -0.3 +
          this.aim * 0.12 -
          Math.abs(Math.sin(this.bob)) * 0.007 -
          reload * 0.2,
        -0.82 + this.kick + 0.06 * this.slash,
      )
      g.rotation.set(
        this.kick * 0.65 + reload * 0.65 - this.slash * 0.7,
        -0.035 + this.slash * 0.5,
        -0.03 - reload * 0.5 + this.slash * 0.7,
      )
    }
    this.renderer.autoClear = true
    this.renderer.render(this.scene, this.camera)
    this.renderer.shadowMap.autoUpdate = false
    if (local && look && !idle) {
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.viewScene, this.viewCamera)
    }
  }
}

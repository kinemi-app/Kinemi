// A graphics card for the "render on your own GPU" card: graphite shroud, pearl trim, two fans that
// spin, a Kinemi-green light strip, copper heat pipes, a backplate and gold contacts.
import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mats, shadowMaterial } from '../materials';
import type { Built } from '../stage';
import type { ModelOptions } from '../types';

function fan(m: ReturnType<typeof mats>) {
  const g = new Group();
  const duct = new Mesh(new TorusGeometry(0.98, 0.07, 10, 64), m.satin);
  const well = new Mesh(new CylinderGeometry(0.96, 0.96, 0.06, 48), m.rubber);
  well.rotation.x = Math.PI / 2;
  well.position.z = -0.08;
  const blades = new Group();
  const blade = new RoundedBoxGeometry(0.78, 0.26, 0.04, 2, 0.02);
  for (let i = 0; i < 9; i++) {
    const b = new Mesh(blade, m.soft);
    const a = (i / 9) * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0);
    b.rotation.set(0.45, 0, a);
    blades.add(b);
  }
  const hub = new Mesh(new CylinderGeometry(0.3, 0.3, 0.16, 32), m.pearl);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.04;
  const ring = new Mesh(new TorusGeometry(0.31, 0.025, 8, 40), m.glow);
  ring.position.z = 0.12;
  g.add(duct, well, blades, hub, ring);
  return { g, blades };
}

export function create(_opts: ModelOptions): Built {
  const m = mats();
  const root = new Group();
  const card = new Group();
  root.add(card);

  const pcb = new Mesh(new BoxGeometry(6.2, 2.3, 0.08), m.pcb);
  pcb.position.set(0, -0.05, -0.46);
  const back = new Mesh(new RoundedBoxGeometry(6.2, 2.3, 0.06, 2, 0.02), m.satin);
  back.position.set(0, -0.05, -0.54);
  const shroud = new Mesh(new RoundedBoxGeometry(6.0, 2.0, 0.66, 4, 0.16), m.graphite);
  shroud.position.set(0.1, 0.05, -0.05);
  const trim = new Mesh(new RoundedBoxGeometry(5.9, 0.14, 0.7, 2, 0.05), m.pearl);
  trim.position.set(0.1, 1.06, -0.05);
  // its own copy of the glow, so the pulse stays on this card
  const ledMat = (m.glow as MeshBasicMaterial).clone();
  const led = new Mesh(new BoxGeometry(5.4, 0.05, 0.05), ledMat);
  led.position.set(0.1, 0.92, 0.3);
  card.add(pcb, back, shroud, trim, led);

  const fans = [fan(m), fan(m)];
  fans[0].g.position.set(-1.35, 0.02, 0.31);
  fans[1].g.position.set(1.55, 0.02, 0.31);
  card.add(fans[0].g, fans[1].g);

  // gold contacts along the bottom edge
  const finger = new BoxGeometry(0.08, 0.26, 0.1);
  const fingers = new InstancedMesh(finger, m.gold, 26);
  const mat = new Matrix4();
  for (let i = 0; i < 26; i++) {
    mat.compose(new Vector3(-1.4 + i * 0.12 + (i > 6 ? 0.12 : 0), -1.3, -0.46), new Quaternion(), new Vector3(1, 1, 1));
    fingers.setMatrixAt(i, mat);
  }
  card.add(fingers);

  // bracket with ports
  const bracket = new Mesh(new BoxGeometry(0.06, 2.7, 1.0), m.chrome);
  bracket.position.set(-3.15, 0.05, -0.15);
  card.add(bracket);
  for (let i = 0; i < 3; i++) {
    const port = new Mesh(new BoxGeometry(0.08, 0.32, 0.5), m.rubber);
    port.position.set(-3.19, 0.6 - i * 0.55, -0.15);
    card.add(port);
  }

  // copper heat pipes peeking over the top, and the power socket
  for (let i = 0; i < 3; i++) {
    const pipe = new Mesh(new CylinderGeometry(0.07, 0.07, 1.4, 12), m.copper);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(1.7 + i * 0.05, 1.2, -0.3 + i * 0.16);
    card.add(pipe);
  }
  const socket = new Mesh(new RoundedBoxGeometry(0.7, 0.24, 0.36, 2, 0.04), m.rubber);
  socket.position.set(0.4, 1.22, -0.15);
  card.add(socket);

  // the Kinemi staircase on the shroud end
  const step = new RoundedBoxGeometry(0.16, 0.16, 0.1, 2, 0.03);
  for (let r = 0; r < 3; r++)
    for (let j = 0; j < 2; j++) {
      const s = new Mesh(step, m.green);
      s.position.set(2.62 + (r + j) * 0.17, 0.62 - r * 0.17, 0.3);
      card.add(s);
    }

  const shadow = new Mesh(new PlaneGeometry(9, 4), shadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.8;
  root.add(shadow);

  card.rotation.set(0.18, -0.38, 0);
  const look = { x: 0, y: 0 };

  return {
    root,
    view: { fov: 24, distance: 17, target: [0, -0.1, 0], dir: [0, 0.2, 1] },
    update(t, dt, s) {
      const k = 1 - Math.exp(-dt * 2.5);
      look.x += (s.pointer.x - look.x) * k;
      look.y += (s.pointer.y - look.y) * k;
      card.rotation.y = -0.38 + Math.sin(t * 0.45) * 0.22 + look.x * 0.2;
      card.rotation.x = 0.18 + Math.sin(t * 0.6) * 0.04 + look.y * 0.08;
      card.position.y = Math.sin(t * 1.0) * 0.06;
      const speed = s.hover ? 14 : 6;
      fans[0].blades.rotation.z -= dt * speed;
      fans[1].blades.rotation.z -= dt * speed * 1.07;
      ledMat.color.setHSL(0.4, 0.75, 0.55 + Math.sin(t * 2) * 0.08);
      return true;
    },
    dispose() {
      ledMat.dispose();
    },
  };
}

# @nmnsl/three-rapier.js

A lightweight physics helper that bridges [Three.js](https://threejs.org/) and [Rapier3D](https://rapier.rs/). It creates colliders from mesh geometry, manages rigid bodies, and keeps Three.js object transforms in sync with the physics simulation each frame.

Originally authored by [mrdoob](https://github.com/mrdoob) and published under the [@nmnsl](https://github.com/Neosoulink) scope.

## Features

- Automatic collider generation from mesh geometry (sphere, cuboid, or bounding box)
- Static and dynamic rigid bodies via mass
- Scene traversal with `userData.physics` metadata
- Per-instance physics for `InstancedMesh`
- Simple simulation loop with transform sync back to Three.js objects
- Tree-shakeable ESM build with TypeScript declarations
- Peer dependencies on Three.js and Rapier — no bundled duplicates

## Installation

```bash
pnpm add @nmnsl/three-rapier.js three @dimforge/rapier3d-compat
```

```bash
npm install @nmnsl/three-rapier.js three @dimforge/rapier3d-compat
```

```bash
yarn add @nmnsl/three-rapier.js three @dimforge/rapier3d-compat
```

### Peer dependencies

| Package                     | Version    |
| --------------------------- | ---------- |
| `three`                     | `^0.187.0` |
| `@dimforge/rapier3d-compat` | `^0.21.0`  |

## Quick start

```ts
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import { RapierPhysics } from "@nmnsl/three-rapier.js";

const physics = await RapierPhysics();

// Static floor (mass = 0 → fixed rigid body)
const floor = new Mesh(
  new BoxGeometry(10, 1, 10),
  new MeshBasicMaterial()
);
floor.position.setY(-5);
physics.addToWorld(floor, 0, 0.2);

// Dynamic cube
const cube = new Mesh(
  new BoxGeometry(1, 1, 1),
  new MeshBasicMaterial()
);
cube.position.setY(5);
physics.addToWorld(cube, 1, 0.5);

function animate() {
  physics.step(1 / 60);
  requestAnimationFrame(animate);
}

animate();
```

## Usage

### Initializing Rapier

Call `RapierPhysics()` once at startup. It lazily loads and initializes `@dimforge/rapier3d-compat`, then returns a `Physics` instance with a default gravity of `(0, -9.81, 0)`.

```ts
import { RapierPhysics } from "@nmnsl/three-rapier.js";

const physics = await RapierPhysics();
```

You can also construct `Physics` directly if you already have an initialized Rapier module:

```ts
import RAPIER from "@dimforge/rapier3d-compat";
import { Physics } from "@nmnsl/three-rapier.js";

await RAPIER.init();
const physics = new Physics(RAPIER);
```

### Adding objects

#### Single object

```ts
physics.addToWorld(mesh, mass, restitution);
```

| Argument      | Default | Description                                                               |
| ------------- | ------- | ------------------------------------------------------------------------- |
| `mass`        | `0`     | `0` creates a fixed (static) body; any value `> 0` creates a dynamic body |
| `restitution` | `0`     | Bounciness coefficient passed to the collider                             |

#### Scene with metadata

Traverse a scene graph and register every child that defines `userData.physics`:

```ts
floor.userData.physics = { mass: 0, restitution: 0.2 };
cube.userData.physics = { mass: 1, restitution: 0.5 };

physics.addSceneToWorld(scene);
```

### Collider shapes

Colliders are inferred automatically from geometry:

| Condition                                               | Collider type                          |
| ------------------------------------------------------- | -------------------------------------- |
| `SphereGeometry` or `IcosahedronGeometry`               | Ball (`ColliderDesc.ball`)             |
| Mesh with position attribute                            | Axis-aligned cuboid from vertex bounds |
| `userData.useBoundingBox === true`, or no position data | Cuboid from `Box3.setFromObject`       |

Force bounding-box colliders when vertex-based bounds are inaccurate:

```ts
mesh.userData.useBoundingBox = true;
```

### Instanced meshes

For `InstancedMesh`, one rigid body is created per instance using the instance matrix position. During `step()`, only non-fixed instances have their transforms written back to the instance matrix.

### Simulation loop

```ts
physics.step(timestep?, eventQueue?, hooks?);
```

- Advances the Rapier world by one step
- Optionally sets `world.timestep` when `timestep` is provided
- Syncs dynamic body translations and rotations back to registered Three.js objects

Call this once per frame, typically with `1 / 60` or your renderer's delta time.

### Manipulating bodies

```ts
import { Vector3 } from "@dimforge/rapier3d-compat";

// Teleport and reset velocities
physics.setObjectPosition(mesh, new Vector3(0, 10, 0));

// Apply linear velocity
physics.setObjectVelocity(mesh, new Vector3(0, 5, 0));

// InstancedMesh: pass instance index as third argument
physics.setObjectPosition(instancedMesh, new Vector3(0, 10, 0), 2);
```

### Removing objects

```ts
physics.removeFromWorld(mesh);
physics.dispose(); // clear all tracked objects (does not destroy the Rapier world)
```

## API reference

### `RapierPhysics(): Promise<Physics>`

Async factory that initializes Rapier and returns a `Physics` instance.

### `class Physics`

| Member                                                              | Description                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `rapier`                                                            | The Rapier module reference                                           |
| `world`                                                             | `Rapier.World` instance                                               |
| `physicalObjects`                                                   | Array of registered `Object3DWithGeometry`                            |
| `physical3DObjectsMap`                                              | `WeakMap` from object to `PhysicsProperties` or `PhysicsProperties[]` |
| `addToWorld(object, mass?, restitution?)`                           | Register a single object                                              |
| `addSceneToWorld(object)`                                           | Traverse and register objects with `userData.physics`                 |
| `getShape(object)`                                                  | Compute collider dimensions and `ColliderDesc`                        |
| `createPhysicsProperties(colliderDesc, position, rotation?, mass?)` | Create a rigid body + collider pair                                   |
| `createInstancedPhysicsProperties(mesh, colliderDesc, mass?)`       | Create one body per instance                                          |
| `getPhysicsPropertiesFromObject(object, index?)`                    | Retrieve stored physics properties                                    |
| `setObjectPosition(object, position, index?)`                       | Teleport a body and zero its velocities                               |
| `setObjectVelocity(object, velocity, index?)`                       | Set linear velocity                                                   |
| `step(timestep?, eventQueue?, hooks?)`                              | Advance simulation and sync transforms                                |
| `removePropsFromWorld(props)`                                       | Remove rigid bodies from the world                                    |
| `removeFromWorld(object)`                                           | Remove a registered object                                            |
| `dispose()`                                                         | Clear internal tracking maps                                          |

### Types

```ts
interface Object3DWithGeometry extends Object3D {
  geometry?: BufferGeometry;
  userData: Object3D["userData"] & { useBoundingBox?: boolean };
}

interface PhysicsProperties {
  rigidBodyDesc: Rapier.RigidBodyDesc;
  rigidBody: Rapier.RigidBody;
  colliderDesc: Rapier.ColliderDesc;
  collider: Rapier.Collider;
}
```

Types are re-exported from the package entry point:

```ts
import type { Object3DWithGeometry, PhysicsProperties } from "@nmnsl/three-rapier.js";
```

## Development

### Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) 10+

### Scripts

| Command          | Description                      |
| ---------------- | -------------------------------- |
| `pnpm dev`       | Build in watch mode              |
| `pnpm build`     | Typecheck and produce `dist/`    |
| `pnpm typecheck` | Run TypeScript compiler          |
| `pnpm release`   | Build and publish via Changesets |

### Project structure

```md
src/
  main.ts    # Physics class and RapierPhysics factory
  types.ts   # Shared TypeScript interfaces
```

Build output is published as ESM (`dist/main.js`), UMD (`dist/main.umd.cjs`), and declarations (`dist/src/main.d.ts`).

## Links

- [Rapier JavaScript API](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)
- [Repository](https://github.com/Neosoulink/nsl-three-rapier.js)
- [Issue tracker](https://github.com/Neosoulink/nsl-three-rapier.js/issues)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

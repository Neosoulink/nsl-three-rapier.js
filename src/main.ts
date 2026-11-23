import type Rapier from "@dimforge/rapier3d-compat";
import {
	EventQueue,
	PhysicsHooks,
	RigidBody,
	RigidBodyType,
} from "@dimforge/rapier3d-compat";

import {
	Box3,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	Mesh,
	Object3D,
	Quaternion,
	SphereGeometry,
	Vector3,
} from "three";
import { Object3DWithGeometry, PhysicsProperties } from "./types";

let RAPIER: typeof Rapier | null | undefined = null;

/**
 * @description Physics helper based on `Rapier`
 *
 * @initial_author {@link https://github.com/mrdoob Mrdoob}
 *
 * @see {@link https://rapier.rs/docs/api/javascript/JavaScript3D/ Rapier.js}
 * @see {@link https://github.com/mrdoob/three.js/blob/master/examples/jsm/physics/RapierPhysics.js Three.js RapierPhysics addon}
 */
export class Physics {
	private readonly _vector = new Vector3();
	private readonly _position = new Vector3();
	private readonly _quaternion = new Quaternion();
	private readonly _parentQuaternion = new Quaternion();
	private readonly _scale = new Vector3(1, 1, 1);
	private readonly _matrix = new Matrix4();

	/** @description `Rapier3D.js`. */
	public rapier: typeof Rapier;
	/** @description {@link Rapier.World} instance. */
	public world: Rapier.World;
	/** @description List of {@link Object3DWithGeometry} with applied physics. */
	public physicalObjects: Object3DWithGeometry[] = [];
	/** @description {@link WeakMap} of dynamic objects {@link Rapier.RigidBody} */
	public physical3DObjectsMap = new WeakMap<
		Object3DWithGeometry,
		PhysicsProperties | PhysicsProperties[]
	>();

	constructor(rapier: typeof Rapier) {
		this.rapier = rapier;

		const gravity = new this.rapier.Vector3(0.0, -9.81, 0.0);
		this.world = new this.rapier.World(gravity);
	}

	private _syncObjectTransformFromRigidBody(
		object: Object3D,
		worldPosition: Vector3,
		worldQuaternion: Quaternion,
	) {
		const parent = object.parent;

		if (parent) {
			parent.updateWorldMatrix(true, false);
			parent.worldToLocal(worldPosition);
			parent.getWorldQuaternion(this._parentQuaternion);
			object.position.copy(worldPosition);
			object.quaternion
				.copy(this._parentQuaternion.invert())
				.multiply(worldQuaternion);
			return;
		}

		object.position.copy(worldPosition);
		object.quaternion.copy(worldQuaternion);
	}

	/**
	 * @description Add the specified `object` to the physics `physicalObjects` map.
	 *
	 * @param object {@link Object3DWithGeometry} based.
	 * @param mass Physics object mass.
	 * @param restitution Physics Object restitution.
	 */
	private _addObject(object: Object3DWithGeometry, mass = 0, restitution = 0) {
		const { colliderDesc } = this.getShape(object);
		if (!colliderDesc) return;

		colliderDesc.setMass(mass);
		colliderDesc.setRestitution(restitution);

		object.updateWorldMatrix(true, false);
		object.getWorldPosition(this._position);
		object.getWorldQuaternion(this._quaternion);

		const physicsProperties =
			object instanceof InstancedMesh && !object.userData.useBoundingBox
				? this.createInstancedPhysicsProperties(object, colliderDesc, mass)
				: this.createPhysicsProperties(
						colliderDesc,
						this._position,
						this._quaternion,
						mass,
					);

		this.physicalObjects.push(object);
		object.userData = {
			...object.userData,
			dynamicObjectIndex: this.physicalObjects.length - 1,
			physicsProperties,
		};
		this.physical3DObjectsMap.set(object, physicsProperties);

		return physicsProperties;
	}

	/**
	 * @description Add an {@link Object3DWithGeometry} children to the physics world using `userData`.
	 *
	 * @param object {@link Object3DWithGeometry} based.
	 *
	 * @example ```ts
	 *  const floor = new Mesh(
	 *    new BoxGeometry(500, 5, 500),
	 *    new MeshBasicMaterial({})
	 *  );
	 *  floor.position.setY(-10);
	 *  floor.userData.physics = { mass: 0, restitution: restitution };
	 *
	 *  rapierPhysicsHelper?.addToWorld(floor, 0);
	 * ```
	 */
	public addSceneToWorld(object: Object3DWithGeometry) {
		object.traverse((child) => {
			if (!(child instanceof Object3D) || !child.userData.physics) return;

			const physics = child.userData.physics;

			this._addObject(child, physics.mass, physics.restitution);
		});
	}

	/**
	 * @description Apply physics to the specified object. Add the object to the physical `world`.
	 *
	 * @param object {@link Object3DWithGeometry} based.
	 * @param mass Physics mass.
	 * @param restitution Physics restitution.
	 */
	public addToWorld(object: Object3DWithGeometry, mass = 0, restitution = 0) {
		if (object instanceof Object3D)
			return this._addObject(object, Number(mass), Number(restitution));
		return undefined;
	}

	/**
	 * @description Retrieve the shape of the passed `object`.
	 *
	 * @param object `Object3D` based.
	 */
	public getShape(object: Object3DWithGeometry) {
		const positions = object?.geometry?.attributes?.position?.array;

		object.updateWorldMatrix(true, false);
		object.getWorldScale(this._scale);
		const scale = this._scale;

		let width = 0;
		let height = 0;
		let depth = 0;
		let halfWidth = 0;
		let halfHeight = 0;
		let halfDepth = 0;
		let radius = 0;
		let colliderDesc: Rapier.ColliderDesc;

		if (
			object instanceof Mesh &&
			(object.geometry instanceof SphereGeometry ||
				object.geometry instanceof IcosahedronGeometry) &&
			!object.userData.useBoundingBox
		) {
			const parameters = object.geometry.parameters;
			const geometryRadius = parameters.radius ?? 1;

			radius =
				geometryRadius *
				Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
			colliderDesc = this.rapier.ColliderDesc.ball(radius);
		} else if (positions && !object.userData.useBoundingBox) {
			let minX = Infinity;
			let minY = Infinity;
			let minZ = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			let maxZ = -Infinity;

			for (let i = 0; i < positions.length; i += 3) {
				const x = (positions[i] ?? 0) * scale.x;
				const y = (positions[i + 1] ?? 0) * scale.y;
				const z = (positions[i + 2] ?? 0) * scale.z;

				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				minZ = Math.min(minZ, z);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
				maxZ = Math.max(maxZ, z);
			}

			width = maxX - minX;
			height = maxY - minY;
			depth = maxZ - minZ;

			halfWidth = width * 0.5;
			halfHeight = height * 0.5;
			halfDepth = depth * 0.5;

			colliderDesc = this.rapier.ColliderDesc.cuboid(
				halfWidth,
				halfHeight,
				halfDepth,
			);
			colliderDesc.setTranslation(
				(minX + maxX) * 0.5,
				(minY + maxY) * 0.5,
				(minZ + maxZ) * 0.5,
			);
		} else {
			const boundingBox = new Box3().setFromObject(object);

			width = boundingBox.max.x - boundingBox.min.x;
			height = boundingBox.max.y - boundingBox.min.y;
			depth = boundingBox.max.z - boundingBox.min.z;

			halfWidth = width * 0.5;
			halfHeight = height * 0.5;
			halfDepth = depth * 0.5;

			colliderDesc = this.rapier.ColliderDesc.cuboid(
				halfWidth,
				halfHeight,
				halfDepth,
			);

			const colliderCenter = boundingBox.getCenter(this._vector);
			object.getWorldPosition(this._position);
			object.getWorldQuaternion(this._quaternion);
			colliderCenter
				.sub(this._position)
				.applyQuaternion(this._quaternion.clone().invert());
			colliderDesc.setTranslation(
				colliderCenter.x,
				colliderCenter.y,
				colliderCenter.z,
			);
		}

		return {
			width,
			height,
			depth,
			halfWidth,
			halfHeight,
			halfDepth,
			colliderDesc,
		};
	}

	/**
	 * @description Create a {@link Rapier.RigidBody} for each instance of the specified {@link InstancedMesh}
	 *
	 * @param mesh {@link InstancedMesh}
	 * @param colliderDesc {@link Rapier.ColliderDesc}
	 * @param mass
	 */
	public createInstancedPhysicsProperties(
		mesh: InstancedMesh,
		colliderDesc: Rapier.ColliderDesc,
		mass?: number,
	) {
		const matrixArray = mesh.instanceMatrix.array;
		const propsArray: PhysicsProperties[] = [];

		for (let i = 0; i < mesh.count; i++) {
			const position = this._vector.fromArray(matrixArray, i * 16 + 12);
			propsArray.push(
				this.createPhysicsProperties(colliderDesc, position, undefined, mass),
			);
		}

		return propsArray;
	}

	/**
	 * @description Create a {@link Rapier.RigidBody} for the specified {@link Rapier.Collider}
	 *
	 * @param colliderDesc {@link Rapier.ColliderDesc}
	 * @param position {@link Rapier.Vector3}
	 * @param rotation {@link Rapier.Rotation}
	 * @param mass
	 */
	public createPhysicsProperties(
		colliderDesc: Rapier.ColliderDesc,
		position: Rapier.Vector3,
		rotation?: Rapier.Rotation,
		mass = 0,
	) {
		const rigidBodyDesc =
			mass > 0
				? this.rapier.RigidBodyDesc.dynamic()
				: this.rapier.RigidBodyDesc.fixed();
		rigidBodyDesc.setTranslation(position.x, position.y, position.z);
		if (rotation) rigidBodyDesc.setRotation(rotation);

		const rigidBody = this.world.createRigidBody(rigidBodyDesc);
		const collider = this.world.createCollider(colliderDesc, rigidBody);

		const result: PhysicsProperties = {
			rigidBodyDesc,
			rigidBody,
			colliderDesc,
			collider,
		};

		return result;
	}

	/**
	 * @param object
	 * @param index
	 */
	public getPhysicsPropertiesFromObject(
		object: Object3DWithGeometry,
		index = 0,
	) {
		const _physicsProperties = this.physical3DObjectsMap.get(object);
		let body: PhysicsProperties | undefined;

		if (!_physicsProperties) return undefined;
		if (
			!object.userData.useBoundingBox &&
			object instanceof InstancedMesh &&
			typeof _physicsProperties === "object"
		)
			body = (_physicsProperties as PhysicsProperties[])[index];
		else body = _physicsProperties as PhysicsProperties;

		return body;
	}

	/**
	 *
	 * @param object
	 * @param position
	 * @param index
	 */
	public setObjectPosition(
		object: Object3DWithGeometry,
		position: Rapier.Vector3,
		index = 0,
	) {
		/** @description Object physics properties (rigid body, collider, ...). */
		const physicsProperties = this.getPhysicsPropertiesFromObject(
			object,
			index,
		);
		if (!physicsProperties) return;

		const _vectorZero = new this.rapier.Vector3(0, 0, 0);
		physicsProperties.rigidBody.setAngvel(_vectorZero, true);
		physicsProperties.rigidBody.setLinvel(_vectorZero, true);
		physicsProperties.rigidBody.setTranslation(position, true);

		return physicsProperties;
	}

	/**
	 * @description ---
	 *
	 * @param object
	 * @param velocity
	 * @param index
	 */
	public setObjectVelocity(
		object: Object3DWithGeometry,
		velocity: Rapier.Vector3,
		index = 0,
	) {
		const physicsProperties = this.getPhysicsPropertiesFromObject(
			object,
			index,
		);
		if (!physicsProperties) return;

		physicsProperties.rigidBody.setLinvel(velocity, true);

		return physicsProperties;
	}

	/**
	 * @description Update the physics world.
	 *
	 * @param timestep The timestep length, in seconds.
	 */
	public step(
		timestep?: number,
		eventQueue?: EventQueue,
		hooks?: PhysicsHooks,
	) {
		if (typeof timestep === "number") this.world.timestep = timestep;
		this.world.step(eventQueue, hooks);

		for (let i = 0; i < this.physicalObjects.length; i++) {
			const object = this.physicalObjects[i];
			if (!object || object.userData.ignorePhysics) continue;

			if (!object?.userData.useBoundingBox && object instanceof InstancedMesh) {
				const array = object.instanceMatrix.array;
				const propsArray = this.physical3DObjectsMap.get(object) as
					| PhysicsProperties[]
					| undefined;

				if (!propsArray) return;

				for (let j = 0; j < propsArray.length; j++) {
					const props = propsArray[j];
					if (props && props.rigidBody.bodyType() !== RigidBodyType.Fixed) {
						let position = this._position;
						let quaternion = this._quaternion;
						let scale = this._scale;

						object.getMatrixAt(j, this._matrix);
						this._matrix.decompose(position, quaternion, scale);

						position = this._position.copy(props.rigidBody.translation());
						quaternion = this._quaternion.copy(props.rigidBody.rotation());
						scale = this._scale.copy(scale);

						this._matrix
							.compose(position, quaternion, scale)
							.toArray(array, j * 16);
					}
				}

				object.instanceMatrix.needsUpdate = true;
				object.geometry.computeBoundingBox();
				object.geometry.computeBoundingSphere();
				object.computeBoundingBox();
				object.computeBoundingSphere();

				continue;
			}

			const props = this.physical3DObjectsMap.get(object);

			if (
				!props ||
				Array.isArray(props) ||
				props.rigidBody.bodyType() === RigidBodyType.Fixed
			)
				continue;

			this._position.copy(props.rigidBody.translation());
			this._quaternion.copy(props.rigidBody.rotation());
			this._syncObjectTransformFromRigidBody(
				object,
				this._position,
				this._quaternion,
			);
		}
	}

	/**
	 * @description Remove the specified `PhysicsProps` from the physics `world`.
	 *
	 * @param props {@link PhysicsProperties} or `PhysicsProperties[]`.
	 */
	public removePropsFromWorld(props?: PhysicsProperties | PhysicsProperties[]) {
		if (Array.isArray(props))
			return (props as PhysicsProperties[]).forEach((_props) =>
				this.removePropsFromWorld(_props),
			);

		if (props?.rigidBody instanceof RigidBody)
			this.world.removeRigidBody((props as PhysicsProperties).rigidBody);
	}

	/**
	 * @description Remove the specified object from the physics `world`.
	 *
	 * @param object {@link Object3DWithGeometry}.
	 */
	public removeFromWorld(object: Object3DWithGeometry) {
		for (let i = 0; i < this.physicalObjects.length; i++) {
			const physicalObject = this.physicalObjects[i];

			if (physicalObject) {
				const physicsProps = this.physical3DObjectsMap.get(physicalObject);

				if (physicalObject.id === object.id && physicsProps) {
					this.removePropsFromWorld(physicsProps);
					this.physical3DObjectsMap.delete(physicalObject);
					this.physicalObjects.splice(i, 1);
					return;
				}
			}
		}
	}

	/** @description remove all the stored physical objects. */
	public dispose() {
		this.physicalObjects = [];
		this.physical3DObjectsMap = new WeakMap();
	}
}

export async function RapierPhysics() {
	if (!RAPIER)
		await (RAPIER = await import("@dimforge/rapier3d-compat")).init();

	return new Physics(RAPIER);
}

export type * from "./types";

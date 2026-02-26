import type { Mesh } from "@babylonjs/core";

export interface OrbitalBody {
  mesh: Mesh;
  orbitRadius: number;
  orbitSpeed: number;         // radians per second
  currentAngle: number;       // current orbital angle in radians
  axialRotationSpeed: number; // radians per second
}

/**
 * OrbitSystem
 * Updates planet positions and rotations each frame.
 * No physics engine — pure trigonometric orbits.
 */
export class OrbitSystem {
  private bodies: OrbitalBody[] = [];

  addBody(body: OrbitalBody): void {
    this.bodies.push(body);
  }

  /** Call once per frame with delta time in seconds. */
  update(deltaTime: number): void {
    for (const body of this.bodies) {
      // Advance orbit angle
      body.currentAngle += body.orbitSpeed * deltaTime;

      // Update world position (XZ plane orbit, Y=0)
      body.mesh.position.x = Math.cos(body.currentAngle) * body.orbitRadius;
      body.mesh.position.z = Math.sin(body.currentAngle) * body.orbitRadius;
      body.mesh.position.y = 0;

      // Axial rotation
      body.mesh.rotation.y += body.axialRotationSpeed * deltaTime;
    }
  }

  dispose(): void {
    this.bodies.length = 0;
  }
}

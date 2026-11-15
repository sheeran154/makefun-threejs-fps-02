// Player movement for DUSTLINE: acceleration-based WASD, friction when no input,
// gravity and jump, crouch that lowers the eye and the collision box. Collision is
// resolved one axis at a time against the world's AABBs, so a wall stops the player
// instead of swallowing them. No allocations inside step(): the probe box and the
// wish vector are created once.
const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const GRAVITY = 21;
const JUMP_SPEED = 6.4;
const LOOK_LIMIT = 1.45;

export function createPlayer(colliders, start) {
  const body = {
    x: start.x,
    y: 0,
    z: start.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: start.yaw,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    crouching: false,
    onGround: true,
  };
  // Reused scratch objects: step() never allocates.
  const probeMin = { x: 0, y: 0, z: 0 };
  const probeMax = { x: 0, y: 0, z: 0 };
  const wish = { x: 0, z: 0 };

  function overlaps(x, y, z, height, lift) {
    probeMin.x = x - RADIUS;
    probeMin.y = y + lift;
    probeMin.z = z - RADIUS;
    probeMax.x = x + RADIUS;
    probeMax.y = y + height - lift;
    probeMax.z = z + RADIUS;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (probeMin.x < c.max.x && probeMax.x > c.min.x
        && probeMin.y < c.max.y && probeMax.y > c.min.y
        && probeMin.z < c.max.z && probeMax.z > c.min.z) return c;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(LOOK_LIMIT, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && body.crouching
      && !overlaps(body.x, body.y, body.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.x = 0;
    wish.z = 0;
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.x = -sin * forward + cos * strafe;
      wish.z = -cos * forward - sin * strafe;
      const len = Math.hypot(wish.x, wish.z) || 1;
      wish.x /= len;
      wish.z /= len;
    }

    const speed = body.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.vx += (wish.x * speed - body.vx) * blend;
    body.vz += (wish.z * speed - body.vz) * blend;
    if (body.onGround && wish.x === 0 && wish.z === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.vx *= damp;
      body.vz *= damp;
    }

    if (keys.has('Space') && body.onGround) {
      body.vy = JUMP_SPEED;
      body.onGround = false;
    }
    body.vy -= GRAVITY * dt;

    const nextX = body.x + body.vx * dt;
    if (!overlaps(nextX, body.y, body.z, body.height, 0.04)) body.x = nextX;
    else body.vx = 0;
    const nextZ = body.z + body.vz * dt;
    if (!overlaps(body.x, body.y, nextZ, body.height, 0.04)) body.z = nextZ;
    else body.vz = 0;

    body.y += body.vy * dt;
    body.onGround = false;
    const hit = overlaps(body.x, body.y, body.z, body.height, 0);
    if (hit && body.vy <= 0) {
      body.y = hit.max.y;
      body.vy = 0;
      body.onGround = true;
    } else if (hit) {
      body.y = hit.min.y - body.height;
      body.vy = 0;
    }
    if (body.y < 0) {
      body.y = 0;
      body.vy = 0;
      body.onGround = true;
    }
    body.vy = Math.max(-30, body.vy);
  }

  function reset(startAt) {
    body.x = startAt.x;
    body.y = 0;
    body.z = startAt.z;
    body.vx = 0;
    body.vy = 0;
    body.vz = 0;
    body.yaw = startAt.yaw;
    body.pitch = 0;
    body.eye = STAND_EYE;
    body.height = STAND_HEIGHT;
    body.crouching = false;
    body.onGround = true;
  }

  return {
    state: body,
    step,
    look,
    recoil,
    reset,
    groundSpeed() {
      return Math.hypot(body.vx, body.vz);
    },
  };
}

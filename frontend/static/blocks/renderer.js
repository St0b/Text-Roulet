import {BLOCK, HEIGHT, SIZE, MATERIALS, EYE_HEIGHT, direction, isWheat, noise} from './world.js';
import {LIGHT_RADIUS, blockLights, lightAt, skyLight} from './lighting.js';

const CHUNK = 16;
const TILE = 16;
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 8;
const SKY_HORIZON = [.70, .81, .80];
const NIGHT_HORIZON = [.07, .11, .19];
const TRIANGLES = [0, 1, 2, 0, 2, 3];
const UV = [[0, 0], [0, 1], [1, 1], [1, 0]];
const FACES = [
  {normal: [1, 0, 0], shade: .84, points: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]]},
  {normal: [-1, 0, 0], shade: .68, points: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]]},
  {normal: [0, 1, 0], shade: 1, points: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]]},
  {normal: [0, -1, 0], shade: .58, points: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
  {normal: [0, 0, 1], shade: .79, points: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]]},
  {normal: [0, 0, -1], shade: .73, points: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]]},
];

function createAtlas(gl) {
  const width = TILE * ATLAS_COLUMNS, height = TILE * ATLAS_ROWS;
  const data = new Uint8Array(width * height * 4);
  const colors = [
    [127, 167, 75], [133, 99, 66], [142, 105, 73], [146, 151, 143], [221, 196, 141],
    [116, 80, 54], [181, 139, 88], [69, 129, 72], [193, 149, 93], [172, 103, 79],
    [76, 146, 166], [67, 72, 74], [226, 239, 231], [135, 140, 135],
    [151, 105, 65], [195, 146, 89], [116, 122, 116], [230, 184, 86], [108, 197, 185], [139, 145, 139],
    [155, 98, 53], [219, 141, 148], [225, 151, 161], [105, 137, 79], [104, 138, 81],
    [48, 123, 118], [61, 73, 112], [176, 128, 65],
    [119, 81, 55], [116, 152, 68], [202, 159, 79],
  ];
  for (let tile = 0; tile < colors.length; tile++) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const grain = noise(x, y, tile + 20);
        let shade = (grain - .5) * 26;
        let color = colors[tile];
        if (tile === 0) shade += 8 * (noise(x >> 1, y >> 1, 41) - .5);
        if (tile === 1 && y >= 12 - Math.floor(noise(x, 1, 8) * 3)) color = colors[0];
        if (tile === 3) shade += grain > .91 ? -14 : 4 * Math.sin((x + y) / 3);
        if (tile === 5) shade += (noise(x, 0, 30) - .5) * 32;
        if (tile === 6) shade += Math.floor(Math.hypot(x - 7.5, y - 7.5) / 1.7) % 2 ? -14 : 7;
        if (tile === 7) shade += (noise(x >> 1, y >> 1, 88) - .5) * 20;
        if (tile === 8) shade += y % 4 === 0 ? -32 : (noise(x >> 2, y, 24) - .5) * 12;
        if (tile === 9 && (y % 4 === 0 || (x + (y >> 2) * 4) % 8 === 0)) color = [199, 181, 151];
        if (tile === 10) shade = (Math.sin(x / 2 + y * .9) + Math.sin(x / 3 - y / 3)) * 5 + grain * 7;
        if (tile === 12) shade = 0;
        if (tile === 13 && noise(x >> 1, y >> 1, 71) > .69) color = [177, 125, 97];
        if (tile === 14 && (y > 12 || x === 2 || x === 13)) shade -= 35;
        if (tile === 15 && (x % 4 === 0 || y % 4 === 0)) shade -= 33;
        if (tile === 16) {
          if (x >= 3 && x <= 12 && y >= 3 && y <= 9) color = [57, 49, 45];
          if (x >= 5 && x <= 10 && y >= 4 && y <= 6) color = [213, 128, 67];
        }
        if (tile === 17 && (x < 3 || x > 12 || y < 3 || y > 12)) color = [118, 83, 49];
        if (tile === 18 && (x < 3 || x > 12 || y < 3 || y > 12)) color = [50, 84, 83];
        if (tile === 19 && noise(x >> 1, y >> 1, 99) > .62) color = [44, 49, 47];
        if (tile === 20 && y > 10) color = y > 12 ? [255, 224, 119] : [228, 151, 54];
        if (tile === 22) {
          if ((x >= 2 && x <= 4 || x >= 11 && x <= 13) && y >= 9 && y <= 11) color = [47, 34, 40];
          if (x >= 4 && x <= 11 && y >= 2 && y <= 6) color = [192, 109, 125];
          if ((x === 6 || x === 9) && y === 4) color = [109, 58, 70];
        }
        if (tile === 23 && (y === 8 && (x >= 2 && x <= 5 || x >= 10 && x <= 13)
          || y >= 2 && y <= 4 && x >= 5 && x <= 10)) color = [40, 53, 33];
        if (tile === 27 && (y === 6 || x === 0 || x === 15)) shade -= 38;
        if (tile === 27 && x >= 6 && x <= 9 && y >= 5 && y <= 9) color = [230, 197, 117];
        if (tile === 28 && x % 4 === 0) shade -= 31;
        if ((tile === 29 || tile === 30) && y > 10) shade += 24;
        const px = tile % ATLAS_COLUMNS * TILE + x;
        const py = Math.floor(tile / ATLAS_COLUMNS) * TILE + y;
        const offset = (py * width + px) * 4;
        for (let channel = 0; channel < 3; channel++) {
          data[offset + channel] = Math.max(0, Math.min(255, color[channel] + shade));
        }
        data[offset + 3] = 255;
      }
    }
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function buildProgram(gl) {
  const vertexSource = `#version 300 es
    layout(location=0) in vec3 position;
    layout(location=1) in vec2 uv;
    layout(location=2) in float shade;
    uniform mat4 projection;
    uniform mat4 view;
    uniform vec3 offset;
    uniform vec2 turn;
    out vec2 textureUV;
    out float light;
    out float depth;
    void main() {
      vec3 rotated = vec3(position.x * turn.x - position.z * turn.y, position.y,
        position.x * turn.y + position.z * turn.x);
      vec4 camera = view * vec4(rotated + offset, 1.0);
      gl_Position = projection * camera;
      depth = -camera.z;
      textureUV = uv;
      light = shade;
    }`;
  const fragmentSource = `#version 300 es
    precision mediump float;
    in vec2 textureUV;
    in float light;
    in float depth;
    uniform sampler2D atlas;
    uniform vec3 horizon;
    uniform float daylight;
    uniform float lamp;
    uniform bool hurt;
    uniform bool outline;
    out vec4 color;
    void main() {
      if (outline) {
        color = vec4(.13, .22, .18, 1.0);
      } else {
        float glow = max(floor(light / 2.0) / 12.0, lamp);
        vec3 block = texture(atlas, textureUV).rgb * mod(light, 2.0) * max(daylight, glow);
        if (hurt) block = mix(block, vec3(.85, .23, .20), .35);
        color = vec4(mix(block, horizon, smoothstep(30.0, 84.0, depth) * .92), 1.0);
      }
    }`;

  const program = gl.createProgram();
  const shaders = [];
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

function appendFace(vertices, face, x, y, z, tile, shade, height = 1, width = 1, length = 1) {
  const tileX = tile % ATLAS_COLUMNS;
  const tileY = Math.floor(tile / ATLAS_COLUMNS);
  for (const corner of TRIANGLES) {
    const [px, py, pz] = face.points[corner];
    const [u, v] = UV[corner];
    vertices.push(x + px * width, y + py * height, z + pz * length,
      (tileX * TILE + .1 + u * (TILE - .2)) / (ATLAS_COLUMNS * TILE),
      (tileY * TILE + .1 + v * (TILE - .2)) / (ATLAS_ROWS * TILE), shade);
  }
}

function appendBox(vertices, x, y, z, width, height, length, tile, glow = 0, front = tile) {
  for (const face of FACES) {
    appendFace(vertices, face, x, y, z, face.normal[2] === -1 ? front : tile, face.shade + glow * 2,
      height, width, length);
  }
}

function entityMeshes() {
  const pig = [], zombie = [], cache = [];
  appendBox(pig, -.36, .25, -.41, .72, .45, .88, 21);
  appendBox(pig, -.27, .35, -.68, .54, .51, .32, 21, 0, 22);
  for (const x of [-.31, .15]) {
    for (const z of [-.32, .28]) appendBox(pig, x, 0, z, .16, .32, .17, 21);
  }
  appendBox(zombie, -.27, 1.3, -.26, .54, .55, .52, 24, 0, 23);
  appendBox(zombie, -.27, .63, -.16, .54, .67, .32, 25);
  for (const x of [-.47, .27]) appendBox(zombie, x, 1.02, -.60, .20, .20, .56, 24);
  for (const x of [-.26, .02]) appendBox(zombie, x, 0, -.15, .23, .63, .30, 26);
  appendBox(cache, -.28, .02, -.22, .56, .40, .44, 27, 7);
  return {pig: new Float32Array(pig), zombie: new Float32Array(zombie), cache: new Float32Array(cache)};
}

function buildChunk(world, startX, startZ, levels) {
  const vertices = [];
  for (let z = startZ; z < startZ + CHUNK; z++) {
    for (let x = startX; x < startX + CHUNK; x++) {
      const tone = .94 + .06 * noise(x, z, world.seed);
      for (let y = 0; y < HEIGHT; y++) {
        const block = world.get(x, y, z);
        if (block === BLOCK.air) continue;
        if (block === BLOCK.torch) {
          appendBox(vertices, x + .43, y, z + .43, .14, .63, .14, 20, LIGHT_RADIUS);
          continue;
        }
        if (isWheat(block)) {
          const height = [.25, .47, .73][block - BLOCK.wheatSeedling];
          const glow = Math.round(lightAt(levels, x, y, z) * LIGHT_RADIUS);
          for (const [dx, dz, scale] of [[.23, .26, .81], [.6, .3, 1], [.42, .63, .9], [.69, .67, .77]]) {
            appendBox(vertices, x + dx, y, z + dz, .10, height * scale, .10, MATERIALS[block].faces[0], glow);
          }
          continue;
        }
        const height = block === BLOCK.water && world.get(x, y + 1, z) === BLOCK.air ? .9 : 1;
        for (const face of FACES) {
          const [dx, dy, dz] = face.normal;
          if (y === 0 && dy === -1) continue;
          const neighbor = world.get(x + dx, y + dy, z + dz);
          if (neighbor !== BLOCK.air && neighbor !== BLOCK.torch && !isWheat(neighbor)
            && !(neighbor === BLOCK.water && block !== BLOCK.water)) continue;
          const tile = MATERIALS[block].faces[dy === 1 ? 1 : dy === -1 ? 2 : 0];
          const glow = block === BLOCK.lantern || block === BLOCK.beacon ? LIGHT_RADIUS
            : Math.round(lightAt(levels, x + dx, y + dy, z + dz) * LIGHT_RADIUS);
          appendFace(vertices, face, x, y, z, tile, face.shade * tone + glow * 2, height);
        }
      }
    }
  }
  return new Float32Array(vertices);
}

function cloudMesh() {
  const vertices = [];
  for (const [x, y, z, width, depth] of [[37,28,17,12,4], [19,27,37,8,4], [59,29,28,12,5], [52,27,53,8,3], [7,29,13,8,3]]) {
    for (let dz = 0; dz < depth; dz++) {
      for (let dx = 0; dx < width; dx++) {
        if ((dx < 2 || dx > width - 3) && dz === 0) continue;
        appendFace(vertices, FACES[2], x + dx, y, z + dz, 12, 1);
        appendFace(vertices, FACES[3], x + dx, y, z + dz, 12, .9);
      }
    }
  }
  return new Float32Array(vertices);
}

function outlineMesh() {
  const vertices = [];
  const low = -.002, high = 1.002;
  for (const a of [low, high]) {
    for (const b of [low, high]) {
      vertices.push(low, a, b, high, a, b, a, low, b, a, high, b, a, b, low, a, b, high);
    }
  }
  return new Float32Array(vertices);
}

function projectionMatrix(aspect) {
  const f = 1 / Math.tan(Math.PI / 5.3);
  const near = .07, far = 110;
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0]);
}

function viewMatrix(player) {
  const [fx, fy, fz] = direction(player.yaw, player.pitch);
  const rx = Math.cos(player.yaw), rz = Math.sin(player.yaw);
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const {x, z} = player, y = player.y + EYE_HEIGHT;
  return new Float32Array([
    rx, ux, -fx, 0, 0, uy, -fy, 0, rz, uz, -fz, 0,
    -(rx * x + rz * z), -(ux * x + uy * y + uz * z), fx * x + fy * y + fz * z, 1,
  ]);
}

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.gl = canvas.getContext('webgl2', {alpha: true, antialias: false});
    if (!this.gl) throw new Error('Для GreenBlocks нужен WebGL 2.');
    const gl = this.gl;
    this.program = buildProgram(gl);
    this.texture = createAtlas(gl);
    this.locations = Object.fromEntries(['projection', 'view', 'offset', 'turn', 'atlas', 'horizon', 'outline',
      'daylight', 'lamp', 'hurt']
      .map(name => [name, gl.getUniformLocation(this.program, name)]));
    this.chunks = new Map();
    this.clouds = this.makeMesh(cloudMesh());
    this.entities = Object.fromEntries(Object.entries(entityMeshes()).map(([name, mesh]) => [name, this.makeMesh(mesh)]));
    const outline = outlineMesh();
    this.outline = {buffer: gl.createBuffer(), count: outline.length / 3};
    gl.bindBuffer(gl.ARRAY_BUFFER, this.outline.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, outline, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    this.rebuild();
  }

  makeMesh(vertices, buffer = this.gl.createBuffer()) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    return {buffer, count: vertices.length / 6};
  }

  updateChunk(cx, cz) {
    const startX = cx * CHUNK, startZ = cz * CHUNK;
    if (startX < 0 || startX >= SIZE || startZ < 0 || startZ >= SIZE) return;
    const key = `${cx},${cz}`;
    this.chunks.set(key, this.makeMesh(buildChunk(this.world, startX, startZ, this.levels), this.chunks.get(key)?.buffer));
  }

  rebuild(world = this.world) {
    this.world = world;
    this.levels = blockLights(world);
    for (let z = 0; z < SIZE / CHUNK; z++) {
      for (let x = 0; x < SIZE / CHUNK; x++) this.updateChunk(x, z);
    }
  }

  updatePlants(cells) {
    const chunks = new Set(cells.map(([x, , z]) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`));
    for (const chunk of chunks) this.updateChunk(...chunk.split(',').map(Number));
  }

  updateBlock(x, y, z) {
    const previous = this.levels;
    this.levels = blockLights(this.world);
    if ([previous, this.levels].some(levels => FACES.some(({normal: [dx, dy, dz]}) =>
      lightAt(levels, x + dx, y + dy, z + dz) > 0))) {
      for (let cz = Math.floor((z - LIGHT_RADIUS) / CHUNK); cz <= Math.floor((z + LIGHT_RADIUS) / CHUNK); cz++) {
        for (let cx = Math.floor((x - LIGHT_RADIUS) / CHUNK); cx <= Math.floor((x + LIGHT_RADIUS) / CHUNK); cx++) this.updateChunk(cx, cz);
      }
      return;
    }
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    this.updateChunk(cx, cz);
    if (x % CHUNK === 0) this.updateChunk(cx - 1, cz);
    if (x % CHUNK === CHUNK - 1) this.updateChunk(cx + 1, cz);
    if (z % CHUNK === 0) this.updateChunk(cx, cz - 1);
    if (z % CHUNK === CHUNK - 1) this.updateChunk(cx, cz + 1);
  }

  resize() {
    const {canvas, gl} = this;
    if (!canvas.clientWidth || !canvas.clientHeight) return false;
    const scale = Math.min(devicePixelRatio, 1.5, 1600 / canvas.clientWidth);
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height || !this.projection) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      this.projection = projectionMatrix(width / height);
    }
    return true;
  }

  drawMesh(mesh) {
    const gl = this.gl;
    if (!mesh.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  draw(player, target = null, survival = null) {
    const gl = this.gl, locations = this.locations;
    if (gl.isContextLost() || !this.resize()) return;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(locations.atlas, 0);
    const daylight = survival ? skyLight(survival.phase) : 1;
    const skyMix = (daylight - .27) / .73;
    gl.uniform3fv(locations.horizon, SKY_HORIZON.map((channel, index) =>
      NIGHT_HORIZON[index] * (1 - skyMix) + channel * skyMix));
    gl.uniform1f(locations.daylight, daylight);
    gl.uniform1f(locations.lamp, 0);
    gl.uniform1i(locations.hurt, 0);
    gl.uniformMatrix4fv(locations.projection, false, this.projection);
    gl.uniformMatrix4fv(locations.view, false, viewMatrix(player));
    gl.uniform3f(locations.offset, 0, 0, 0);
    gl.uniform2f(locations.turn, 1, 0);
    gl.uniform1i(locations.outline, 0);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    for (const chunk of this.chunks.values()) this.drawMesh(chunk);
    this.drawMesh(this.clouds);
    if (survival) {
      const drawEntity = (entity, mesh) => {
        const yaw = entity.yaw ?? 0;
        gl.uniform2f(locations.turn, Math.cos(yaw), Math.sin(yaw));
        gl.uniform3f(locations.offset, entity.x, entity.y, entity.z);
        gl.uniform1f(locations.lamp, lightAt(this.levels, Math.floor(entity.x), Math.floor(entity.y + .3), Math.floor(entity.z)));
        gl.uniform1i(locations.hurt, entity.hurt > 0);
        this.drawMesh(mesh);
      };
      for (const mob of survival.mobs) drawEntity(mob, this.entities[mob.kind]);
      for (const cache of survival.caches) drawEntity(cache, this.entities.cache);
    }
    if (target) {
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.uniform3fv(locations.offset, target.cell);
      gl.uniform2f(locations.turn, 1, 0);
      gl.uniform1i(locations.outline, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.outline.buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, this.outline.count);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const mesh of [...this.chunks.values(), ...Object.values(this.entities), this.clouds, this.outline]) gl.deleteBuffer(mesh.buffer);
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.texture);
  }
}

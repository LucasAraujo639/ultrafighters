// MAPEO POR FRAMES del personaje ensamblado (Agent).
// Cada valor es un array de números de frame (1..56) de
// superfighters/sprites/DefineSprite_1245_player_agent/.
// Mirá sprite-viewer.html para ver qué pose tiene cada frame y ajustá los números.
//
// Helper para escribir rangos: sfRange(1, 5) => [1,2,3,4,5]
window.sfRange = function (from, to) {
  const out = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
};

window.PLAYER_SPRITE_MAP = {
  idle: [1, 2, 3, 4],            // TODO: ajustar con sprite-viewer.html
  walk: [5, 6, 7, 8],            // TODO
  run: [9, 10, 11, 12],          // TODO
  crouch: [13, 14],              // TODO
  jump: [15, 16],                // TODO
  fall: [17, 18, 19],            // TODO
  attack: [20, 21, 22, 23],      // TODO
  kick: [24, 25],                // TODO
  kickWithJump: [26, 27],        // TODO
  roll: [28, 29, 30],            // TODO
  dive: [31, 32],                // TODO
  knockedDown: [33, 34, 35],     // TODO
  SoftLanding: [36, 37]          // TODO
};

// Ajuste fino opcional de tamaño del sprite (1 = collider height):
// window.PLAYER_SPRITE_SCALE = 1.2;

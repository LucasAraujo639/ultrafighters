// Ejemplo de mapeo. Copialo/ajustalo y cargalo ANTES de src/game.js en index.html:
//   <script src="sprite-map.example.js"></script>
//   <script src="src/game.js"></script>
// Reemplaza los números por los que correspondan según sprite-viewer.html.


window.PLAYER_SPRITE_MAP = {
  idle: 592,                              // Parado / Reposo
  walk: [599,596, 600],                  // Animación de caminar
  run: [616,596, 617],              // Animación de correr
  crouch: 613,                            // Agachado
  jump: 597,                       // Salto: una sola celda (597.svg) durante todo el salto
  fall: [602,603],                       // Caída / Descenso (la celda 606 es la pose de rodamiento por impacto: NO va en el salto normal)
  attack: [627,628,630,631,633,634], // Golpes y puñetazos de combate
  attackLinks: [[627,628,630], [631,633], [634]], // Clips por golpe: PUNCH_01 (remata en 628), PUNCH_02 (remata en 633), PUNCH_03 (remata en 634)
  gethit: [718, 720],                    // Recibe un golpe (se encoge / retrocede la cabeza)
  launched: [724, 725, 726],             // Lanzado por el combo completo o una patada (vuelo ragdoll, 3 poses)
  climb: [709, 710, 711],                // Subir escalera (loop)
  climbUp: [709, 710, 711],              // Subir escalera (loop) - alias
  climbDown: 713,                        // Bajar escalera
  kick: 622,                              // Patada
  throwGrenade: 699,                      // Lanzamiento de granada: lean compartido (remata rápido en 705)
  throwMolotov: 699,                      // Lanzamiento de molotov: mismo lean compartido; el 703 es la postura de apuntado y el 705 el remate
  meleeAttackLinks: {
    // Clips de swing por arma (3 enlaces, mismo ritmo que PUNCH_0X),
    // solo celdas de cuerpo. El efecto cortante (axe 750/753/756 rojo,
    // machete 759/762/765, sword 768/771/774) es una particula aparte que
    // game.js dispara EN el frame del golpe, anclada al AABB del peleador
    // y espejada segun la direccion CAPTURADA al golpear (particula
    // MeleeStrike del original, TRACE_*_01/02/03).
    axe: [[644, 645], [648], [651]],
    sword: [[653, 654], [657], [660]],
    machete: [[636, 637], [639], [642]]
  },
  kickWithJump: 722,
  roll: [619,620],                              // Rodar / Esquivar
  knockbackRoll: 606,                    // Rodamiento por impacto (rebote brutal contra pared / caida)
  dive: 624,                              // Buceo / Tirarse al suelo
  knockedDown: [609,610],                 // Knockout / Derribado
  SoftLanding: 611
};

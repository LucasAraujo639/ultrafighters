// Ejemplo de mapeo. Copialo/ajustalo y cargalo ANTES de src/game.js en index.html:
//   <script src="sprite-map.example.js"></script>
//   <script src="src/game.js"></script>
// Reemplaza los números por los que correspondan según sprite-viewer.html.


window.PLAYER_SPRITE_MAP = {
  idle: 592,                              // Parado / Reposo
  walk: [599,596, 600],                  // Animación de caminar
  run: [616,596, 617],              // Animación de correr
  crouch: 613,                            // Agachado
  jump: 597,                       // Salto
  fall: [602,603,606],                       // Caída / Descenso
  attack: [627,628,630,631,633,634], // Golpes y puñetazos de combate
  kick: 622,                              // Patada
  kickWithJump: 722,
  roll: [619,620],                              // Rodar / Esquivar
  dive: 624,                              // Buceo / Tirarse al suelo
  knockedDown: [609,610],                 // Knockout / Derribado
  SoftLanding: 611
};

# Sonidos del juego (`superfighters/sounds/`)

Código: `src/audio-manager.js` (catálogo + pools de voces) y los disparadores `playSfx(SFX.X)` en `src/game.js`.
Tests: `tests/audio-manager.test.js`.

## Sonidos usados

| Acción / objeto | Evento | Archivo(s) .mp3 |
|---|---|---|
| Pistola – sacar / disparo | PISTOL_AIM / PISTOL_FIRE | 2511_aim_small / 2530_gun00, 2531_gun01, 2532_gun02, 2533_gun03 |
| Rifle – sacar / ráfaga | RIFLE_AIM / RIFLE_FIRE | 2544_rifle_draw / 2545_rifle00, 2546_rifle01 |
| Metralleta (Uzi) – sacar / ráfaga (1 por bala) | UZI_AIM / UZI_FIRE | 2511_aim_small / 2557_uzi00, 2558_uzi01 |
| Magnum | MAGNUM_AIM / MAGNUM_FIRE | 2511_aim_small / 2536_magnum |
| Shotgun – sacar / disparo / corredera (2 tiempos) | SHOTGUN_AIM / SHOTGUN_FIRE / SHOTGUN_PUMP_* | 2568_shotgun_aim / 2552_shotgun00, 2553_shotgun01, 2554_shotgun02 / 2550_shotgun_pump_p1, 2551_shotgun_pump_p2 |
| Sniper – sacar / disparo | SNIPER_AIM / SNIPER_FIRE | 2544_rifle_draw / 2555_sniper00, 2556_sniper01 |
| Bazooka – sacar / disparo | BAZOOKA_AIM / BAZOOKA_FIRE | 2560_bazooka_aim / 2512_bazooka |
| Lanzallamas – sacar / ráfaga (1 siseo por ráfaga de 8 chorros, pausa entre ráfagas) | FLAMETHROWER_AIM / FLAMETHROWER_FIRE | 2560_bazooka_aim / 2525_fireplosion |
| Arma vacía (click al tirarla) | NO_AMMO_LIGHT / NO_AMMO_HEAVY | 2538_outofammo_light / 2537_outofammo_heavy |
| Bala contra carne / metal / madera / pared | BULLET_HIT_* | 2503–2505_bullet_hit_* / 2561–2565_bullet_hitmetal_* / 2559_wood_impact00 / 2543_ric00 |
| Granada – sacar el seguro | GRENADE_PIN | 2566_grenade_safe |
| Granada – lanzamiento | GRENADE_THROW | 2569_svisch4, 2570_svisch6 |
| Granada – patada (suelo y aire) | GRENADE_KICK (+ KICK_SWING) | 2562_bullet_hitmetal_02, 2564_bullet_hitmetal_04 + svisch |
| Granada – detonación | GRENADE_EXPLOSION | 2521–2524_explosion00–03 |
| Barril / cohete / orbe — explosión | EXPLOSION | 2521–2524_explosion00–03 |
| Molotov – encendido (apuntar) | MOLOTOV_IGNITE | 2560_bazooka_aim |
| Molotov – lanzamiento | MOLOTOV_THROW | 2569_svisch4, 2570_svisch6 |
| Molotov – impacto (botella + llamarada) | MOLOTOV_SHATTER + MOLOTOV_BURST | 2529_glass_2 + 2525_fireplosion |
| Molotov – fuego en el suelo (loop mientras arde, ~4 s) | MOLOTOV_FIRE_LOOP | 2571_voltage_02 (volumen bajo, aproximación de crepitar) |
| Puñetazo – swing | PUNCH_SWING | 2569_svisch4, 2570_svisch6 |
| Puñetazo – 1er golpe / 2º golpe del combo | PUNCH_HIT_FIRST / PUNCH_HIT_SECOND | 2539_punch00 / 2541_punch02 |
| Puñetazo – último golpe del combo (knockback) | PUNCH_FINISHER | 2542_punch03 |
| Arma blanca (machete/hacha/espada) – impacto | BLADE_HIT | 2517_cut00, 2518_cut01, 2519_cut02 |
| Patada – swing / impacto | KICK_SWING / KICK_HIT | 2569_svisch4, 2570_svisch6 / 2539–2542_punch00–03 |
| Patada a caja | CRATE_HIT | 2559_wood_impact00 |
| Salto (y salto de pared) | JUMP | 2535_jump_00 |
| Aterrizaje suave | LAND | 2548_shellbounce00, 2549_shellbounce01 |
| Caída fuerte / ragdoll | BODY_FALL | 2539–2542_punch00–03 |
| Pisadas (1 cada 16 px en suelo) | FOOTSTEP | 2548_shellbounce00, 2549_shellbounce01 (muy bajo, aproximación) |
| Rodar / zambullida | ROLL / DIVE_CATCH | 2547_roll / 2520_dive_catch |
| Caja deslizándose (fricción/esfuerzo) | CRATE_PUSH | 2559_wood_impact00 (volumen bajo, con throttle) |
| Caja destruida | CRATE_BREAK | 2514_bustwood_1, 2515_bustwood_2 |
| Vidrio roto | GLASS_BREAK | 2528_glass_1 |
| Muerte con gore | GIB | 2527_gib_00 |
| Recoger espada / hacha / machete | PICKUP_BLADE | 2567_katana_01 |
| Recoger pistola / magnum / uzi / rifle | PICKUP_* | 2511_aim_small / 2510_aim_big / 2538_outofammo_light / 2544_rifle_draw |
| Recoger shotgun / sniper / lanzallamas | PICKUP_* | 2568_shotgun_aim / 2537_outofammo_heavy / 2550_shotgun_pump_p1 |
| Recoger bazooka | PICKUP_BAZOOKA | 2560_bazooka_aim |
| Recoger granada / molotov | PICKUP_* | 2566_grenade_safe / 2551_shotgun_pump_p2 |
| Curación (pastillas / botiquín) | HEALTH_PICKUP | 2526_getHealth_00 |
| Slowmo activo (loop de latido mientras dura) | SLOWMO_HEARTBEAT_LOOP | 2534_heartbeat |
| Vida baja (< 25 HP) | HEARTBEAT | 2534_heartbeat |

## Archivos NO usados

| Archivo | Por qué |
|---|---|
| 2509_accept_02.mp3 | Ya no se usa (era el sonido de recoger arma). |
| 2572_groovy00.mp3 | Ya no se usa (era el inicio del slowmo). |
| 2501_superfighters_theme.mp3 | Música del menú; este juego no tiene menú. |
| 2502_ambient_loop_1.mp3 | Ambiente de fondo (loop de 16 s); no estaba en el spec de SFX. Fácil de sumar con `startLoop`. |
| 2506_wilhelm.mp3 | Grito Wilhelm (easter egg); no hay un evento claro donde ponerlo. |
| 2507_comp_explode_01.mp3, 2508_comp_explode_02.mp3 | Explosión de computadora/terminal; no hay props de ese tipo en el mapa. |
| 2513_beat.mp3 | Loop musical de 3.7 s; no hay evento asociado. |
| 2516_cancel_02.mp3 | Sonido de UI "cancelar"; no hay menús. |
| 2567_katana_01.mp3 | En el original es `MELEE_GRAB` (agarre cuerpo a cuerpo); este juego no tiene la mecánica de agarrar. |
| -1.wav | Archivo de sistema/vacío del SWF. |

## Notas

- **Pisadas / caídas / fricción de cajas**: la carpeta no trae sonidos de pisadas ni de arrastre; usé `shellbounce` y `wood_impact` a volumen bajo como aproximación.
- **Temporizador de granada**: el juego usa 3.5 s (`GRENADE_FUSE_SECONDS`), no 4 s; no lo cambié porque hay tests que dependen de ese valor. Los 4 s del spec sí aplican al fuego del molotov (loop de 4 s).
- Los audios de `mods/sounds/` (SSJ2 / Ultra Instinto) no se tocaron.

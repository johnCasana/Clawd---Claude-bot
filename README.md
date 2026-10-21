# Clawd HUD

Un mod para [Claude Code](https://claude.com/claude-code) que muestra, justo encima del prompt, tus KPIs de uso: ventanas 5h y 7d, recargas, contexto, tokens, costo y actividad. A su lado, Clawd (la mascota) animado cambia de rol según lo que hace Claude.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────╮
│  [Clawd    5h       ████▋░░░░░░░░░  58%  42% libre · ↻ hoy 16:45 (2h14m)                          │
│   animado] 7d       █▊░░░░░░░░░░░░  21%  79% libre · ↻ jue 23 09:00 (3d 4h)                        │
│            Contexto ██████░░░░░░░░  44%  88k / 200k · 112k libres                                  │
│            Modelo   Opus 5.5 · esfuerzo alto                                                       │
│            Tokens   1.2M entrada · 84k salida · 1.3M en total                                      │
│            Costo    $3.42 · $1.20/h                                                                │
│            Sesión   1h23m · 12 ediciones · 30 comandos · 85 tools                                  │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Instalación

En la terminal, dentro de una sesión de Claude Code:

```
/plugin install clawd-hud --marketplace johnCasana/Clawd---Claude-bot
```

Responde `y` para agregar el marketplace y elige el alcance (Enter toma el de usuario). El HUD aparece de inmediato.

Desde una shell:

```
claude plugin install clawd-hud --marketplace johnCasana/Clawd---Claude-bot
```

En la app de escritorio: clic en **+** junto al prompt → **Plugins** → **Add marketplace** con `johnCasana/Clawd---Claude-bot` → **Add plugin**.

## Qué muestra

| Fila | Qué significa |
| --- | --- |
| **5h** | Uso de la ventana de 5 horas, % libre y cuándo se recarga. |
| **7d** | Uso semanal, % libre y fecha de recarga. |
| **Contexto** | Ventana de contexto: tokens usados, tamaño total y tokens libres. |
| **Modelo** | Modelo en uso (como lo muestra `/model`) y el esfuerzo del último pedido (`/effort`). |
| **Tokens** | Tokens de entrada, salida y total de la sesión. |
| **Costo** | Costo de la sesión y costo por hora. |
| **Sesión** | Duración, ediciones, comandos y tools usados. |

Los medidores van de verde a rojo. La marca blanca `▏` indica dónde *deberías* ir según el tiempo transcurrido de la ventana: si la barra pasa la marca, a ese ritmo te quedas sin cuota antes de la recarga.

Al pasar el 90% en 5h o 7d, Clawd se pone rojo y suda, y aparece un aviso una sola vez por ventana.

## Los roles de Clawd

El rol no se escribe: se ve en la animación de Clawd.

| Actividad de Claude | Rol | Animación |
| --- | --- | --- |
| `Write`, `Edit`, `NotebookEdit` | 👷 Ingeniero | Casco y martillo |
| Revisiones (`/code-review`, agentes de review o audit) | 📝 Auditor | Lentes, hoja y lápiz marcando ✓ |
| `Read`, `Grep`, `Glob` | 🔍 Detective | Sombrero de cuadros y lupa |
| `Bash` | 💻 Operador | Laptop con prompt parpadeando |
| `WebSearch`, `WebFetch`, tools MCP | 🌐 Explorador | Antena enviando señales |
| `Agent` (subagentes) | 📣 Director | Megáfono y un mini Clawd marchando |
| Pensando, sin tools | 💭 Pensador | Nube donde se forma la idea |
| Turno terminado | ✨ Listo | Parpadea y saluda |
| Más de 60 s sin actividad | 💤 Durmiendo | Zzz |

## Uso

- `/hud` oculta o muestra el HUD.
- Con 90 columnas o más (y altura libre suficiente) se ve la tarjeta completa con Clawd grande; en terminales angostas pasa a una versión compacta de 3 líneas (medidores, modelo, tokens y sesión).
- El esfuerzo aparece tras el primer pedido al modelo y se actualiza en cada uno; un modelo sin esfuerzo muestra solo su nombre.

## Requisitos y límites

- Claude Code con soporte de mods (function hooks), probado en la versión 2.1.304.
- El uso de 5h y 7d solo aparece con plan Pro o Max, después de la primera respuesta de la sesión.
- "Recargas" son los resets de las ventanas 5h y 7d; Claude Code no expone saldo de créditos extra.
- Los tokens se cuentan desde que el mod se carga en la sesión.
- Claude Code no ofrece un lugar fijo arriba del chat: el HUD vive en la franja sobre el prompt.

## Desarrollo

```
claude --plugin-dir .          # abre una sesión con el mod cargado desde esta carpeta
claude plugin validate .       # revisa manifest y hooks
claude plugin test .           # corre tests/hud.test.tsx
```

| Archivo | Contenido |
| --- | --- |
| `hooks/register.tsx` | Eventos (tools, turnos, mediciones de uso) y el dibujo del HUD |
| `hooks/sprites.ts` | Pixel art de Clawd por rol y los medidores con degradado |
| `hooks/format.ts` | Duraciones, fechas, tokens y la proyección de cada ventana |
| `types/index.d.ts` | Los valores que el mod guarda en el estado de la sesión |

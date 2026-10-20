# Receta 19 · Avisos del sistema y llaves

**Lo dices así:** «¿Cómo va el sistema?» o «Renueva la llave A».
**Tipo:** sin Claude. Los avisos salen solos en el **Inicio** del Panel y por email; el estado completo está en **Sistema**.

## Qué vigila el sistema

- **Llaves** (`015_sistema.sql`, tabla `llaves`): cada una con su fecha de caducidad.
  - A 60 días o menos, aviso en Inicio («Pronto»).
  - A 30 días o menos, aviso urgente en Inicio y **email** (aviso de GitHub «🔑 Una llave del sistema caduca pronto»).
- **Espacio del plan gratuito de Supabase:** base de datos (500 MB) y archivos (1 GB). Aviso a partir del 80 % y urgente a partir del 95 %.
- **Vigilancia automática** (`.github/workflows/vigilancia.yml`): cada 3 días, GitHub da un toque a Supabase (`latido()`) para que el plan gratuito no se duerma. Si Supabase no responde, llega el email «⚠️ Supabase no responde», que se cierra solo cuando vuelve a funcionar. Si en Inicio sale «La vigilancia automática no da señales», el proceso de GitHub está parado: GitHub para los procesos programados de un almacén que lleva 60 días sin cambios. Se reactiva en GitHub → *Actions* → *Vigilancia automática* → **Enable workflow**.
- **Invitaciones sin aceptar** desde hace más de una semana, y **accesos sin usar** desde hace más de 3 meses, por promotora.

## Renovar una llave (llave A o llave B)

Las dos son *fine-grained tokens* de GitHub.

1. Entra en https://github.com/settings/personal-access-tokens
2. Pulsa la llave que caduca: `GITHUB_EJECUTOR` (llave A) o `ESCAPARATE_TOKEN` (llave B).
3. Pulsa **Regenerate token**, elige la caducidad (como mucho 1 año) y pulsa **Regenerate token** otra vez.
4. Copia la llave nueva. No la pegues en ningún chat.
5. Guárdala donde estaba la anterior:
   - **llave A:** https://supabase.com/dashboard/project/iowtdenlkxjqzlpwizgb/functions/secrets → en `GITHUB_EJECUTOR`, el lápiz → pega → **Save**;
   - **llave B:** https://github.com/MUNE-Projects/studio/settings/secrets/actions → `ESCAPARATE_TOKEN` → el lápiz → pega → **Update secret**.
6. En el Panel, **Sistema** → en esa llave, **Ya la he renovado** → la fecha nueva → **Guardar**.
7. Cierra el aviso de GitHub, si lo había.

Para comprobar que funciona: la próxima vez que publiques, o con *Actions* → *Vigilancia automática* → **Run workflow**.

## Piezas

- `supabase/015_sistema.sql`: `llaves`, `renovar_llave`, `latido` (lo llama la vigilancia con la clave pública, sin sesión; solo apunta la hora y devuelve cuántos días faltan para la primera caducidad), `avisos_sistema` y `estado_sistema` (solo la administradora).
- `app/src/sistema.ts` (Inicio y Sistema) y `app/src/inicio.ts`.
- `.github/workflows/vigilancia.yml`.

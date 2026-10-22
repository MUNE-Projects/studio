# Receta 18 · Copias de seguridad y simulacro de recuperación

**Lo dices así:** «¿Están bien las copias?» o «Recupera la copia del día X».
**Tipo:** sin Claude en el día a día: las copias y el simulacro son automáticos y se ven en MUNE Studio → **Sistema**. Para recuperar una copia de verdad, con Claude.

## Qué se copia, dónde y cuándo

- **Cada noche** (`.github/workflows/copias.yml`), en el almacén privado **MUNE-Projects/copias** de GitHub:
  - **la base de datos**: todo lo de MUNE y los usuarios, con su contraseña cifrada y su código del móvil. Se lee con el usuario `copias` de la base de datos, que **solo puede leer**. Se guarda en `base-de-datos/AAAA-MM-DD.tar.gz.gpg`. Se conservan las de los últimos 31 días y la del día 1 de cada mes durante un año;
  - **los archivos nuevos**: documentación, entregables y fotos de referencia. Se leen con la cuenta `hello.muneprojects+copias@gmail.com` de MUNE, que **solo puede verlos**. Se guardan en `archivos/<almacén>/<nombre>.gpg`, una sola vez, porque en MUNE no se modifican. Si un archivo se borra en Supabase, su copia se borra 30 días después.
- **Todo va cifrado** con la **contraseña de las copias** (`COPIAS_CIFRADO`). Sin ella las copias no sirven, ni a MUNE ni a nadie que entrara en GitHub. **Guárdala también fuera de GitHub**: en tu gestor de contraseñas y en papel, en un sitio seguro.
- **Cada tres meses** (`.github/workflows/simulacro.yml`, el día 2 de enero, abril, julio y octubre), el simulacro:
  1. levanta dentro de GitHub un Supabase vacío, nunca el real;
  2. le aplica la estructura (`supabase/0NN_*.sql`);
  3. recupera la última copia: datos, usuarios y archivos, comprobando la huella de cada archivo;
  4. comprueba que hay exactamente lo mismo que en la copia.
- Las dos cosas quedan apuntadas en **Sistema**. En **Inicio** sale un aviso si falta la copia de una noche («La copia de seguridad no se hace desde…»), si el último simulacro falló o si toca uno. Si algo falla, además te llega un email (aviso de GitHub «⚠️ …»), que se cierra solo cuando vuelve a funcionar.
- Coste: ninguno (minutos gratuitos de GitHub Actions y almacén privado gratuito). Cuando el almacén de copias pase de 1 GB, se valorará pasarlas a Cloudflare R2 (decisión 17).

## Ponerlas en marcha (una sola vez)

Necesitas inventar **tres contraseñas largas** (por ejemplo, de 30 letras y números, sin espacios). Mejor si te las genera tu gestor de contraseñas. **No las pegues en ningún chat.**

- **Contraseña 1:** la del usuario `copias` de la base de datos.
- **Contraseña 2:** la de la cuenta `copias` de MUNE.
- **Contraseña 3:** la de cifrado de las copias. **Es la importante: guárdala también fuera de GitHub.**

Las contraseñas 1 y 2 no hace falta recordarlas: si se pierden, se cambian.

### 1. El almacén de copias

1. Entra en https://github.com/organizations/MUNE-Projects/repositories/new
2. En **Repository name**, escribe `copias`.
3. Elige **Private**.
4. Marca **Add a README file**.
5. Pulsa **Create repository**.

### 2. Dar permiso a la llave B sobre ese almacén

1. Entra en https://github.com/settings/personal-access-tokens
2. Pulsa `ESCAPARATE_TOKEN` y luego **Edit**.
3. En **Repository access** (*Only select repositories*), añade `MUNE-Projects/copias` sin quitar `experience`.
4. Abajo, pulsa **Update**.

No cambia la llave ni su fecha de caducidad, así que no hay que guardarla en ningún sitio.

### 3. La cuenta «copias» de MUNE

1. Entra en https://supabase.com/dashboard/project/iowtdenlkxjqzlpwizgb/auth/users
2. Pulsa **Add user** y luego **Create new user**.
3. Escribe:
   - **Email:** `hello.muneprojects+copias@gmail.com`
   - **Password:** la contraseña 2.
4. Marca **Auto Confirm User** y pulsa **Create user**.

### 4. El archivo SQL

1. Entra en https://supabase.com/dashboard/project/iowtdenlkxjqzlpwizgb/sql/new
2. Pega entero `supabase/023_copias.sql` y pulsa **Run**.
3. Debe salir: «Listo: copias de seguridad preparadas…».

### 5. La contraseña del usuario «copias» de la base de datos

1. En el mismo SQL Editor, borra lo que haya.
2. Escribe esto, cambiando el texto entre comillas por la contraseña 1:
   `alter role copias with password 'CONTRASEÑA-1';`
3. Pulsa **Run**. Debe salir «Success».

### 6. La dirección de la base de datos

1. En Supabase, pulsa **Connect**, arriba, y luego el recuadro **Direct** («Connection string»).
2. En el desplegable del tipo de conexión, elige **Session pooler** y copia la dirección. Empieza por `postgresql://postgres.iowtdenlkxjqzlpwizgb:[YOUR-PASSWORD]@`. No lleva ninguna contraseña: deja `[YOUR-PASSWORD]` tal cual.
3. Entra en https://github.com/MUNE-Projects/studio/settings/variables/actions/new
4. En **Name**, escribe `SUPABASE_POOLER`. En **Value**, pega la dirección.
5. Pulsa **Add variable**.

### 7. Los tres secretos

Entra en https://github.com/MUNE-Projects/studio/settings/secrets/actions/new y crea cada secreto: escribe el **Name**, pega el **Secret** y pulsa **Add secret**.

| Name | Secret |
|---|---|
| `COPIAS_BD_CLAVE` | contraseña 1 |
| `COPIAS_CUENTA_CLAVE` | contraseña 2 |
| `COPIAS_CIFRADO` | contraseña 3 |

### 8. La primera copia y el primer simulacro

1. Entra en https://github.com/MUNE-Projects/studio/actions/workflows/copias.yml
2. Pulsa **Run workflow** y luego otra vez **Run workflow**.
3. Espera a que salga el círculo verde (un par de minutos).
4. Entra en https://github.com/MUNE-Projects/studio/actions/workflows/simulacro.yml
5. Pulsa **Run workflow** y otra vez **Run workflow**. Tarda unos 5 minutos.
6. En MUNE Studio → **Sistema** → **Copias de seguridad** deben salir «Al día» y «Recuperado entero».

## Si llega un aviso

- **«La copia de seguridad ha fallado»:** los datos de MUNE están bien; solo falta la copia. Díselo a Claude: mirará el detalle del proceso en GitHub. Las causas típicas son:
  - la llave B ha caducado o ha perdido el permiso sobre `copias` (paso 2);
  - Supabase está en pausa;
  - ha cambiado alguna contraseña.
- **«El simulacro de recuperación ha fallado»:** la copia no se ha podido recuperar tal cual. Suele ser porque la estructura del proyecto real y la de `supabase/0NN_*.sql` ya no coinciden, es decir, falta pegar algún archivo SQL. Díselo a Claude.
- **El proceso no se ejecuta:** GitHub para los procesos programados de un almacén que lleva 60 días sin cambios. Se reactiva en *Actions* → *Copias de seguridad* → **Enable workflow**.

## Recuperar una copia de verdad (con Claude)

Solo si Supabase pierde datos, en caso de un error grave o de una pérdida total. Nunca se recupera encima del proyecto real: la herramienta se niega.

1. Se crea un proyecto de Supabase nuevo y vacío (gratuito, en la UE).
2. Se le aplica la estructura: `supabase/copias/estructura.sh` o, a mano, los archivos SQL en orden.
3. `node supabase/copias/restaurar.mjs --bd <dirección del proyecto nuevo> --archivos --comprobar --forzar` recupera la copia elegida (`--copia base-de-datos/AAAA-MM-DD.tar.gz.gpg`, o la última). Necesita la contraseña de cifrado, la carpeta del almacén de copias y la clave secreta del proyecto nuevo, que se configuran como secretos, nunca en el chat.
4. Se cambian las direcciones de MUNE Studio, el Portal y las funciones al proyecto nuevo, o se recupera solo lo que se perdió en el actual.

**Pérdida máxima:** lo que se hizo desde la última copia (como mucho, un día).

## Piezas

- `supabase/023_copias.sql`:
  - el usuario `copias` de la base de datos (solo lectura) y el esquema `copias`, con las vistas de los usuarios;
  - `cuentas_copias` y `es_copias()`, y que esa cuenta pueda ver los archivos;
  - `copias_hechas` y `registrar_copia`;
  - avisos y estado del sistema con las copias.
- `supabase/copias/`: `copiar.mjs`, `restaurar.mjs`, `registrar.mjs`, `estructura.sh`, `comun.mjs` y `simulacro/` (Supabase local del simulacro).
- `.github/workflows/copias.yml` y `.github/workflows/simulacro.yml`.
- `app/src/sistema.ts` (Sistema → Copias de seguridad).
- La prueba de aislamiento comprueba que la cuenta y el usuario de copias solo pueden leer, y que nadie más apunta copias.

import type { Factor } from '@supabase/supabase-js';
import { alEnviar, anotar, esc, INACTIVIDAD_MAX, sb, traducir } from './comun';
import { pantallaInicio } from './inicio';
import { pantallaPromocion, pantallaPromotora, pantallaPromotoras } from './promotoras';
import { pantallaSistema } from './sistema';

const app = document.getElementById('app')!;

function pintar(html: string): void {
	app.innerHTML = html;
	app.querySelector<HTMLElement>('[autofocus]')?.focus();
}

const CABECERA = '<p class="marca">MUNE Studio</p>';
const SESION_CADUCADA = 'Tu sesión se ha cerrado tras un rato sin actividad. Vuelve a entrar.';
const CAMPO_CODIGO = `<label>Código de 6 cifras
	<input class="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
</label>`;

// ── Decide qué pantalla toca ──────────────────────────────────────────────

async function decidir(): Promise<void> {
	const { data: { session } } = await sb.auth.getSession();
	if (!session) return pantallaEntrada();

	const { data: nivel, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
	if (error) throw error;
	if (nivel.currentLevel === 'aal2') return escritorio();

	const { data: factores, error: e2 } = await sb.auth.mfa.listFactors();
	if (e2) throw e2;
	const totp = factores.all.filter((f) => f.factor_type === 'totp');
	const verificado = totp.find((f) => f.status === 'verified');
	if (verificado) return pantallaCodigo(verificado);
	return pantallaAlta(totp);
}

// ── 1. Correo y contraseña ────────────────────────────────────────────────

function pantallaEntrada(aviso = ''): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Entrar</h1>
		${aviso ? `<p class="aviso" role="status">${esc(aviso)}</p>` : ''}
		<label>Correo <input name="correo" type="email" autocomplete="username" required autofocus></label>
		<label>Contraseña <input name="clave" type="password" autocomplete="current-password" required></label>
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Entrar</button>
	</form>`);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.signInWithPassword({
			email: String(d.get('correo')).trim(),
			password: String(d.get('clave')),
		});
		if (error) throw error;
		await decidir();
	});
}

// ── 2a. Primera vez: vincular la app del móvil ────────────────────────────

async function pantallaAlta(pendientes: Factor[]): Promise<void> {
	// Un alta a medias (QR que no se llegó a confirmar) impide crear otra.
	for (const f of pendientes) await sb.auth.mfa.unenroll({ factorId: f.id });

	const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Móvil', issuer: 'MUNE Studio' });
	if (error) throw error;

	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Protege tu acceso con el móvil</h1>
		<p>Cada vez que entres, además de la contraseña, necesitarás un código del móvil. Para activarlo:</p>
		<p>1. Abre <strong>Google Authenticator</strong> (o Microsoft Authenticator) en el móvil.<br>
		2. Pulsa <strong>+</strong> y elige <strong>Escanear código QR</strong>.<br>
		3. Escribe aquí el código de 6 cifras que aparece en <strong>MUNE Studio</strong>.</p>
		<div class="qr"><img alt="Código QR para la app de verificación" src="${esc(data.totp.qr_code)}"></div>
		<p class="secreto">¿No puedes escanear el código? Escribe esta clave a mano en la app: ${esc(data.totp.secret)}</p>
		${CAMPO_CODIGO}
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Confirmar</button>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</form>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: String(d.get('codigo')).trim() });
		if (error) throw error;
		await anotar('activa doble verificación');
		await decidir();
	});
}

// ── 2b. Resto de veces: pedir el código ───────────────────────────────────

function pantallaCodigo(factor: Factor): void {
	pintar(`<form class="caja" novalidate>
		${CABECERA}
		<h1>Código del móvil</h1>
		<p>Abre la app de verificación del móvil y escribe el código de 6 cifras que aparece en <strong>MUNE Studio</strong> (o «MUNE Panel», si aún no lo has cambiado).</p>
		${CAMPO_CODIGO}
		<p class="error" role="alert"></p>
		<button class="boton" type="submit">Verificar</button>
		<button class="boton secundario" type="button" data-salir>Salir</button>
	</form>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	alEnviar(app.querySelector('form')!, async (d) => {
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: String(d.get('codigo')).trim() });
		if (error) throw error;
		await decidir();
	});
}

// ── 3. Escritorio: menú y páginas ─────────────────────────────────────────
// Rutas: #/ (Inicio), #/promotoras, #/promotora/<id>, #/promocion/<id>/<pestaña>
// y #/sistema.

async function escritorio(): Promise<void> {
	// (filtrado por la cuenta: si hay más de una administradora, cada una ve a todas)
	const { data: { user } } = await sb.auth.getUser();
	const { data: admin, error } = await sb.from('administradores').select('nombre').eq('user_id', user?.id ?? '').maybeSingle();
	if (error) throw error;
	if (!admin) {
		await sb.auth.signOut();
		pintar(`<div class="caja">${CABECERA}<h1>Sin acceso</h1>
			<p>Esta cuenta no tiene acceso a MUNE Studio. Comprueba que has entrado con el correo correcto y recarga la página para volver a entrar.</p></div>`);
		return;
	}

	if (!sessionStorage.getItem('panel:entrada-anotada')) {
		await anotar('entra en el panel');
		sessionStorage.setItem('panel:entrada-anotada', '1');
	}

	pintar(`<div class="escritorio">
		<header class="cabecera">
			${CABECERA}
			<nav class="menu" aria-label="Secciones de MUNE Studio">
				<a href="#/" data-menu="inicio">Inicio</a>
				<a href="#/promotoras" data-menu="promotoras">Promotoras</a>
				<a href="#/sistema" data-menu="sistema">Sistema</a>
			</nav>
			<button class="boton secundario" type="button" data-salir>Salir</button>
		</header>
		<div class="contenido" data-contenido></div>
	</div>`);
	app.querySelector('[data-salir]')!.addEventListener('click', salir);
	await mostrar();
}

/** Pinta la página que indica la dirección (#/…). */
async function mostrar(): Promise<void> {
	const contenido = app.querySelector<HTMLElement>('[data-contenido]');
	if (!contenido) return;
	const [seccion = '', id = '', pestana = ''] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
	const menu = seccion === 'promotora' || seccion === 'promocion' ? 'promotoras' : seccion || 'inicio';
	app.querySelectorAll<HTMLAnchorElement>('[data-menu]').forEach((a) => {
		if (a.dataset.menu === menu) a.setAttribute('aria-current', 'page');
		else a.removeAttribute('aria-current');
	});
	contenido.innerHTML = '<p class="vacio">Cargando…</p>';
	try {
		if (seccion === 'promotoras') await pantallaPromotoras(contenido);
		else if (seccion === 'promotora' && id) await pantallaPromotora(contenido, id);
		else if (seccion === 'promocion' && id) await pantallaPromocion(contenido, id, pestana);
		else if (seccion === 'sistema') await pantallaSistema(contenido);
		else await pantallaInicio(contenido);
	} catch (e) {
		contenido.innerHTML = `<p class="error">${esc(traducir(e))}</p>`;
	}
}

addEventListener('hashchange', () => {
	if (!app.querySelector('[data-contenido]')) return;
	scrollTo(0, 0);
	void mostrar();
});

// ── Utilidades de sesión ──────────────────────────────────────────────────

async function salir(): Promise<void> {
	sessionStorage.removeItem('panel:entrada-anotada');
	await sb.auth.signOut();
	pantallaEntrada();
}

let ultimaActividad = Date.now();
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true });
setInterval(async () => {
	if (Date.now() - ultimaActividad < INACTIVIDAD_MAX) return;
	const { data: { session } } = await sb.auth.getSession();
	if (session) {
		await salir();
		pantallaEntrada(SESION_CADUCADA);
	}
}, 60_000);

decidir().catch((e) => {
	pintar(`<div class="caja">${CABECERA}<h1>No se ha podido cargar</h1><p class="error">${esc(traducir(e))}</p>
		<button class="boton" type="button" data-reintentar>Volver a probar</button></div>`);
	app.querySelector('[data-reintentar]')!.addEventListener('click', () => location.reload());
});

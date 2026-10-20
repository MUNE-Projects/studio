// Código del móvil: pasar la entrada de la app de verificación de «MUNE Panel»
// a «MUNE Studio» sin quedarse nunca sin acceso (paso 3 de la lista maestra).
//
// 1. Se añade una entrada nueva (código QR con el nombre «MUNE Studio»).
// 2. Se comprueba con un código de esa entrada nueva.
// 3. Solo entonces se retira la antigua. Si algo falla, la antigua sigue valiendo.

import { esc, sb, traducir } from './comun';

const NOMBRE = 'Móvil · MUNE Studio';

export async function pintarMovil(caja: HTMLElement): Promise<void> {
	const { data, error } = await sb.auth.mfa.listFactors();
	if (error) { caja.innerHTML = `<h2>Código del móvil</h2><p class="error">${esc(traducir(error))}</p>`; return; }
	const verificados = (data?.totp ?? []).filter((f) => f.status === 'verified');
	const nuevo = verificados.find((f) => f.friendly_name === NOMBRE);
	if (nuevo && verificados.length === 1) {
		caja.innerHTML = '<h2>Código del móvil</h2><p class="ok">✓ Tu código del móvil ya aparece en la app como «MUNE Studio».</p>';
		return;
	}
	caja.innerHTML = `<h2>Código del móvil</h2>
		<p class="ayuda">En la app del móvil, tu código todavía aparece como «MUNE Panel». Puedes pasarlo a «MUNE Studio»: primero añades la entrada nueva y la compruebas con un código, y solo entonces se retira la antigua. Si algo falla, la antigua sigue funcionando.</p>
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-movil>Pasar el código del móvil a MUNE Studio</button></div>
		<div data-movil-paso></div>`;
	caja.querySelector('[data-movil]')!.addEventListener('click', () => void empezar(caja));
}

async function empezar(caja: HTMLElement): Promise<void> {
	const paso = caja.querySelector<HTMLElement>('[data-movil-paso]')!;
	caja.querySelector<HTMLButtonElement>('[data-movil]')!.disabled = true;
	// un intento anterior a medias (sin comprobar) se quita antes de empezar otro
	const { data: lista } = await sb.auth.mfa.listFactors();
	for (const f of (lista?.all ?? []).filter((x) => x.friendly_name === NOMBRE && x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
	const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: NOMBRE, issuer: 'MUNE Studio' });
	if (error || !data) { paso.innerHTML = `<p class="error">${esc(traducir(error))}</p>`; return; }
	paso.innerHTML = `<form class="peticion-form" novalidate>
		<p>1. En la app del móvil (Google Authenticator o Microsoft Authenticator), pulsa <strong>+</strong> y elige <strong>Escanear código QR</strong>.<br>
		2. Escribe aquí el código de 6 cifras de la entrada nueva, la que dice <strong>MUNE Studio</strong>.</p>
		<div class="qr"><img alt="Código QR para la app de verificación" src="${esc(data.totp.qr_code)}"></div>
		<p class="secreto">¿No puedes escanear el código? Escribe esta clave a mano en la app: ${esc(data.totp.secret)}</p>
		<label>Código de la entrada «MUNE Studio» <input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton pequeno" type="submit">Comprobar y terminar</button></div>
	</form>`;
	const form = paso.querySelector('form')!;
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		const error = form.querySelector<HTMLElement>('.error')!;
		const codigo = String(new FormData(form).get('codigo') ?? '').replace(/\D/g, '');
		if (codigo.length !== 6) { error.textContent = 'Escribe el código de 6 cifras.'; return; }
		const boton = form.querySelector<HTMLButtonElement>('button')!;
		boton.disabled = true;
		const { error: e } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: codigo });
		if (e) { error.textContent = 'Ese código no vale. Comprueba que es el de la entrada «MUNE Studio» y vuelve a probar.'; boton.disabled = false; return; }
		// comprobada la nueva: se retiran las antiguas
		const { data: todos } = await sb.auth.mfa.listFactors();
		for (const f of (todos?.totp ?? []).filter((x) => x.id !== data.id && x.status === 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
		caja.innerHTML = `<h2>Código del móvil</h2><p class="ok">✓ Hecho. A partir de ahora usa la entrada «MUNE Studio». Ya puedes borrar «MUNE Panel» de la app del móvil.</p>`;
	});
}

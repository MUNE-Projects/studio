// Formalización de la personalización (016_formalizacion.sql, decisión 39).
//
// A quién envía el comprador su documento de selección firmado y los datos para
// la transferencia. Los rellena la promotora en MUNE Portal (o la administradora
// en MUNE Studio) y solo llegan a la experiencia pública cuando el comprador
// entra con un código válido.
//
// Este archivo es igual en app/src y portal/src: si cambias uno, copia el otro.

export interface Formalizacion {
	contacto?: { nombre?: string; email?: string; telefono?: string };
	pago?: { titular?: string; banco?: string; iban?: string; bic?: string; concepto?: string; plazoDias?: number; instrucciones?: string };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function formFormalizacion(f: Formalizacion | null | undefined): string {
	const c = f?.contacto ?? {};
	const p = f?.pago ?? {};
	const v = (x: string | number | undefined) => esc(String(x ?? ''));
	return `<form class="peticion-form" data-formalizacion novalidate>
		<h3 class="subtitulo">A quién envía el comprador su documento</h3>
		<label>Email <input name="contacto_email" type="email" maxlength="200" autocomplete="off" value="${v(c.email)}"></label>
		<label>Nombre (opcional) <input name="contacto_nombre" maxlength="200" placeholder="Por ejemplo: Departamento comercial" value="${v(c.nombre)}"></label>
		<label>Teléfono (opcional) <input name="contacto_telefono" maxlength="200" inputmode="tel" value="${v(c.telefono)}"></label>
		<h3 class="subtitulo">Datos para la transferencia</h3>
		<p class="ayuda">Solo si las mejoras se pagan por transferencia. Aparecen en el documento de cada pack.</p>
		<label>Titular de la cuenta <input name="titular" maxlength="200" value="${v(p.titular)}"></label>
		<label>Entidad <input name="banco" maxlength="200" value="${v(p.banco)}"></label>
		<label>IBAN <input name="iban" maxlength="50" autocomplete="off" value="${v(p.iban)}"></label>
		<label>BIC (opcional) <input name="bic" maxlength="20" autocomplete="off" value="${v(p.bic)}"></label>
		<label>Concepto <input name="concepto" maxlength="200" placeholder="{promocion} · {ref} · {pack}" value="${v(p.concepto)}"></label>
		<p class="ayuda">En el concepto puedes usar {promocion}, {ref} (la vivienda) y {pack}; se sustituyen solos.</p>
		<label>Plazo para pagar, en días (opcional) <input name="plazo_dias" type="number" min="1" max="90" value="${v(p.plazoDias)}"></label>
		<label>Instrucciones (opcional) <textarea name="instrucciones" rows="3" maxlength="1000">${v(p.instrucciones)}</textarea></label>
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

/** Datos del formulario, listos para guardar_formalizacion. */
export function datosFormalizacion(promocion: string, d: FormData): Record<string, unknown> {
	const t = (k: string) => String(d.get(k) ?? '').trim();
	const email = t('contacto_email');
	if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('El email no parece correcto. Revísalo y vuelve a guardar.');
	const plazo = t('plazo_dias');
	return {
		p_promocion: promocion,
		p_contacto_nombre: t('contacto_nombre'), p_contacto_email: email, p_contacto_telefono: t('contacto_telefono'),
		p_titular: t('titular'), p_banco: t('banco'), p_iban: t('iban'), p_bic: t('bic'), p_concepto: t('concepto'),
		p_plazo_dias: plazo ? Number(plazo) : null, p_instrucciones: t('instrucciones'),
	};
}

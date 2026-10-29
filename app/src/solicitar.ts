// «Solicitar información» en Ficha y datos (032_solicitar_informacion.sql). El
// mismo archivo está en MUNE Studio (app/src) y en MUNE Portal (portal/src): si
// cambias uno, copia el otro.
//
// La promotora elige a dónde lleva el botón de la experiencia pública: a su web
// o a un email («enlace»), o a su formulario, que se abre encima del 3D
// («formulario», con el código de inserción de su CRM). Llegan las UTM. Se aplica
// al momento.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface DatosSolicitar { solicitar_modo?: string | null; solicitar_info?: string | null; solicitar_formulario?: string | null }

export function formSolicitar(p: DatosSolicitar, esc: (t: string) => string): string {
	const formulario = p.solicitar_modo === 'formulario';
	return `<form class="peticion-form solicitar-form" data-solicitar-info novalidate>
		<fieldset class="solicitar-modo">
			<label class="interruptor"><input type="radio" name="modo" value="enlace"${formulario ? '' : ' checked'}> Llevar a mi web o a un email</label>
			<label class="interruptor"><input type="radio" name="modo" value="formulario"${formulario ? ' checked' : ''}> Mostrar mi formulario aquí, sin salir del 3D</label>
		</fieldset>
		<div data-modo="enlace"${formulario ? ' hidden' : ''}>
			<label>Enlace o email <input name="enlace" type="text" maxlength="500" inputmode="url" placeholder="https://tuweb.es/contacto o ventas@tuweb.es" value="${esc(p.solicitar_info?.replace(/^mailto:/, '') ?? '')}"></label>
			<p class="ayuda">Si la experiencia está dentro de tu web, el botón lleva a esa página en la misma ventana; si no, la abre en otra pestaña para no perder el 3D. Si lo dejas vacío, el botón no aparece.</p>
		</div>
		<div data-modo="formulario"${formulario ? '' : ' hidden'}>
			<label>Código de inserción de tu formulario <textarea name="formulario" rows="6" maxlength="20000" spellcheck="false" placeholder="&lt;script src=&quot;…&quot;&gt;&lt;/script&gt; …">${esc(p.solicitar_formulario ?? '')}</textarea></label>
			<p class="ayuda">Cópialo de tu CRM o de tu herramienta de formularios (HubSpot, Salesforce, Clientify, Typeform…): suele llamarse «código de inserción», «embed» o «HTML». Se ve en una ventana encima del 3D al pulsar «Solicitar información», aislado de la experiencia. Funciona desde la próxima versión que prepare el equipo de MUNE.</p>
		</div>
		<p class="ayuda">En los dos casos llega de dónde viene el interesado (utm_source=mune, utm_medium=experiencia-3d, la promoción y la tipología), para que lo veas en tu CRM; en un email, la tipología va en el asunto. MUNE no ve ni guarda lo que escriba el interesado.</p>
		<p class="error" role="alert"></p>
		<div class="acciones"><button class="boton" type="submit">Guardar</button></div>
		<p class="ok" data-guardado role="status"></p>
	</form>`;
}

/** Conecta el formulario: cambia de modo y guarda. */
export function conectarSolicitar(caja: HTMLElement, sb: SupabaseClient, promocion: string, traducir: (e: unknown) => string): void {
	const form = caja.querySelector<HTMLFormElement>('[data-solicitar-info]')!;
	const modo = () => form.querySelector<HTMLInputElement>('[name="modo"]:checked')!.value;
	form.querySelectorAll('[name="modo"]').forEach((r) => r.addEventListener('change', () => {
		form.querySelectorAll<HTMLElement>('[data-modo]').forEach((x) => { x.hidden = x.dataset.modo !== modo(); });
	}));
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		const error = form.querySelector<HTMLElement>('.error')!;
		const ok = form.querySelector<HTMLElement>('[data-guardado]')!;
		const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
		error.textContent = '';
		ok.textContent = '';
		boton.disabled = true;
		const valor = (n: string) => String(new FormData(form).get(n) ?? '');
		const { error: e } = await sb.rpc('guardar_solicitar_informacion', {
			p_promocion: promocion, p_modo: modo(), p_enlace: valor('enlace'), p_formulario: valor('formulario') || null,
		});
		boton.disabled = false;
		if (e) {
			error.textContent = traducir(e);
			return;
		}
		ok.textContent = modo() === 'formulario'
			? '✓ Guardado. El formulario se verá en la experiencia pública desde la próxima versión.'
			: valor('enlace').trim() ? '✓ Guardado. Ya aparece en la experiencia pública.' : '✓ Guardado. El botón ya no aparece.';
	});
}

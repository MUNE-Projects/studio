// Marca de la promotora (paso 8c, 031_marca.sql). El mismo archivo está en
// MUNE Studio (app/src) y en MUNE Portal (portal/src): si cambias uno, copia el otro.
//
// La marca general vale para todas las promociones de la promotora; una
// promoción puede tener la suya propia, que la sustituye entera. Lleva el
// nombre que se enseña, el logo, los colores, la tipografía y el contacto.
// Se aplica en la próxima versión que prepare MUNE (la Experiencia 3D es una
// web fija): al guardar no se publica nada.

import type { SupabaseClient } from '@supabase/supabase-js';

interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	fecha: (iso: string) => string;
	traducir: (e: unknown) => string;
}
/** Dónde se pinta: la marca general de una promotora o la de una promoción. */
interface Sitio {
	promotora: string;
	promocion?: { id: string; nombre: string };
	/** Enlace a la marca general (para quien puede cambiarla). */
	enlaceGeneral?: string;
}
interface Marca {
	promotora: string; logoSvg?: string; colorPrincipal: string; colorSecundario: string;
	tipografia: { familia: string }; contacto?: { telefono?: string; email?: string; web?: string; direccion?: string };
	actualizado_en: string; por: string;
}

const POR_DEFECTO = { colorPrincipal: '#2f5d50', colorSecundario: '#b8946a', familia: 'Manrope' };
const MAX_LOGO = 200000;
const AVISO_VERSION = 'Los cambios saldrán en la próxima versión que prepare el equipo de MUNE (Experiencia 3D, planos comerciales y documento de selección). La revisarás en la vista previa antes de publicarla: al guardar no se publica nada.';

const urlLogo = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Un PNG o JPG, dentro de un SVG (como mucho, 160 px de alto), para que todo el logo sea un SVG. */
function rasterASvg(archivo: File): Promise<string> {
	return new Promise((ok, mal) => {
		const img = new Image();
		img.onload = () => {
			const escala = Math.min(1, 160 / img.naturalHeight, 640 / img.naturalWidth);
			const ancho = Math.max(1, Math.round(img.naturalWidth * escala)), alto = Math.max(1, Math.round(img.naturalHeight * escala));
			const c = document.createElement('canvas');
			c.width = ancho;
			c.height = alto;
			c.getContext('2d')!.drawImage(img, 0, 0, ancho, alto);
			URL.revokeObjectURL(img.src);
			ok(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}"><image href="${c.toDataURL('image/png')}" width="${ancho}" height="${alto}"/></svg>`);
		};
		img.onerror = () => mal(new Error('No se ha podido leer la imagen.'));
		img.src = URL.createObjectURL(archivo);
	});
}

export async function pintarMarca(caja: HTMLElement, d: Dependencias, sitio: Sitio, aviso = ''): Promise<void> {
	const { esc } = d;
	const { data, error } = sitio.promocion
		? await d.sb.rpc('marca_de_promocion', { p_promocion: sitio.promocion.id })
		: await d.sb.rpc('marca_de_promotora', { p_promotora: sitio.promotora });
	if (error) {
		caja.innerHTML = `<h2>Marca</h2><p class="error">${esc(d.traducir(error))}</p>`;
		return;
	}
	const r = data as {
		general: Marca | null; propia?: Marca | null; puede_cambiar: boolean; puede_cambiar_general?: boolean;
		tipografias: string[]; propias?: { id: string; nombre: string }[];
	};
	const repintar = (texto: string) => pintarMarca(caja, d, sitio, texto);

	/** Cómo se verá: el logo, el nombre, los colores y el contacto. */
	const vista = (m: Pick<Marca, 'promotora' | 'logoSvg' | 'colorPrincipal' | 'colorSecundario' | 'tipografia' | 'contacto'>) => `
		<div class="marca-vista" style="--marca-1:${esc(m.colorPrincipal)};--marca-2:${esc(m.colorSecundario)}" data-vista>
			<div class="marca-logo">${m.logoSvg ? `<img src="${esc(urlLogo(m.logoSvg))}" alt="Logo">` : '<span class="promo-lugar">Sin logo</span>'}</div>
			<p><strong data-vista-nombre>${esc(m.promotora)}</strong><br><span class="promo-lugar">Tipografía: <span data-vista-fuente>${esc(m.tipografia.familia)}</span></span></p>
			<p class="marca-muestra"><span class="marca-boton">Personaliza tu vivienda</span><span class="marca-detalle"></span></p>
			<p class="promo-lugar" data-vista-contacto>${esc([m.contacto?.telefono, m.contacto?.email, m.contacto?.web, m.contacto?.direccion].filter(Boolean).join(' · '))}</p>
		</div>`;
	const cuando = (m: Marca) => `<p class="promo-versiones">Cambiada el ${esc(d.fecha(m.actualizado_en))}, por ${esc(m.por)}.</p>`;

	const formulario = (m: Marca | null, boton: string) => `
		<form class="peticion-form marca-form" data-marca-form novalidate>
			<div class="marca-columnas">
				<div>
					<label>Nombre que verán los compradores<input name="nombre" maxlength="80" required value="${esc(m?.promotora ?? '')}" placeholder="Por ejemplo: Promotora Demo"></label>
					<label>Logo (SVG, PNG o JPG)<input name="logo" type="file" accept=".svg,image/svg+xml,image/png,image/jpeg"></label>
					<label class="interruptor" data-sin-logo${m?.logoSvg ? '' : ' hidden'}><input name="quitar_logo" type="checkbox"> Quitar el logo</label>
					<div class="fechas">
						<label>Color principal<input name="color_principal" type="color" value="${esc(m?.colorPrincipal ?? POR_DEFECTO.colorPrincipal)}"></label>
						<label>Color secundario<input name="color_secundario" type="color" value="${esc(m?.colorSecundario ?? POR_DEFECTO.colorSecundario)}"></label>
					</div>
					<label>Tipografía<select name="tipografia">${r.tipografias.map((t) =>
						`<option${t === (m?.tipografia.familia ?? POR_DEFECTO.familia) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
					<h4>Contacto comercial</h4>
					<label>Teléfono<input name="telefono" maxlength="40" value="${esc(m?.contacto?.telefono ?? '')}"></label>
					<label>Email<input name="email" type="email" maxlength="120" value="${esc(m?.contacto?.email ?? '')}"></label>
					<label>Web<input name="web" maxlength="120" value="${esc(m?.contacto?.web ?? '')}" placeholder="tuweb.es"></label>
					<label>Dirección<input name="direccion" maxlength="200" value="${esc(m?.contacto?.direccion ?? '')}" placeholder="Oficina comercial"></label>
				</div>
				<div><h4>Así se verá</h4>${vista({ promotora: m?.promotora ?? '', logoSvg: m?.logoSvg, colorPrincipal: m?.colorPrincipal ?? POR_DEFECTO.colorPrincipal,
					colorSecundario: m?.colorSecundario ?? POR_DEFECTO.colorSecundario, tipografia: { familia: m?.tipografia.familia ?? POR_DEFECTO.familia }, contacto: m?.contacto })}</div>
			</div>
			<p class="ayuda">${AVISO_VERSION}</p>
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton" type="submit">${esc(boton)}</button></div>
		</form>`;

	/** Conecta el formulario: vista en directo, logo y guardar. */
	const conectar = (m: Marca | null, promocion: string | null, guardado: string) => {
		const form = caja.querySelector<HTMLFormElement>('[data-marca-form]')!;
		let logo = m?.logoSvg ?? null;
		const campo = (n: string) => form.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
		const error = form.querySelector<HTMLElement>('.error')!;
		const refrescar = () => {
			const v = form.querySelector<HTMLElement>('[data-vista]')!;
			v.style.setProperty('--marca-1', campo('color_principal').value);
			v.style.setProperty('--marca-2', campo('color_secundario').value);
			v.querySelector('[data-vista-nombre]')!.textContent = campo('nombre').value.trim();
			v.querySelector('[data-vista-fuente]')!.textContent = form.querySelector<HTMLSelectElement>('[name="tipografia"]')!.value;
			v.querySelector('[data-vista-contacto]')!.textContent = ['telefono', 'email', 'web', 'direccion'].map((n) => campo(n).value.trim()).filter(Boolean).join(' · ');
			const usado = campo('quitar_logo').checked ? null : logo;
			v.querySelector('.marca-logo')!.innerHTML = usado ? `<img src="${esc(urlLogo(usado))}" alt="Logo">` : '<span class="promo-lugar">Sin logo</span>';
		};
		form.addEventListener('input', refrescar);
		campo('logo').addEventListener('change', async () => {
			error.textContent = '';
			const f = campo('logo').files?.[0];
			if (!f) return;
			try {
				const svg = /svg/i.test(f.type) || /\.svg$/i.test(f.name) ? (await f.text()).trim() : await rasterASvg(f);
				if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svg)) throw new Error('Ese archivo no es un SVG válido.');
				if (svg.length > MAX_LOGO) throw new Error('El logo ocupa demasiado: como mucho, 150 KB.');
				logo = svg;
				campo('quitar_logo').checked = false;
				form.querySelector<HTMLElement>('[data-sin-logo]')!.hidden = false;
				refrescar();
			} catch (e) {
				error.textContent = e instanceof Error ? e.message : 'No se ha podido leer el logo.';
				campo('logo').value = '';
			}
		});
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			error.textContent = '';
			if (!campo('nombre').value.trim()) {
				error.textContent = 'Escribe el nombre que verán los compradores.';
				return;
			}
			const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
			boton.disabled = true;
			const { error: e } = await d.sb.rpc('guardar_marca', {
				p_promotora: sitio.promotora, p_promocion: promocion, p_marca: {
					nombre: campo('nombre').value.trim(), logo_svg: campo('quitar_logo').checked ? null : logo,
					color_principal: campo('color_principal').value, color_secundario: campo('color_secundario').value,
					tipografia: form.querySelector<HTMLSelectElement>('[name="tipografia"]')!.value,
					telefono: campo('telefono').value.trim(), email: campo('email').value.trim(), web: campo('web').value.trim(), direccion: campo('direccion').value.trim(),
				},
			});
			if (e) {
				error.textContent = d.traducir(e);
				boton.disabled = false;
				return;
			}
			await repintar(guardado);
		});
	};

	const avisoHtml = aviso ? `<p class="aviso" role="status">${esc(aviso)}</p>` : '';
	const guardado = '✓ Marca guardada. Saldrá en la próxima versión que prepare el equipo de MUNE.';

	// ── la marca general de la promotora
	if (!sitio.promocion) {
		caja.innerHTML = `<h2>Marca</h2>
			<p class="ayuda">El nombre, el logo, los colores, la tipografía y el contacto que verán tus compradores en la Experiencia 3D, los planos comerciales y el documento de selección. Vale para todas tus promociones; si una tiene su propia marca, se cambia en su pestaña «Marca».</p>
			${avisoHtml}
			${r.general ? cuando(r.general) : '<p class="vacio">Todavía no has puesto tu marca: se usa la que preparó el equipo de MUNE.</p>'}
			${r.puede_cambiar ? formulario(r.general, 'Guardar la marca') : r.general ? vista(r.general) : ''}
			${r.propias?.length ? `<p class="promo-lugar">Con marca propia: ${esc(r.propias.map((x) => x.nombre).join(', '))}.</p>` : ''}`;
		if (r.puede_cambiar) conectar(r.general, null, guardado);
		return;
	}

	// ── la marca de una promoción
	const promo = sitio.promocion;
	const general = r.puede_cambiar_general && sitio.enlaceGeneral ? ` <a href="${esc(sitio.enlaceGeneral)}">Cambiar la marca de la promotora</a>` : '';
	if (r.propia) {
		caja.innerHTML = `<h2>Marca</h2>
			<p class="ayuda"><strong>${esc(promo.nombre)} tiene su propia marca</strong>: la de la promotora no se usa en esta promoción.${general}</p>
			${avisoHtml}${cuando(r.propia)}
			${r.puede_cambiar ? formulario(r.propia, 'Guardar la marca de esta promoción') : vista(r.propia)}
			${r.puede_cambiar ? `<div class="acciones"><button class="enlace" type="button" data-quitar-propia>Volver a la marca de la promotora</button></div>` : ''}`;
		if (r.puede_cambiar) {
			conectar(r.propia, promo.id, guardado);
			caja.querySelector('[data-quitar-propia]')!.addEventListener('click', async () => {
				if (!confirm(`¿Quitar la marca propia de ${promo.nombre}? Volverá a usar la de la promotora en la próxima versión.`)) return;
				const { error: e } = await d.sb.rpc('quitar_marca_propia', { p_promocion: promo.id });
				if (e) {
					caja.querySelector('.marca-form .error')!.textContent = d.traducir(e);
					return;
				}
				await repintar('✓ Esta promoción vuelve a usar la marca de la promotora (en la próxima versión).');
			});
		}
		return;
	}
	caja.innerHTML = `<h2>Marca</h2>
		<p class="ayuda">${esc(promo.nombre)} usa la marca de la promotora.${general}</p>
		${avisoHtml}
		${r.general ? vista(r.general) : '<p class="vacio">La promotora todavía no ha puesto su marca: se usa la que preparó el equipo de MUNE.</p>'}
		${r.puede_cambiar ? `<div class="acciones"><button class="boton secundario" type="button" data-poner-propia>Poner una marca propia en esta promoción</button></div>
			<p class="ayuda">Por ejemplo, si el residencial tiene su propio logo. Sustituye entera a la marca de la promotora, solo en esta promoción.</p>
			<div data-propia hidden></div>` : ''}`;
	caja.querySelector('[data-poner-propia]')?.addEventListener('click', (ev) => {
		(ev.currentTarget as HTMLElement).closest<HTMLElement>('.acciones')!.hidden = true;
		const zona = caja.querySelector<HTMLElement>('[data-propia]')!;
		zona.hidden = false;
		zona.innerHTML = formulario(r.general, 'Guardar la marca de esta promoción');
		conectar(r.general, promo.id, guardado);
	});
}

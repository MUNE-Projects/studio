// Sección «Catálogo y precios» de la pestaña Personalización (paso 8a,
// 029_catalogo_promotora.sql). El mismo archivo está en MUNE Studio (app/src)
// y en MUNE Portal (portal/src): si cambias uno, copia el otro.
//
// La promotora (y MUNE, como ayuda) ajusta sin versión nueva el nombre, la
// descripción y el precio de cada opción, si se ofrece y en qué tipologías.
// Los cambios se aplican al momento. Cuando un pack se abre a los compradores,
// sus precios quedan fijos para siempre. Una opción con un aspecto nuevo se
// pide a MUNE, que la añade al 3D en una versión nueva.

import type { SupabaseClient } from '@supabase/supabase-js';

interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	fecha: (iso: string) => string;
	traducir: (e: unknown) => string;
	/** «administradora» (MUNE Studio) además atiende las opciones pedidas. */
	modo: 'promotora' | 'administradora';
}
interface Promo { id: string; nombre: string }
interface Opcion { id: string; nombre: string; detalle?: string; precio: number; ofrecida?: boolean }
interface Categoria { id: string; nombre: string; opciones: Opcion[] }
interface Pack { id: string; titulo: string; desde: string; hasta: string; categorias: string[]; estado?: string }
interface Tipologia { id: string; opciones: Record<string, string[]> }
interface Pedida { id: number; categoria: string | null; nombre: string; descripcion: string | null; precio: number | null; pedido_en: string; estado: 'pendiente' | 'hecha' | 'descartada'; nota: string | null }
interface Datos {
	hoy: string;
	catalogo: { categorias: Categoria[] } | null;
	packs: Pack[];
	tipologias: Tipologia[];
	tipologias_version: Tipologia[];
	lanzadas: string[];
	cambios: { categoria: string; opcion: string; actualizado_en: string; por: string }[];
	pedidas: Pedida[];
}
/** Lo que se edita de cada opción. */
interface Valores { nombre: string; detalle: string; precio: number; ofrecida: boolean; tipologias: string[] }

const euros = (n: number) => {
	const [entero, dec] = Number(n).toFixed(2).split('.');
	return `${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec === '00' ? '' : `,${dec}`} €`;
};
const nombreTipologia = (id: string) => `Tipología ${id.toUpperCase()}`;
const ESTADO_PEDIDA = { pendiente: 'Pendiente', hecha: 'Añadida', descartada: 'Descartada' } as const;

export async function pintarCatalogo(caja: HTMLElement, d: Dependencias, p: Promo, aviso = ''): Promise<void> {
	const { esc } = d;
	const { data, error } = await d.sb.rpc('catalogo_de_promocion', { p_promocion: p.id });
	if (error) {
		caja.innerHTML = `<h2>Catálogo y precios</h2><p class="error">${esc(d.traducir(error))}</p>`;
		return;
	}
	const datos = data as Datos;
	if (!datos.catalogo) {
		caja.innerHTML = '<h2>Catálogo y precios</h2><p class="vacio">Todavía no hay catálogo: aparecerá cuando MUNE prepare la próxima versión de la promoción.</p>';
		return;
	}
	const tipologias = datos.tipologias_version.map((t) => t.id);
	const packDe = (cat: string) => datos.packs.find((x) => x.categorias.includes(cat));
	const lanzada = (cat: string) => datos.lanzadas.includes(cat);
	/** Tipologías en las que se ofrece ahora una opción; y si es la incluida de serie en alguna. */
	const enTipologias = (cat: string, op: string) => datos.tipologias.filter((t) => t.opciones?.[cat]?.includes(op)).map((t) => t.id);
	const incluida = (cat: string, op: string) => datos.tipologias_version.some((t) => t.opciones?.[cat]?.[0] === op);
	// solo las categorías que alguna tipología puede elegir (con más de una opción)
	const categorias = datos.catalogo.categorias.filter((c) => datos.tipologias_version.some((t) => (t.opciones?.[c.id]?.length ?? 0) > 1));
	const original = new Map<string, Valores>();
	for (const c of categorias) for (const o of c.opciones) original.set(`${c.id}|${o.id}`, {
		nombre: o.nombre, detalle: o.detalle ?? '', precio: Number(o.precio ?? 0), ofrecida: o.ofrecida !== false, tipologias: enTipologias(c.id, o.id),
	});
	const ultimo = datos.cambios[0];

	const cabeceraCategoria = (c: Categoria) => {
		const pk = packDe(c.id);
		const cuando = pk ? `${esc(pk.titulo)} · ` : '';
		return lanzada(c.id)
			? `<span class="promo-lugar">${cuando}abierto a los compradores: <strong>sus precios ya no cambian</strong></span>`
			: `<span class="promo-lugar">${cuando}${pk ? `se abre el ${esc(d.fecha(pk.desde))}: ` : ''}puedes cambiar los precios hasta entonces</span>`;
	};
	const fila = (c: Categoria, o: Opcion) => {
		const k = `${c.id}|${o.id}`;
		const v = original.get(k)!;
		const fija = lanzada(c.id);
		const serie = incluida(c.id, o.id);
		return `<tr data-opcion="${esc(k)}">
			<td><input name="nombre" value="${esc(v.nombre)}" maxlength="80" aria-label="Nombre de la opción" required>${serie ? '<br><span class="promo-lugar">Incluida de serie</span>' : ''}</td>
			<td><input name="detalle" value="${esc(v.detalle)}" maxlength="300" aria-label="Descripción" placeholder="Opcional"></td>
			<td class="precio">${fija
				? `<span title="El pack ya está abierto: el precio no cambia">${v.precio ? esc(euros(v.precio)) : 'Incluido'}</span><input name="precio" type="hidden" value="${v.precio}" disabled>`
				: `<input name="precio" type="number" min="0" max="10000000" step="0.01" value="${v.precio}" aria-label="Precio en euros">`}</td>
			<td><label class="interruptor"><input name="ofrecida" type="checkbox"${v.ofrecida ? ' checked' : ''}${serie ? ' disabled title="La opción incluida de serie no se puede quitar"' : ''}> Se ofrece</label></td>
			${tipologias.length > 1 ? `<td>${tipologias.map((t) => `<label class="interruptor"><input type="checkbox" name="tipologia" value="${esc(t)}"${v.tipologias.includes(t) ? ' checked' : ''}${serie && datos.tipologias_version.find((x) => x.id === t)?.opciones?.[c.id]?.[0] === o.id ? ' disabled' : ''}> ${esc(nombreTipologia(t))}</label>`).join('<br>')}</td>` : ''}
		</tr>`;
	};

	caja.innerHTML = `
		<h2>Catálogo y precios</h2>
		<p class="ayuda">Lo que ven los compradores al personalizar su vivienda. Puedes cambiar el nombre, la descripción y el precio de cada opción, dejar de ofrecerla o elegir en qué tipologías se ofrece. Los cambios se aplican <strong>al momento</strong>. Cuando un pack se abre a los compradores, <strong>sus precios quedan fijos</strong>. Si dejas de ofrecer una opción, quien ya la eligió la conserva.</p>
		${ultimo ? `<p class="promo-versiones">Último cambio: ${esc(d.fecha(ultimo.actualizado_en))}, por ${esc(ultimo.por)}.</p>` : ''}
		${aviso ? `<p class="aviso" role="status">${esc(aviso)}</p>` : ''}
		<form data-catalogo-form>
			${categorias.map((c) => `
				<h3>${esc(c.nombre)}</h3>
				${cabeceraCategoria(c)}
				<div class="tabla catalogo"><table>
					<thead><tr><th>Opción</th><th>Descripción</th><th>Precio (€)</th><th>Se ofrece</th>${tipologias.length > 1 ? '<th>Tipologías</th>' : ''}</tr></thead>
					<tbody>${c.opciones.map((o) => fila(c, o)).join('')}</tbody>
				</table></div>`).join('')}
			<div class="confirmar" data-confirmar hidden></div>
			<div class="acciones"><button class="boton" type="submit" disabled>Guardar cambios</button></div>
			<p class="error" role="alert"></p>
		</form>

		<h3 class="separado">Opciones nuevas</h3>
		<p class="ayuda">Una opción con un aspecto nuevo (otro suelo, otro acabado) hay que crearla en el 3D. Pídela aquí y súbenos la ficha o una foto en Documentación: el equipo de MUNE la añade en la próxima versión. Aquí verás cuándo está añadida.</p>
		${datos.pedidas.length ? `<ul class="lista-pedidas">${datos.pedidas.map((x) => `<li data-pedida="${x.id}">
			<strong>${esc(x.nombre)}</strong>${x.categoria ? ` · ${esc(categorias.find((c) => c.id === x.categoria)?.nombre ?? x.categoria)}` : ''}${x.precio != null ? ` · ${esc(euros(x.precio))}` : ''}
			· <span class="estado ${x.estado === 'hecha' ? 'al-dia' : x.estado === 'pendiente' ? 'pendiente' : ''}">${ESTADO_PEDIDA[x.estado]}</span>
			<span class="promo-lugar">pedida el ${esc(d.fecha(x.pedido_en))}</span>
			${x.descripcion ? `<br><span class="promo-lugar">${esc(x.descripcion)}</span>` : ''}
			${x.nota ? `<br><span class="promo-lugar">Nota de MUNE: ${esc(x.nota)}</span>` : ''}
			${d.modo === 'administradora' && x.estado === 'pendiente' ? `<br><button class="enlace" type="button" data-atender="hecha">Marcar como añadida…</button> · <button class="enlace" type="button" data-atender="descartada">Descartar…</button>` : ''}
		</li>`).join('')}</ul>` : ''}
		<form class="pedir-opcion" data-pedir>
			<label>Categoría<select name="categoria" required><option value="" disabled selected>Elige…</option>${categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}<option value="otra">Otra</option></select></label>
			<label>Nombre<input name="nombre" maxlength="80" required placeholder="Por ejemplo: Roble ahumado"></label>
			<label>Precio orientativo (€)<input name="precio" type="number" min="0" step="0.01" placeholder="Opcional"></label>
			<label>Descripción<input name="descripcion" maxlength="1000" placeholder="Marca, modelo, dónde va…"></label>
			<div class="acciones"><button class="boton secundario" type="submit">Pedir la opción a MUNE</button></div>
			<p class="error" role="alert"></p>
		</form>`;

	// ── cambios del catálogo: se calculan comparando con lo de ahora
	const form = caja.querySelector<HTMLFormElement>('[data-catalogo-form]')!;
	const guardar = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
	const confirmar = form.querySelector<HTMLElement>('[data-confirmar]')!;
	const leer = () => {
		const cambios: Record<string, unknown>[] = [];
		const resumen = { precios: 0, nombres: 0, quitadas: 0, vueltas: 0, tipologias: 0 };
		form.querySelectorAll<HTMLTableRowElement>('tr[data-opcion]').forEach((tr) => {
			const [categoria, opcion] = tr.dataset.opcion!.split('|');
			const v = original.get(tr.dataset.opcion!)!;
			const campo = (n: string) => tr.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
			const c: Record<string, unknown> = { categoria, opcion };
			const nombre = campo('nombre').value.trim(), detalle = campo('detalle').value.trim();
			const precio = Math.round(Number(campo('precio').value || 0) * 100) / 100;
			const ofrecida = campo('ofrecida').checked;
			const tips = [...tr.querySelectorAll<HTMLInputElement>('[name="tipologia"]')].filter((x) => x.checked).map((x) => x.value);
			if (nombre && nombre !== v.nombre) { c.nombre = nombre; resumen.nombres++; }
			if (detalle !== v.detalle) { c.detalle = detalle; resumen.nombres++; }
			if (!campo('precio').disabled && precio !== v.precio) { c.precio = precio; resumen.precios++; }
			if (ofrecida !== v.ofrecida) { c.ofrecida = ofrecida; resumen[ofrecida ? 'vueltas' : 'quitadas']++; }
			if (tipologias.length > 1 && tips.sort().join() !== [...v.tipologias].sort().join()) { c.tipologias = tips; resumen.tipologias++; }
			if (Object.keys(c).length > 2) cambios.push(c);
		});
		return { cambios, resumen };
	};
	const refrescar = () => {
		guardar.disabled = leer().cambios.length === 0;
		confirmar.hidden = true;
	};
	form.addEventListener('input', refrescar);
	form.addEventListener('change', refrescar);
	form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		const { cambios, resumen } = leer();
		if (!cambios.length) return;
		const partes = [
			resumen.precios && `cambiar ${resumen.precios} precio${resumen.precios === 1 ? '' : 's'}`,
			resumen.nombres && `cambiar ${resumen.nombres} nombre${resumen.nombres === 1 ? '' : 's'} o descripci${resumen.nombres === 1 ? 'ón' : 'ones'}`,
			resumen.quitadas && `dejar de ofrecer ${resumen.quitadas} opci${resumen.quitadas === 1 ? 'ón' : 'ones'}`,
			resumen.vueltas && `volver a ofrecer ${resumen.vueltas} opci${resumen.vueltas === 1 ? 'ón' : 'ones'}`,
			resumen.tipologias && `cambiar las tipologías de ${resumen.tipologias} opci${resumen.tipologias === 1 ? 'ón' : 'ones'}`,
		].filter(Boolean);
		confirmar.hidden = false;
		confirmar.innerHTML = `<p>Vas a ${esc(partes.join(', '))}. Los compradores lo verán <strong>al momento</strong>.${resumen.precios ? ' Recuerda que, cuando su pack se abra, estos precios ya no se podrán cambiar.' : ''}</p>
			<div class="acciones"><button class="boton" type="button" data-si>Confirmar y aplicar</button><button class="enlace" type="button" data-no>Seguir revisando</button></div>`;
		confirmar.querySelector('[data-no]')!.addEventListener('click', () => { confirmar.hidden = true; });
		confirmar.querySelector<HTMLButtonElement>('[data-si]')!.addEventListener('click', async (e) => {
			(e.currentTarget as HTMLButtonElement).disabled = true;
			const { error: err } = await d.sb.rpc('guardar_catalogo', { p_promocion: p.id, p_cambios: cambios });
			if (err) {
				form.querySelector('.error')!.textContent = d.traducir(err);
				confirmar.hidden = true;
				return;
			}
			await pintarCatalogo(caja, d, p, '✓ Cambios aplicados: los compradores ya ven el catálogo actualizado.');
		});
	});

	// ── pedir una opción nueva
	const pedir = caja.querySelector<HTMLFormElement>('[data-pedir]')!;
	pedir.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		const f = new FormData(pedir);
		const boton = pedir.querySelector<HTMLButtonElement>('button[type=submit]')!;
		boton.disabled = true;
		const precio = String(f.get('precio') ?? '').trim();
		const { error: err } = await d.sb.rpc('pedir_opcion', {
			p_promocion: p.id, p_categoria: f.get('categoria') === 'otra' ? '' : String(f.get('categoria') ?? ''), p_nombre: String(f.get('nombre') ?? ''),
			p_descripcion: String(f.get('descripcion') ?? ''), p_precio: precio ? Number(precio) : null,
		});
		if (err) {
			pedir.querySelector('.error')!.textContent = d.traducir(err);
			boton.disabled = false;
			return;
		}
		await pintarCatalogo(caja, d, p, '✓ Opción pedida. Aquí verás cuándo la añade el equipo de MUNE.');
	});

	// ── MUNE Studio: atender lo pedido
	caja.querySelectorAll<HTMLButtonElement>('[data-atender]').forEach((b) => b.addEventListener('click', async () => {
		const li = b.closest<HTMLElement>('[data-pedida]')!;
		const estado = b.dataset.atender!;
		const nota = prompt(estado === 'hecha' ? 'Nota para la promotora (por ejemplo: «Añadida en la v18»):' : 'Motivo para la promotora:') ?? null;
		if (nota === null) return;
		const { error: err } = await d.sb.rpc('atender_opcion', { p_id: Number(li.dataset.pedida), p_estado: estado, p_nota: nota });
		await pintarCatalogo(caja, d, p, err ? '' : estado === 'hecha' ? '✓ Marcada como añadida.' : '✓ Descartada.');
		if (err) caja.querySelector('.error')!.textContent = d.traducir(err);
	}));
}

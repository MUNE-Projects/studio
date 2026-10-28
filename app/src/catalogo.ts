// Sección «Catálogo y precios» de la pestaña Personalización (paso 8a,
// 029_catalogo_promotora.sql). El mismo archivo está en MUNE Studio (app/src)
// y en MUNE Portal (portal/src): si cambias uno, copia el otro.
//
// La promotora (y MUNE, como ayuda) ajusta sin versión nueva los packs
// (periodos de elección: qué categorías van en cada uno y sus fechas) y el
// nombre, la descripción y el precio de cada opción, si se ofrece y en qué
// tipologías. Los cambios se aplican al momento. Cuando un pack se abre a los
// compradores, sus precios y sus categorías quedan fijos. Una opción con un
// aspecto nuevo se pide a MUNE (con foto o ficha), que la añade al 3D en una
// versión nueva.

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
interface Pack { id: string; titulo: string; descripcion?: string; desde: string; hasta: string; categorias: string[]; estado?: string }
interface Tipologia { id: string; opciones: Record<string, string[]> }
interface Pedida { id: number; categoria: string | null; nombre: string; descripcion: string | null; precio: number | null; pedido_en: string; estado: 'pendiente' | 'hecha' | 'descartada'; nota: string | null; archivos: { ruta: string; nombre: string }[] }
interface Datos {
	hoy: string;
	catalogo: { categorias: Categoria[] } | null;
	packs: Pack[];
	tipologias: Tipologia[];
	tipologias_version: Tipologia[];
	lanzadas: string[];
	cambios: { categoria: string; opcion: string; actualizado_en: string; por: string }[];
	packs_actualizado: { en: string; por: string } | null;
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
const MAX_ARCHIVO = 15 * 1024 * 1024;
/** Estado de un pack hoy (como en Supabase). */
function estadoPack(p: Pack, hoy: string): 'proximamente' | 'disponible' | 'finalizado' {
	if (p.estado === 'disponible' || p.estado === 'proximamente' || p.estado === 'finalizado') return p.estado;
	return hoy < p.desde ? 'proximamente' : hoy > p.hasta ? 'finalizado' : 'disponible';
}
const limpio = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80);

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
	const todasCategorias = datos.catalogo.categorias;

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

		<h3>Packs y fechas</h3>
		<p class="ayuda">Cada pack es un periodo en el que los compradores eligen las categorías que lleva. Puedes decidir qué categorías van en cada pack, sus títulos y sus fechas, y crear packs nuevos. Cuando un pack se abre, ya no cambian su apertura ni sus categorías; puedes cambiar su cierre mientras esté abierto. Las categorías que no estén en ningún pack se pueden elegir siempre.</p>
		${datos.packs_actualizado ? `<p class="promo-versiones">Packs cambiados el ${esc(d.fecha(datos.packs_actualizado.en))}, por ${esc(datos.packs_actualizado.por)}.</p>` : ''}
		<form data-packs-form>
			<div class="lista-packs" data-lista-packs></div>
			<p class="promo-lugar" data-sin-pack></p>
			<div class="acciones"><button class="boton secundario" type="button" data-nuevo-pack>Añadir un pack</button><button class="boton" type="submit" disabled>Guardar los packs</button></div>
			<div class="confirmar" data-confirmar-packs hidden></div>
			<p class="error" role="alert"></p>
		</form>

		<h3 class="separado">Opciones y precios</h3>
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
		<p class="ayuda">Una opción con un aspecto nuevo (otro suelo, otro acabado) hay que crearla en el 3D. Pídela aquí, con una foto o su ficha si la tienes: el equipo de MUNE la añade en la próxima versión. Aquí verás cuándo está añadida.</p>
		${datos.pedidas.length ? `<ul class="lista-pedidas">${datos.pedidas.map((x) => `<li data-pedida="${x.id}">
			<strong>${esc(x.nombre)}</strong>${x.categoria ? ` · ${esc(categorias.find((c) => c.id === x.categoria)?.nombre ?? x.categoria)}` : ''}${x.precio != null ? ` · ${esc(euros(x.precio))}` : ''}
			· <span class="estado ${x.estado === 'hecha' ? 'al-dia' : x.estado === 'pendiente' ? 'pendiente' : ''}">${ESTADO_PEDIDA[x.estado]}</span>
			<span class="promo-lugar">pedida el ${esc(d.fecha(x.pedido_en))}</span>
			${x.descripcion ? `<br><span class="promo-lugar">${esc(x.descripcion)}</span>` : ''}
			${x.archivos?.length ? `<br>${x.archivos.map((a, i) => `<button class="enlace" type="button" data-archivo="${i}">${esc(a.nombre || 'Archivo')}</button>`).join(' · ')}` : ''}
			${x.nota ? `<br><span class="promo-lugar">Nota de MUNE: ${esc(x.nota)}</span>` : ''}
			${d.modo === 'administradora' && x.estado === 'pendiente' ? `<br><button class="enlace" type="button" data-atender="hecha">Marcar como añadida…</button> · <button class="enlace" type="button" data-atender="descartada">Descartar…</button>` : ''}
		</li>`).join('')}</ul>` : ''}
		<form class="pedir-opcion" data-pedir>
			<label>Categoría<select name="categoria" required><option value="" disabled selected>Elige…</option>${categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}<option value="otra">Otra</option></select></label>
			<label>Nombre<input name="nombre" maxlength="80" required placeholder="Por ejemplo: Roble ahumado"></label>
			<label>Precio orientativo (€)<input name="precio" type="number" min="0" step="0.01" placeholder="Opcional"></label>
			<label>Descripción<input name="descripcion" maxlength="1000" placeholder="Marca, modelo, dónde va…"></label>
			<label class="archivos">Foto o ficha (opcional, hasta 5; imágenes o PDF de 15 MB como mucho)<input name="archivos" type="file" accept="image/*,application/pdf" multiple></label>
			<div class="acciones"><button class="boton secundario" type="submit">Pedir la opción a MUNE</button></div>
			<p class="error" role="alert"></p>
		</form>`;

	// ── packs: una tarjeta por pack; cada categoría solo puede estar en uno
	const formPacks = caja.querySelector<HTMLFormElement>('[data-packs-form]')!;
	const listaPacks = formPacks.querySelector<HTMLElement>('[data-lista-packs]')!;
	const guardarPacks = formPacks.querySelector<HTMLButtonElement>('button[type=submit]')!;
	const confirmarPacks = formPacks.querySelector<HTMLElement>('[data-confirmar-packs]')!;
	const tarjeta = (pk: Pack, nuevo = false) => {
		const estado = nuevo ? 'proximamente' : estadoPack(pk, datos.hoy);
		const fijo = estado !== 'proximamente';
		const nota = nuevo ? 'Pack nuevo' : estado === 'disponible' ? `Abierto desde el ${esc(d.fecha(pk.desde))}: ya no cambian su apertura ni sus categorías`
			: estado === 'finalizado' ? `Terminado el ${esc(d.fecha(pk.hasta))}: ya no cambia` : `Se abre el ${esc(d.fecha(pk.desde))}`;
		return `<fieldset class="pack" data-pack="${esc(pk.id)}" data-estado="${estado}"${nuevo ? ' data-nuevo' : ''}>
			<p class="promo-lugar">${nota}</p>
			<label>Título<input name="titulo" value="${esc(pk.titulo)}" maxlength="80" required${estado === 'finalizado' ? ' disabled' : ''}></label>
			<label>Descripción<input name="descripcion" value="${esc(pk.descripcion ?? '')}" maxlength="300" placeholder="Opcional"${estado === 'finalizado' ? ' disabled' : ''}></label>
			<div class="fechas">
				<label>Se abre<input name="desde" type="date" value="${esc(pk.desde)}" min="${esc(datos.hoy)}" required${fijo ? ' disabled' : ''}></label>
				<label>Se cierra<input name="hasta" type="date" value="${esc(pk.hasta)}" required${estado === 'finalizado' ? ' disabled' : ''}${estado === 'disponible' ? ` min="${esc(datos.hoy)}"` : ''}></label>
			</div>
			<div class="categorias-pack">${todasCategorias.map((c) => `<label class="interruptor"><input type="checkbox" name="categoria" value="${esc(c.id)}"${pk.categorias.includes(c.id) ? ' checked' : ''}${fijo || (lanzada(c.id) && !pk.categorias.includes(c.id)) ? ' disabled' : ''}> ${esc(c.nombre)}</label>`).join('')}</div>
			${fijo ? '' : '<button class="enlace" type="button" data-quitar-pack>Quitar este pack</button>'}
		</fieldset>`;
	};
	listaPacks.innerHTML = datos.packs.map((pk) => tarjeta(pk)).join('');
	const leerPacks = (): Pack[] => [...listaPacks.querySelectorAll<HTMLFieldSetElement>('fieldset.pack')].map((f) => {
		const v = (n: string) => f.querySelector<HTMLInputElement>(`[name="${n}"]`)!.value.trim();
		return { id: f.dataset.pack!, titulo: v('titulo'), descripcion: v('descripcion'), desde: v('desde'), hasta: v('hasta'),
			categorias: [...f.querySelectorAll<HTMLInputElement>('[name="categoria"]')].filter((x) => x.checked).map((x) => x.value) };
	});
	const firma = (lista: Pack[]) => JSON.stringify(lista.map((x) => [x.id, x.titulo, x.descripcion ?? '', x.desde, x.hasta, [...x.categorias].sort()]));
	const packsAntes = firma(datos.packs);
	const sinPack = () => {
		const usadas = new Set(leerPacks().flatMap((x) => x.categorias));
		const libres = todasCategorias.filter((c) => !usadas.has(c.id)).map((c) => c.nombre);
		formPacks.querySelector<HTMLElement>('[data-sin-pack]')!.textContent = libres.length ? `Sin pack (se pueden elegir siempre): ${libres.join(', ')}.` : '';
	};
	const refrescarPacks = () => {
		guardarPacks.disabled = firma(leerPacks()) === packsAntes;
		confirmarPacks.hidden = true;
		sinPack();
	};
	sinPack();
	formPacks.addEventListener('input', refrescarPacks);
	formPacks.addEventListener('change', (ev) => {
		// una categoría marcada en un pack se desmarca en los demás
		const t = ev.target as HTMLInputElement;
		if (t.name === 'categoria' && t.checked) {
			listaPacks.querySelectorAll<HTMLInputElement>(`[name="categoria"][value="${CSS.escape(t.value)}"]`).forEach((x) => { if (x !== t && !x.disabled) x.checked = false; });
		}
		refrescarPacks();
	});
	listaPacks.addEventListener('click', (ev) => {
		const b = (ev.target as HTMLElement).closest('[data-quitar-pack]');
		if (!b) return;
		b.closest('fieldset')!.remove();
		refrescarPacks();
	});
	formPacks.querySelector('[data-nuevo-pack]')!.addEventListener('click', () => {
		const usados = new Set(leerPacks().map((x) => x.id));
		let n = usados.size + 1;
		while (usados.has(`pack-${n}`)) n++;
		listaPacks.insertAdjacentHTML('beforeend', tarjeta({ id: `pack-${n}`, titulo: `Pack ${n}`, desde: '', hasta: '', categorias: [] }, true));
		listaPacks.lastElementChild?.querySelector<HTMLInputElement>('[name="titulo"]')?.focus();
		refrescarPacks();
	});
	formPacks.addEventListener('submit', (ev) => {
		ev.preventDefault();
		if (!formPacks.reportValidity()) return;
		const packs = leerPacks();
		const abiertosHoy = packs.filter((x) => x.desde === datos.hoy && !datos.packs.some((y) => y.id === x.id && y.desde === x.desde));
		confirmarPacks.hidden = false;
		confirmarPacks.innerHTML = `<p>Vas a guardar ${packs.length} pack${packs.length === 1 ? '' : 's'}. Los compradores verán las fechas nuevas <strong>al momento</strong>.${abiertosHoy.length ? ' Un pack que se abre hoy queda abierto ya: sus precios y sus categorías quedarán fijos.' : ''}</p>
			<div class="acciones"><button class="boton" type="button" data-si>Confirmar y aplicar</button><button class="enlace" type="button" data-no>Seguir revisando</button></div>`;
		confirmarPacks.querySelector('[data-no]')!.addEventListener('click', () => { confirmarPacks.hidden = true; });
		confirmarPacks.querySelector<HTMLButtonElement>('[data-si]')!.addEventListener('click', async (e) => {
			(e.currentTarget as HTMLButtonElement).disabled = true;
			const { error: err } = await d.sb.rpc('guardar_packs', { p_promocion: p.id, p_packs: packs });
			if (err) {
				formPacks.querySelector('.error')!.textContent = d.traducir(err);
				confirmarPacks.hidden = true;
				return;
			}
			await pintarCatalogo(caja, d, p, '✓ Packs guardados: los compradores ya ven las fechas nuevas.');
		});
	});

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
		const fallo = (t: string) => {
			pedir.querySelector('.error')!.textContent = t;
			boton.disabled = false;
		};
		const ficheros = [...(pedir.querySelector<HTMLInputElement>('[name="archivos"]')!.files ?? [])];
		if (ficheros.length > 5) return fallo('Como mucho, cinco archivos.');
		if (ficheros.some((x) => x.size > MAX_ARCHIVO)) return fallo('Cada archivo puede ocupar 15 MB como mucho.');
		if (ficheros.some((x) => !/^image\//.test(x.type) && x.type !== 'application/pdf')) return fallo('Solo fotos o PDF.');
		const archivos: { ruta: string; nombre: string }[] = [];
		if (ficheros.length) {
			const { data: pr } = await d.sb.from('promociones').select('promotora_id').eq('id', p.id).single();
			for (const x of ficheros) {
				const ruta = `${pr?.promotora_id}/${p.id}/opciones/${Date.now()}-${limpio(x.name)}`;
				const { error: e } = await d.sb.storage.from('documentos').upload(ruta, x, { contentType: x.type, upsert: false });
				if (e) return fallo(`No se ha podido subir «${x.name}». ${d.traducir(e)}`);
				archivos.push({ ruta, nombre: x.name });
			}
		}
		const { error: err } = await d.sb.rpc('pedir_opcion', {
			p_promocion: p.id, p_categoria: f.get('categoria') === 'otra' ? '' : String(f.get('categoria') ?? ''), p_nombre: String(f.get('nombre') ?? ''),
			p_descripcion: String(f.get('descripcion') ?? ''), p_precio: precio ? Number(precio) : null, p_archivos: archivos,
		});
		if (err) {
			pedir.querySelector('.error')!.textContent = d.traducir(err);
			boton.disabled = false;
			return;
		}
		await pintarCatalogo(caja, d, p, '✓ Opción pedida. Aquí verás cuándo la añade el equipo de MUNE.');
	});

	// ── ver un archivo adjunto (enlace temporal de un minuto)
	caja.querySelectorAll<HTMLButtonElement>('[data-archivo]').forEach((b) => b.addEventListener('click', async () => {
		const pedida = datos.pedidas.find((x) => x.id === Number(b.closest<HTMLElement>('[data-pedida]')!.dataset.pedida))!;
		const a = pedida.archivos[Number(b.dataset.archivo)];
		const { data: u, error: e } = await d.sb.storage.from('documentos').createSignedUrl(a.ruta, 60);
		if (e || !u) {
			b.textContent = 'No se ha podido abrir';
			return;
		}
		window.open(u.signedUrl, '_blank', 'noopener');
	}));

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

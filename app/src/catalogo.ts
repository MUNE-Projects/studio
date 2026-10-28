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
// versión nueva. Mientras está «En preparación» ya se mete en un pack, se le
// ponen fechas, se cambia o se retira; los compradores la ven cuando está lista.

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
interface Pack { id: string; titulo: string; descripcion?: string; desde: string; hasta: string; categorias: string[]; estado?: string; individual?: boolean }
interface Tipologia { id: string; opciones: Record<string, string[]> }
interface Pedida { id: number; categoria: string | null; categoria_nueva: string | null; nombre: string; descripcion: string | null; precio: number | null; pedido_en: string; estado: 'pendiente' | 'hecha' | 'descartada'; nota: string | null; archivos: { ruta: string; nombre: string }[] }
interface Datos {
	hoy: string;
	catalogo: { categorias: Categoria[] } | null;
	packs: Pack[];
	tipologias: Tipologia[];
	tipologias_version: Tipologia[];
	lanzadas: string[];
	/** Categorías nuevas en preparación: { id: nombre }. */
	en_preparacion: Record<string, string>;
	cambios: { categoria: string; opcion: string; actualizado_en: string; por: string }[];
	packs_actualizado: { en: string; por: string } | null;
	pedidas: Pedida[];
}
/** Lo que se edita de cada opción. */
interface Valores { nombre: string; detalle: string; precio: number; ofrecida: boolean; tipologias: string[] }
/** Una categoría en las listas: del catálogo o nueva, en preparación. */
interface Seccion { id: string; nombre: string; nueva: boolean; opciones: Opcion[]; pedidas: Pedida[] }

const euros = (n: number) => {
	const [entero, dec] = Number(n).toFixed(2).split('.');
	return `${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec === '00' ? '' : `,${dec}`} €`;
};
const nombreTipologia = (id: string) => `Tipología ${id.toUpperCase()}`;
const ESTADO_PEDIDA = { pendiente: 'En preparación', hecha: 'Añadida', descartada: 'Descartada' } as const;
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
	datos.catalogo ??= { categorias: [] };
	datos.en_preparacion ??= {};
	const enPreparacion = datos.pedidas.filter((x) => x.estado === 'pendiente');
	const vacio = datos.catalogo.categorias.length === 0 && enPreparacion.length === 0;
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
	/** Las del catálogo y, detrás, las nuevas que aún están en preparación. */
	const todasCategorias: { id: string; nombre: string }[] = [...datos.catalogo.categorias,
		...Object.entries(datos.en_preparacion).map(([id, nombre]) => ({ id, nombre }))];
	const nombreDe = (id: string | null) => todasCategorias.find((c) => c.id === id)?.nombre ?? id ?? 'Otra';
	const pedidasDe = (cat: string) => enPreparacion.filter((x) => x.categoria === cat);
	/** Lo que se edita: categorías que se pueden elegir y las que tienen algo en preparación. */
	const secciones: Seccion[] = [
		...datos.catalogo.categorias.filter((c) => categorias.includes(c) || pedidasDe(c.id).length)
			.map((c) => ({ id: c.id, nombre: c.nombre, nueva: false, opciones: categorias.includes(c) ? c.opciones : [], pedidas: pedidasDe(c.id) })),
		...Object.entries(datos.en_preparacion).map(([id, nombre]) => ({ id, nombre, nueva: true, opciones: [], pedidas: pedidasDe(id) })),
	];

	const cabeceraCategoria = (c: Seccion) => {
		const pk = packDe(c.id);
		const cuando = pk ? `${esc(pk.titulo)} · ` : '';
		if (c.nueva) return `<span class="promo-lugar">${cuando}<span class="estado pendiente">En preparación</span> los compradores la verán cuando el equipo de MUNE la prepare</span>`;
		return lanzada(c.id)
			? `<span class="promo-lugar">${cuando}abierto a los compradores: <strong>sus precios ya no cambian</strong></span>`
			: `<span class="promo-lugar">${cuando}${pk ? `se abre el ${esc(d.fecha(pk.desde))}: ` : ''}puedes cambiar los precios hasta entonces</span>`;
	};
	/** Una opción en preparación: todo se puede cambiar (los compradores aún no la ven) o retirar. */
	const filaPedida = (x: Pedida) => `<tr data-pedida-fila="${x.id}">
			<td><input name="nombre" value="${esc(x.nombre)}" maxlength="80" aria-label="Nombre de la opción" required><br><span class="estado pendiente">En preparación</span></td>
			<td><input name="detalle" value="${esc(x.descripcion ?? '')}" maxlength="1000" aria-label="Descripción" placeholder="Opcional"></td>
			<td class="precio"><input name="precio" type="number" min="0" max="10000000" step="0.01" value="${x.precio ?? 0}" aria-label="Precio en euros"></td>
			<td><label class="interruptor"><input name="retirar" type="checkbox"> Retirar</label></td>
			${tipologias.length > 1 ? '<td><span class="promo-lugar">Se decide al prepararla</span></td>' : ''}
		</tr>`;
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

		${vacio ? '<p class="vacio">Todavía no hay personalizaciones ni mejoras. Añade las primeras abajo: aparecerán aquí enseguida para ponerles fechas, packs y precio.</p>' : ''}
		<div${vacio ? ' hidden' : ''}>
		<h3>Fechas de elección</h3>
		<p class="ayuda">Cada categoría se elige <strong>por separado</strong>, con su propia apertura y cierre, o <strong>dentro de un pack</strong>: una ficha con título y fechas que agrupa las categorías que quieras (un solo pack con todas es «todo junto»). Cuando se abre una categoría o un pack, ya no cambian su apertura ni lo que agrupa; mientras esté abierto, puedes cambiar su cierre.</p>
		${datos.packs_actualizado ? `<p class="promo-versiones">Fechas cambiadas el ${esc(d.fecha(datos.packs_actualizado.en))}, por ${esc(datos.packs_actualizado.por)}.</p>` : ''}
		<form data-packs-form>
			<div class="tabla catalogo"><table>
				<thead><tr><th>Categoría</th><th>Se elige</th><th>Se abre</th><th>Se cierra</th></tr></thead>
				<tbody data-filas-fechas></tbody>
			</table></div>
			<h4>Packs</h4>
			<div class="lista-packs" data-lista-packs></div>
			<div class="acciones"><button class="boton secundario" type="button" data-nuevo-pack>Crear un pack</button><button class="boton" type="submit" disabled>Guardar las fechas</button></div>
			<div class="confirmar" data-confirmar-packs hidden></div>
			<p class="error" role="alert"></p>
		</form>

		<h3 class="separado">Opciones y precios</h3>
		<form data-catalogo-form>
			${secciones.map((c) => `
				<label class="nombre-categoria" data-nombre-categoria="${esc(c.id)}">Categoría<input name="nombre_categoria" value="${esc(c.nombre)}" maxlength="60" required aria-label="Nombre de la categoría"></label>
				${cabeceraCategoria(c)}
				<div class="tabla catalogo"><table>
					<thead><tr><th>Opción</th><th>Descripción</th><th>Precio (€)</th><th>${c.opciones.length ? 'Se ofrece' : ''}</th>${tipologias.length > 1 ? '<th>Tipologías</th>' : ''}</tr></thead>
					<tbody>${c.opciones.map((o) => fila(datos.catalogo!.categorias.find((x) => x.id === c.id)!, o)).join('')}${c.pedidas.map(filaPedida).join('')}</tbody>
				</table></div>`).join('')}
			<div class="confirmar" data-confirmar hidden></div>
			<div class="acciones"><button class="boton" type="submit" disabled>Guardar cambios</button></div>
			<p class="error" role="alert"></p>
		</form>
		</div>

		<h3 class="separado">Añadir personalizaciones y mejoras</h3>
		<p class="ayuda">Añade aquí una opción nueva, en una categoría que ya existe o en una nueva (por ejemplo, «Climatización»), con su precio y su descripción. Si tienes una ficha o fotos, adjúntalas: el equipo de MUNE las usa para preparar su aspecto en la Experiencia 3D (los compradores nunca las ven). Mientras tanto queda <strong>En preparación</strong>, pero ya puedes meterla en un pack, ponerle fechas y cambiar su nombre, su precio o su descripción arriba. Los compradores la verán cuando el equipo de MUNE la prepare, ya con sus fechas.</p>
		${datos.pedidas.length ? `<ul class="lista-pedidas">${datos.pedidas.map((x) => `<li data-pedida="${x.id}">
			<strong>${esc(x.nombre)}</strong> · ${esc(x.categoria_nueva ? `${x.estado === 'pendiente' ? nombreDe(x.categoria) : x.categoria_nueva} (categoría nueva)` : nombreDe(x.categoria))}${x.precio != null ? ` · ${esc(euros(x.precio))}` : ''}
			· <span class="estado ${x.estado === 'hecha' ? 'al-dia' : x.estado === 'pendiente' ? 'pendiente' : ''}">${ESTADO_PEDIDA[x.estado]}</span>
			<span class="promo-lugar">pedida el ${esc(d.fecha(x.pedido_en))}</span>
			${x.descripcion ? `<br><span class="promo-lugar">${esc(x.descripcion)}</span>` : ''}
			${x.archivos?.length ? `<br>${x.archivos.map((a, i) => `<button class="enlace" type="button" data-archivo="${i}">${esc(a.nombre || 'Archivo')}</button>`).join(' · ')}` : ''}
			${x.nota ? `<br><span class="promo-lugar">Nota de MUNE: ${esc(x.nota)}</span>` : ''}
			${d.modo === 'administradora' && x.estado === 'pendiente' ? `<br><button class="enlace" type="button" data-atender="hecha">Marcar como añadida…</button> · <button class="enlace" type="button" data-atender="descartada">Descartar…</button>` : ''}
		</li>`).join('')}</ul>` : ''}
		<form class="pedir-opcion" data-pedir>
			<label>Categoría<select name="categoria" required><option value="" disabled selected>Elige…</option>${todasCategorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}${c.id in datos.en_preparacion ? ' (nueva, en preparación)' : ''}</option>`).join('')}<option value="nueva">Una categoría nueva…</option></select></label>
			<label data-categoria-nueva hidden>Nombre de la categoría nueva<input name="categoria_nueva" maxlength="60" placeholder="Por ejemplo: Climatización"></label>
			<label>Opción<input name="nombre" maxlength="80" required placeholder="Por ejemplo: Roble ahumado"></label>
			<label>Precio (€)<input name="precio" type="number" min="0" max="10000000" step="0.01" required></label>
			<label>Descripción<input name="descripcion" maxlength="1000" placeholder="Marca, modelo, dónde va…"></label>
			<label class="archivos">Documento con la descripción detallada o fotos (opcional; hasta 5 archivos PDF, Word o imágenes, de 15 MB como mucho)<input name="archivos" type="file" accept="image/*,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple></label>
			<div class="acciones"><button class="boton secundario" type="submit">Añadir la opción</button></div>
			<p class="error" role="alert"></p>
		</form>`;

	// ── fechas de elección: cada categoría por separado (pack «individual» de una
	// sola categoría) o en un pack (ficha con título y fechas)
	const formPacks = caja.querySelector<HTMLFormElement>('[data-packs-form]')!;
	const filasFechas = formPacks.querySelector<HTMLElement>('[data-filas-fechas]')!;
	const listaPacks = formPacks.querySelector<HTMLElement>('[data-lista-packs]')!;
	const guardarPacks = formPacks.querySelector<HTMLButtonElement>('button[type=submit]')!;
	const confirmarPacks = formPacks.querySelector<HTMLElement>('[data-confirmar-packs]')!;
	const grupos = datos.packs.filter((x) => !x.individual);
	const packDeCategoria = (c: string) => datos.packs.find((x) => x.categorias.includes(c));
	const notaEstado = (pk: Pack | undefined) => {
		if (!pk) return '';
		const e = estadoPack(pk, datos.hoy);
		return e === 'disponible' ? `Abierto desde el ${esc(d.fecha(pk.desde))}` : e === 'finalizado' ? `Terminado el ${esc(d.fecha(pk.hasta))}` : '';
	};
	const opcionesPack = (actual: string, fijo: boolean) => `<option value=""${actual === '' ? ' selected' : ''}>Por separado</option>${
		[...listaPacks.querySelectorAll<HTMLFieldSetElement>('fieldset.pack')].map((f) => {
			const id = f.dataset.pack!;
			const titulo = f.querySelector<HTMLInputElement>('[name="titulo"]')!.value || 'Pack sin título';
			// a un pack ya abierto no entra nada nuevo
			const cerrado = f.dataset.estado !== 'proximamente' && id !== actual;
			return `<option value="${esc(id)}"${id === actual ? ' selected' : ''}${cerrado || fijo ? ' disabled' : ''}>${esc(titulo)}</option>`;
		}).join('')}`;
	const tarjeta = (pk: Pack, nuevo = false) => {
		const estado = nuevo ? 'proximamente' : estadoPack(pk, datos.hoy);
		const fijo = estado !== 'proximamente';
		const nota = nuevo ? 'Pack nuevo' : estado === 'disponible' ? `Abierto desde el ${esc(d.fecha(pk.desde))}: ya no cambian su apertura ni lo que agrupa`
			: estado === 'finalizado' ? `Terminado el ${esc(d.fecha(pk.hasta))}: ya no cambia` : `Se abre el ${esc(d.fecha(pk.desde))}`;
		return `<fieldset class="pack" data-pack="${esc(pk.id)}" data-estado="${estado}">
			<p class="promo-lugar">${nota}</p>
			<label>Título<input name="titulo" value="${esc(pk.titulo)}" maxlength="80" required${estado === 'finalizado' ? ' disabled' : ''}></label>
			<label>Descripción<input name="descripcion" value="${esc(pk.descripcion ?? '')}" maxlength="300" placeholder="Opcional"${estado === 'finalizado' ? ' disabled' : ''}></label>
			<div class="fechas">
				<label>Se abre<input name="desde" type="date" value="${esc(pk.desde)}" min="${esc(datos.hoy)}" required${fijo ? ' disabled' : ''}></label>
				<label>Se cierra<input name="hasta" type="date" value="${esc(pk.hasta)}" required${estado === 'finalizado' ? ' disabled' : ''}${estado === 'disponible' ? ` min="${esc(datos.hoy)}"` : ''}></label>
			</div>
			<p class="promo-lugar" data-agrupa></p>
			${fijo ? '' : '<button class="enlace" type="button" data-quitar-pack>Quitar este pack</button>'}
		</fieldset>`;
	};
	listaPacks.innerHTML = grupos.map((pk) => tarjeta(pk)).join('');
	/** Fila de una categoría: por separado (con sus fechas) o en un pack. */
	const filaFechas = (c: { id: string; nombre: string }) => {
		const pk = packDeCategoria(c.id);
		const estado = pk ? estadoPack(pk, datos.hoy) : (lanzada(c.id) ? 'disponible' : 'proximamente');
		const fijo = pk ? estado !== 'proximamente' : false;
		const sola = !pk || pk.individual;
		const ya = !pk && lanzada(c.id); // sin fechas y ya se puede elegir: solo se le pone el cierre
		return `<tr data-categoria="${esc(c.id)}" data-estado="${estado}"${pk?.individual ? ` data-individual="${esc(pk.id)}"` : ''}>
			<td><strong>${esc(c.nombre)}</strong>${c.id in datos.en_preparacion ? ' <span class="estado pendiente">En preparación</span>' : ''}${pk || ya ? `<br><span class="promo-lugar">${ya ? 'Ya se puede elegir: ponle su cierre' : notaEstado(pk)}</span>` : ''}</td>
			<td><select name="pack" aria-label="Cómo se elige ${esc(c.nombre)}"${fijo ? ' disabled' : ''}>${opcionesPack(sola ? '' : pk!.id, fijo)}</select></td>
			<td><input name="desde" type="date" value="${esc(sola ? pk?.desde ?? (ya ? datos.hoy : '') : '')}"${ya ? ` max="${esc(datos.hoy)}"` : ` min="${esc(datos.hoy)}"`}${fijo || ya ? ' disabled' : ''} aria-label="Se abre"></td>
			<td><input name="hasta" type="date" value="${esc(sola ? pk?.hasta ?? '' : '')}"${estado === 'finalizado' ? ' disabled' : ''}${estado === 'disponible' ? ` min="${esc(datos.hoy)}"` : ''} aria-label="Se cierra"></td>
		</tr>`;
	};
	filasFechas.innerHTML = todasCategorias.map(filaFechas).join('');
	/** Pone al día lo que depende de otras partes: fechas de las filas en un pack, nombres de los packs, qué agrupa cada uno. */
	const sincronizar = () => {
		filasFechas.querySelectorAll<HTMLTableRowElement>('tr[data-categoria]').forEach((tr) => {
			const sel = tr.querySelector<HTMLSelectElement>('[name="pack"]')!;
			const valor = sel.value;
			sel.innerHTML = opcionesPack(valor, sel.disabled);
			sel.value = valor;
			const enPack = valor !== '';
			const f = enPack ? listaPacks.querySelector<HTMLFieldSetElement>(`fieldset[data-pack="${CSS.escape(valor)}"]`) : null;
			for (const n of ['desde', 'hasta'] as const) {
				const i = tr.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
				if (enPack) {
					i.value = f?.querySelector<HTMLInputElement>(`[name="${n}"]`)!.value ?? '';
					i.disabled = true;
					i.required = false;
				} else {
					const fija = tr.dataset.estado !== 'proximamente';
					i.disabled = (n === 'desde' && (fija || !!i.max)) || (n === 'hasta' && tr.dataset.estado === 'finalizado');
					i.required = !i.disabled;
				}
			}
		});
		listaPacks.querySelectorAll<HTMLFieldSetElement>('fieldset.pack').forEach((f) => {
			const nombres = [...filasFechas.querySelectorAll<HTMLTableRowElement>('tr[data-categoria]')]
				.filter((tr) => tr.querySelector<HTMLSelectElement>('[name="pack"]')!.value === f.dataset.pack)
				.map((tr) => tr.querySelector('strong')!.textContent);
			f.querySelector<HTMLElement>('[data-agrupa]')!.textContent = nombres.length ? `Agrupa: ${nombres.join(', ')}.` : 'Todavía no agrupa ninguna categoría: elígelo en la lista de arriba.';
		});
	};
	const leerPacks = (): Pack[] => {
		const filas = [...filasFechas.querySelectorAll<HTMLTableRowElement>('tr[data-categoria]')];
		const packs: Pack[] = [...listaPacks.querySelectorAll<HTMLFieldSetElement>('fieldset.pack')].map((f) => {
			const v = (n: string) => f.querySelector<HTMLInputElement>(`[name="${n}"]`)!.value.trim();
			return { id: f.dataset.pack!, titulo: v('titulo'), descripcion: v('descripcion'), desde: v('desde'), hasta: v('hasta'),
				categorias: filas.filter((tr) => tr.querySelector<HTMLSelectElement>('[name="pack"]')!.value === f.dataset.pack).map((tr) => tr.dataset.categoria!) };
		});
		for (const tr of filas.filter((x) => x.querySelector<HTMLSelectElement>('[name="pack"]')!.value === '')) {
			const c = tr.dataset.categoria!;
			const v = (n: string) => tr.querySelector<HTMLInputElement>(`[name="${n}"]`)!.value;
			packs.push({ id: tr.dataset.individual ?? `sola-${c}`, titulo: todasCategorias.find((x) => x.id === c)!.nombre, desde: v('desde'), hasta: v('hasta'), categorias: [c], individual: true });
		}
		return packs;
	};
	const firma = (lista: Pack[]) => JSON.stringify([...lista].sort((a, b) => a.id.localeCompare(b.id))
		.map((x) => [x.id, x.titulo, x.descripcion ?? '', x.desde, x.hasta, [...x.categorias].sort(), !!x.individual]));
	sincronizar();
	const packsAntes = firma(leerPacks());
	const refrescarPacks = () => {
		sincronizar();
		guardarPacks.disabled = firma(leerPacks()) === packsAntes;
		confirmarPacks.hidden = true;
	};
	formPacks.addEventListener('input', refrescarPacks);
	formPacks.addEventListener('change', refrescarPacks);
	listaPacks.addEventListener('click', (ev) => {
		const b = (ev.target as HTMLElement).closest('[data-quitar-pack]');
		if (!b) return;
		const id = b.closest<HTMLFieldSetElement>('fieldset')!.dataset.pack!;
		// sus categorías vuelven a «Por separado»
		filasFechas.querySelectorAll<HTMLSelectElement>('[name="pack"]').forEach((sel) => { if (sel.value === id) sel.value = ''; });
		b.closest('fieldset')!.remove();
		refrescarPacks();
	});
	formPacks.querySelector('[data-nuevo-pack]')!.addEventListener('click', () => {
		const usados = new Set([...datos.packs.map((x) => x.id), ...[...listaPacks.querySelectorAll<HTMLFieldSetElement>('fieldset.pack')].map((f) => f.dataset.pack!)]);
		let n = listaPacks.children.length + 1;
		while (usados.has(`pack-${n}`)) n++;
		listaPacks.insertAdjacentHTML('beforeend', tarjeta({ id: `pack-${n}`, titulo: `Pack ${n}`, desde: '', hasta: '', categorias: [] }, true));
		listaPacks.lastElementChild?.querySelector<HTMLInputElement>('[name="titulo"]')?.focus();
		refrescarPacks();
	});
	formPacks.addEventListener('submit', (ev) => {
		ev.preventDefault();
		if (!formPacks.reportValidity()) return;
		const packs = leerPacks();
		const vacios = packs.filter((x) => !x.individual && !x.categorias.length);
		if (vacios.length) {
			formPacks.querySelector('.error')!.textContent = `El pack «${vacios[0].titulo}» no agrupa ninguna categoría: elígelo en alguna o quítalo.`;
			return;
		}
		formPacks.querySelector('.error')!.textContent = '';
		const n = packs.filter((x) => !x.individual).length, solas = packs.length - n;
		confirmarPacks.hidden = false;
		confirmarPacks.innerHTML = `<p>Vas a guardar ${n} pack${n === 1 ? '' : 's'} y ${solas} categoría${solas === 1 ? '' : 's'} por separado. Los compradores verán las fechas nuevas <strong>al momento</strong>. Lo que se abra hoy queda abierto ya: sus precios y lo que agrupa quedarán fijos.</p>
			<div class="acciones"><button class="boton" type="button" data-si>Confirmar y aplicar</button><button class="enlace" type="button" data-no>Seguir revisando</button></div>`;
		confirmarPacks.querySelector('[data-no]')!.addEventListener('click', () => { confirmarPacks.hidden = true; });
		confirmarPacks.querySelector<HTMLButtonElement>('[data-si]')!.addEventListener('click', async (e) => {
			(e.currentTarget as HTMLButtonElement).disabled = true;
			const { error: err } = await d.sb.rpc('guardar_packs', { p_promocion: p.id, p_packs: packs.map(({ estado: _e, ...x }) => x) });
			if (err) {
				formPacks.querySelector('.error')!.textContent = d.traducir(err);
				confirmarPacks.hidden = true;
				return;
			}
			await pintarCatalogo(caja, d, p, '✓ Fechas guardadas: los compradores ya las ven.');
		});
	});

	// ── cambios del catálogo: se calculan comparando con lo de ahora
	const form = caja.querySelector<HTMLFormElement>('[data-catalogo-form]')!;
	const guardar = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
	const confirmar = form.querySelector<HTMLElement>('[data-confirmar]')!;
	const leer = () => {
		const cambios: Record<string, unknown>[] = [];
		const resumen = { precios: 0, nombres: 0, quitadas: 0, vueltas: 0, tipologias: 0, categorias: 0, retiradas: 0 };
		form.querySelectorAll<HTMLElement>('[data-nombre-categoria]').forEach((l) => {
			const c = secciones.find((x) => x.id === l.dataset.nombreCategoria)!;
			const nuevo = l.querySelector('input')!.value.trim();
			if (nuevo && nuevo !== c.nombre) {
				cambios.push({ categoria: c.id, nombre_categoria: nuevo });
				resumen.categorias++;
			}
		});
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
		// lo que está en preparación
		form.querySelectorAll<HTMLTableRowElement>('tr[data-pedida-fila]').forEach((tr) => {
			const x = enPreparacion.find((y) => y.id === Number(tr.dataset.pedidaFila))!;
			const campo = (n: string) => tr.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
			if (campo('retirar').checked) {
				cambios.push({ pedida: x.id, quitar: true });
				resumen.retiradas++;
				return;
			}
			const c: Record<string, unknown> = { pedida: x.id };
			const nombre = campo('nombre').value.trim(), detalle = campo('detalle').value.trim();
			const precio = Math.round(Number(campo('precio').value || 0) * 100) / 100;
			if (nombre && nombre !== x.nombre) { c.nombre = nombre; resumen.nombres++; }
			if (detalle !== (x.descripcion ?? '')) { c.detalle = detalle; resumen.nombres++; }
			if (precio !== Number(x.precio ?? 0)) { c.precio = precio; resumen.precios++; }
			if (Object.keys(c).length > 1) cambios.push(c);
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
			resumen.categorias && `cambiar el nombre de ${resumen.categorias} categoría${resumen.categorias === 1 ? '' : 's'}`,
			resumen.precios && `cambiar ${resumen.precios} precio${resumen.precios === 1 ? '' : 's'}`,
			resumen.nombres && `cambiar ${resumen.nombres} nombre${resumen.nombres === 1 ? '' : 's'} o descripci${resumen.nombres === 1 ? 'ón' : 'ones'}`,
			resumen.quitadas && `dejar de ofrecer ${resumen.quitadas} opci${resumen.quitadas === 1 ? 'ón' : 'ones'}`,
			resumen.vueltas && `volver a ofrecer ${resumen.vueltas} opci${resumen.vueltas === 1 ? 'ón' : 'ones'}`,
			resumen.tipologias && `cambiar las tipologías de ${resumen.tipologias} opci${resumen.tipologias === 1 ? 'ón' : 'ones'}`,
			resumen.retiradas && `retirar ${resumen.retiradas} opci${resumen.retiradas === 1 ? 'ón' : 'ones'} en preparación (el equipo de MUNE ya no la${resumen.retiradas === 1 ? '' : 's'} preparará)`,
		].filter(Boolean);
		const soloPreparacion = cambios.every((x) => 'pedida' in x || (x.nombre_categoria && (x.categoria as string) in datos.en_preparacion));
		confirmar.hidden = false;
		confirmar.innerHTML = `<p>Vas a ${esc(partes.join(', '))}. ${soloPreparacion ? 'Lo que está en preparación lo verán los compradores cuando el equipo de MUNE lo prepare.' : 'Los compradores lo verán <strong>al momento</strong>.'}${resumen.precios ? ' Recuerda que, cuando su pack se abra, estos precios ya no se podrán cambiar.' : ''}</p>
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
			await pintarCatalogo(caja, d, p, soloPreparacion ? '✓ Cambios guardados.' : '✓ Cambios aplicados: los compradores ya ven el catálogo actualizado.');
		});
	});

	// ── añadir una opción (y, si hace falta, una categoría nueva)
	const pedir = caja.querySelector<HTMLFormElement>('[data-pedir]')!;
	pedir.querySelector('[name="categoria"]')!.addEventListener('change', (ev) => {
		const nueva = (ev.target as HTMLSelectElement).value === 'nueva';
		pedir.querySelector<HTMLElement>('[data-categoria-nueva]')!.hidden = !nueva;
		pedir.querySelector<HTMLInputElement>('[name="categoria_nueva"]')!.required = nueva;
	});
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
		if (ficheros.some((x) => !/^image\//.test(x.type) && !/\.(pdf|docx?)$/i.test(x.name))) return fallo('Solo PDF, Word o imágenes.');
		if (f.get('categoria') === 'nueva' && !String(f.get('categoria_nueva') ?? '').trim()) return fallo('Escribe el nombre de la categoría nueva.');
		const archivos: { ruta: string; nombre: string }[] = [];
		if (ficheros.length) {
			const { data: pr } = await d.sb.from('promociones').select('promotora_id').eq('id', p.id).single();
			for (const x of ficheros) {
				const ruta = `${pr?.promotora_id}/${p.id}/opciones/${Date.now()}-${limpio(x.name)}`;
				const { error: e } = await d.sb.storage.from('documentos').upload(ruta, x, { contentType: x.type || 'application/octet-stream', upsert: false });
				if (e) return fallo(`No se ha podido subir «${x.name}». ${d.traducir(e)}`);
				archivos.push({ ruta, nombre: x.name });
			}
		}
		const { error: err } = await d.sb.rpc('pedir_opcion', {
			p_promocion: p.id, p_categoria: f.get('categoria') === 'nueva' ? '' : String(f.get('categoria') ?? ''),
			p_categoria_nueva: f.get('categoria') === 'nueva' ? String(f.get('categoria_nueva') ?? '') : '',
			p_nombre: String(f.get('nombre') ?? ''),
			p_descripcion: String(f.get('descripcion') ?? ''), p_precio: precio ? Number(precio) : null, p_archivos: archivos,
		});
		if (err) {
			pedir.querySelector('.error')!.textContent = d.traducir(err);
			boton.disabled = false;
			return;
		}
		await pintarCatalogo(caja, d, p, '✓ Opción añadida: queda En preparación hasta que el equipo de MUNE prepare su aspecto en el 3D. Ya puedes ponerle fechas o meterla en un pack arriba.');
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

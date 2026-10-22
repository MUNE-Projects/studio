// Pestaña «Personalización» de una promoción (paso 5b, 025_selecciones.sql).
// El mismo archivo está en MUNE Studio (app/src) y en MUNE Portal (portal/src):
// si cambias uno, copia el otro.
//
// Cada vivienda con lo que ha elegido en cada pack:
//   · Seleccionada: el comprador descargó su documento; puede cambiarla mientras
//     el periodo del pack esté abierto;
//   · Cerrada: el periodo terminó; queda bloqueada como histórico.
// El Excel recoge las cerradas con sus importes. Mientras un pack está abierto,
// el equipo también puede guardar la selección en nombre del comprador (lo
// normal es que la haga él desde su vivienda). MUNE Studio solo la consulta.

import type { SupabaseClient } from '@supabase/supabase-js';
import { descargarArchivo, libroExcel } from './xlsx';

interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	fecha: (iso: string) => string;
	traducir: (e: unknown) => string;
	/** «promotora» (MUNE Portal) puede elegir en nombre del comprador; «administradora» (MUNE Studio) solo consulta. */
	modo: 'promotora' | 'administradora';
}
interface Promo { id: string; nombre: string }
interface Opcion { id: string; nombre: string; detalle?: string; precio: number }
interface Categoria { id: string; nombre: string; opciones: Opcion[] }
interface Pack { id: string; titulo: string; desde: string; hasta: string; categorias: string[]; estado?: string }
interface Vivienda { ref: string; portal?: string | null; planta?: string; tipologia: string; opciones?: Record<string, string[]> }
interface Linea { categoria: string; nombre_categoria: string; opcion: string; nombre: string; precio: number }
interface Seleccion {
	vivienda: string; pack: string; estado: 'seleccionada' | 'cerrada'; importe: number; fecha: string;
	detalle: Linea[]; opciones: Record<string, string>; hecho_por: 'comprador' | 'equipo'; actualizado_en: string;
}
interface Datos {
	hoy: string;
	catalogo: { categorias: Categoria[] } | null;
	packs: Pack[];
	tipologias: { id: string; opciones: Record<string, string[]> }[];
	viviendas: Vivienda[];
	selecciones: Seleccion[];
}

const QUIEN = { comprador: 'el comprador', equipo: 'el equipo de la promotora' } as const;
/** 1.500 €, como en la web del comprador (con punto también en las cifras de cuatro). */
const euros = (n: number) => {
	const [entero, dec] = Number(n).toFixed(2).split('.');
	return `${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec === '00' ? '' : `,${dec}`} €`;
};
const hoyArchivo = () => new Date().toISOString().slice(0, 10);
const limpio = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-');

function estadoPack(p: Pack, hoy: string): 'disponible' | 'proximamente' | 'finalizado' {
	if (p.estado === 'disponible' || p.estado === 'proximamente' || p.estado === 'finalizado') return p.estado;
	return hoy < p.desde ? 'proximamente' : hoy > p.hasta ? 'finalizado' : 'disponible';
}

/** Categorías del pack que esta vivienda puede elegir (con más de una opción), con sus opciones. */
function categoriasDe(datos: Datos, v: Vivienda, p: Pack): Categoria[] {
	const t = datos.tipologias.find((x) => x.id === v.tipologia);
	return p.categorias.map((id) => {
		const c = datos.catalogo?.categorias.find((x) => x.id === id);
		const ids = v.opciones?.[id] ?? t?.opciones?.[id] ?? [];
		return c ? { ...c, opciones: c.opciones.filter((o) => ids.includes(o.id)) } : null;
	}).filter((c): c is Categoria => !!c && c.opciones.length > 1);
}

function excel(d: Dependencias, p: Promo, datos: Datos, todas: boolean): void {
	const packs = new Map(datos.packs.map((x) => [x.id, x.titulo]));
	const viviendas = new Map(datos.viviendas.map((v) => [v.ref, v]));
	const filas = datos.selecciones.filter((s) => todas || s.estado === 'cerrada').map((s) => {
		const v = viviendas.get(s.vivienda);
		return [s.vivienda, v?.portal ?? '', v?.planta ?? '', packs.get(s.pack) ?? s.pack, s.estado === 'cerrada' ? 'Cerrada' : 'Seleccionada',
			d.fecha(s.fecha), (s.detalle.length
				? s.detalle.map((l) => `${l.nombre_categoria}: ${l.nombre}${l.precio ? ` (+${euros(l.precio)})` : ''}`)
				// selecciones de antes del paso 5b: sin nombres, solo lo elegido
				: Object.entries(s.opciones).map(([c, o]) => `${c}: ${o}`)).join('; '),
			Number(s.importe).toFixed(2).replace('.', ',')];
	});
	descargarArchivo(libroExcel('Personalización', ['Vivienda', 'Portal', 'Planta', 'Pack', 'Estado', 'Fecha', 'Elección', 'Importe (€)'], filas,
		[16, 10, 12, 24, 14, 12, 80, 14]), `Personalizacion-${limpio(p.nombre)}-${todas ? 'todas' : 'cerradas'}-${hoyArchivo()}.xlsx`);
}

export async function pintarPersonalizacion(caja: HTMLElement, d: Dependencias, p: Promo, aviso = ''): Promise<void> {
	const { esc } = d;
	const { data, error } = await d.sb.rpc('personalizacion_de_promocion', { p_promocion: p.id });
	if (error) {
		caja.innerHTML = `<h2>Personalización</h2><p class="error">${esc(d.traducir(error))}</p>`;
		return;
	}
	const datos = data as Datos;
	if (!datos.catalogo || !datos.viviendas.length) {
		caja.innerHTML = '<h2>Personalización</h2><p class="vacio">Todavía no hay catálogo de personalización: aparecerá cuando MUNE prepare la próxima versión de la promoción.</p>';
		return;
	}
	const packs = datos.packs.length ? datos.packs : [];
	const de = (ref: string, pack: string) => datos.selecciones.find((s) => s.vivienda === ref && s.pack === pack);
	const cerradas = datos.selecciones.filter((s) => s.estado === 'cerrada');
	const seleccionadas = datos.selecciones.filter((s) => s.estado === 'seleccionada');
	const total = cerradas.reduce((t, s) => t + Number(s.importe), 0);
	const celda = (v: Vivienda, pk: Pack) => {
		const s = de(v.ref, pk.id);
		const estado = estadoPack(pk, datos.hoy);
		const puede = d.modo === 'promotora' && estado === 'disponible' && s?.estado !== 'cerrada' && categoriasDe(datos, v, pk).length > 0;
		return `<td>${s
			? `<span class="estado ${s.estado === 'cerrada' ? 'al-dia' : 'pendiente'}">${s.estado === 'cerrada' ? 'Cerrada' : 'Seleccionada'}</span>
				<br><strong>${esc(euros(s.importe))}</strong><br><span class="promo-lugar">${esc(d.fecha(s.fecha))} · por ${esc(QUIEN[s.hecho_por] ?? s.hecho_por)}</span>
				${s.detalle.length ? `<details class="eleccion"><summary>Ver elección</summary><ul>${s.detalle.map((l) =>
					`<li>${esc(l.nombre_categoria)}: ${esc(l.nombre)}${l.precio ? ` (+${esc(euros(l.precio))})` : ''}</li>`).join('')}</ul></details>` : ''}`
			: `<span class="estado">${estado === 'proximamente' ? 'Aún no abierto' : estado === 'finalizado' ? 'Sin selección' : 'Sin elegir'}</span>`}
			${puede ? `<br><button class="enlace" type="button" data-elegir="${esc(pk.id)}">${s ? 'Cambiar' : 'Elegir'} en su nombre…</button>` : ''}</td>`;
	};

	caja.innerHTML = `
		<h2>Personalización</h2>
		<p class="ayuda">Lo que ha elegido cada vivienda en cada pack. Cuando el comprador descarga el documento de un pack, su elección queda <strong>Seleccionada</strong> y puede cambiarla mientras el periodo esté abierto. Al terminar el periodo pasa a <strong>Cerrada</strong> y ya no cambia.</p>
		<p class="promo-versiones">${seleccionadas.length} seleccionada${seleccionadas.length === 1 ? '' : 's'} · ${cerradas.length} cerrada${cerradas.length === 1 ? '' : 's'} · importe cerrado: ${esc(euros(total))}</p>
		${aviso ? `<p class="aviso" role="status">${esc(aviso)}</p>` : ''}
		<div class="acciones">
			<button class="boton" type="button" data-excel="cerradas"${cerradas.length ? '' : ' disabled'}>Descargar el Excel de las cerradas</button>
			<button class="boton secundario" type="button" data-excel="todas"${datos.selecciones.length ? '' : ' disabled'}>Excel con todas (también las seleccionadas)</button>
		</div>
		<label class="buscador">Buscar vivienda <input type="search" data-buscar placeholder="Por ejemplo: 1ºA" autocomplete="off"></label>
		<div class="tabla personalizacion"><table>
			<thead><tr><th>Vivienda</th>${packs.map((pk) => `<th>${esc(pk.titulo)}<br><span class="promo-lugar">${esc(d.fecha(pk.desde))} – ${esc(d.fecha(pk.hasta))}</span></th>`).join('')}</tr></thead>
			<tbody>${datos.viviendas.map((v) => `<tr data-vivienda="${esc(v.ref)}" data-texto="${esc(`${v.ref} ${v.portal ?? ''} ${v.planta ?? ''}`.toLowerCase())}">
				<td><strong>${esc(v.ref)}</strong><br><span class="promo-lugar">${esc([v.portal ? `Portal ${v.portal}` : '', v.planta ? `Planta ${v.planta}` : ''].filter(Boolean).join(' · '))}</span></td>
				${packs.map((pk) => celda(v, pk)).join('')}</tr>
				<tr data-formulario="${esc(v.ref)}" hidden><td colspan="${packs.length + 1}"></td></tr>`).join('')}</tbody>
		</table></div>
		<p class="vacio" data-sin-resultados hidden>Ninguna vivienda coincide con la búsqueda.</p>`;

	caja.querySelectorAll<HTMLButtonElement>('[data-excel]').forEach((b) => b.addEventListener('click', () => excel(d, p, datos, b.dataset.excel === 'todas')));

	const buscar = caja.querySelector<HTMLInputElement>('[data-buscar]')!;
	buscar.addEventListener('input', () => {
		const q = buscar.value.trim().toLowerCase();
		let visibles = 0;
		caja.querySelectorAll<HTMLTableRowElement>('tr[data-vivienda]').forEach((f) => {
			f.hidden = !!q && !f.dataset.texto!.includes(q);
			if (!f.hidden) visibles++;
		});
		caja.querySelector<HTMLElement>('[data-sin-resultados]')!.hidden = visibles > 0;
	});

	// Elegir en nombre del comprador (pack abierto)
	caja.querySelectorAll<HTMLButtonElement>('[data-elegir]').forEach((b) => b.addEventListener('click', () => {
		const ref = b.closest<HTMLTableRowElement>('tr')!.dataset.vivienda!;
		const v = datos.viviendas.find((x) => x.ref === ref)!;
		const pk = packs.find((x) => x.id === b.dataset.elegir)!;
		const actual = de(ref, pk.id)?.opciones ?? {};
		const fila = caja.querySelector<HTMLTableRowElement>(`tr[data-formulario="${CSS.escape(ref)}"]`)!;
		fila.hidden = false;
		fila.cells[0].innerHTML = `<form class="eleccion-equipo">
			<h3>${esc(ref)} · ${esc(pk.titulo)}</h3>
			<p class="ayuda">Guárdala solo si el comprador te lo ha pedido. Queda como «Seleccionada» y él puede cambiarla desde su vivienda hasta el ${esc(d.fecha(pk.hasta))}.</p>
			${categoriasDe(datos, v, pk).map((c) => `<label>${esc(c.nombre)}<select name="${esc(c.id)}">${c.opciones.map((o) =>
				`<option value="${esc(o.id)}"${(actual[c.id] ?? c.opciones[0].id) === o.id ? ' selected' : ''}>${esc(o.nombre)}${o.precio ? ` (+${esc(euros(o.precio))})` : ' (incluido)'}</option>`).join('')}</select></label>`).join('')}
			<div class="acciones"><button class="boton" type="submit">Guardar la selección</button><button class="enlace" type="button" data-cancelar>Cancelar</button></div>
			<p class="error" role="alert"></p>
		</form>`;
		const form = fila.querySelector('form')!;
		form.querySelector('[data-cancelar]')!.addEventListener('click', () => { fila.hidden = true; fila.cells[0].innerHTML = ''; });
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
			boton.disabled = true;
			const opciones = Object.fromEntries([...new FormData(form)].map(([k, x]) => [k, String(x)]));
			const { data: r, error: e } = await d.sb.rpc('guardar_seleccion_equipo', { p_promocion: p.id, p_vivienda: ref, p_pack: pk.id, p_opciones: opciones });
			if (e) {
				form.querySelector('.error')!.textContent = d.traducir(e);
				boton.disabled = false;
				return;
			}
			await pintarPersonalizacion(caja, d, p, `✓ Selección de ${ref} guardada (${euros((r as { importe: number }).importe)}).`);
		});
	}));
}

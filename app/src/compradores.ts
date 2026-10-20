// Pestaña «Compradores» de una promoción (Etapa 5, 014_codigos_comprador.sql).
// El mismo archivo está en el Panel (app/src) y en el portal (portal/src):
// si cambias uno, copia el otro.
//
// Un código por vivienda. Solo se ve al generarlo (en Supabase queda su huella):
// la promotora los genera todos a la vez y se descargan en un Excel; si uno se
// pierde, se cambia. Al cambiarlo se indica si es el mismo comprador (conserva
// lo que eligió) o uno nuevo (empieza de cero).
//   · modo «promotora» (MUNE Portal): genera, cambia, busca y descarga el Excel.
//   · modo «administradora» (MUNE Studio): consulta; generar o cambiar queda plegado
//     en «Ayudar con un código», para cuando escriben pidiendo ayuda.

import type { SupabaseClient } from '@supabase/supabase-js';
import { descargarArchivo, libroExcel } from './xlsx';

interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	fecha: (iso: string) => string;
	traducir: (e: unknown) => string;
	escaparate: string;
	revision: string;
	modo: 'promotora' | 'administradora';
}
interface Vivienda { ref: string; portal: string | null; planta: string; tipologia: string; espejo: boolean }
interface Codigo { vivienda_ref: string; comprador: number; creado_en: string; ultimo_acceso: string | null; accesos: number }
interface Promo { id: string; nombre: string }

/** Lista pública de viviendas de la última versión preparada (o de la publicada). */
async function leerViviendas(d: Dependencias, id: string): Promise<Vivienda[] | null> {
	for (const base of [d.revision, d.escaparate]) {
		try {
			const r = await fetch(`${base}/${encodeURIComponent(id)}/viviendas.json`, { cache: 'no-store' });
			if (r.ok) return await r.json() as Vivienda[];
		} catch { /* se prueba la siguiente */ }
	}
	return null;
}

const enlaceDe = (d: Dependencias, p: Promo, codigo: string) => `${d.escaparate}/${p.id}/#${codigo}`;
const hoy = () => new Date().toISOString().slice(0, 10);
/** Para nombres de archivo: sin tildes ni símbolos («Las Eñes» → Las-Enes). */
const limpio = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-');

/** Excel con los códigos recién generados (la única vez que se pueden ver). */
function excelCodigos(d: Dependencias, p: Promo, datos: Map<string, Vivienda>, codigos: [string, string][]): void {
	const filas = codigos.map(([ref, codigo]) => {
		const v = datos.get(ref);
		return [ref, v?.portal ?? '', v?.planta ?? '', codigo, enlaceDe(d, p, codigo)];
	});
	descargarArchivo(libroExcel('Códigos de comprador', ['Vivienda', 'Portal', 'Planta', 'Código', 'Enlace directo'], filas, [16, 10, 12, 18, 64]),
		`Codigos-${limpio(p.nombre)}-${hoy()}.xlsx`);
}

export async function pintarCompradores(caja: HTMLElement, d: Dependencias, p: Promo, aviso = ''): Promise<void> {
	const { esc } = d;
	const admin = d.modo === 'administradora';
	const [viviendas, { data, error }] = await Promise.all([leerViviendas(d, p.id), d.sb.rpc('codigos_de_promocion', { p_promocion: p.id })]);
	if (error) {
		caja.innerHTML = `<h2>Compradores</h2><p class="error">${esc(d.traducir(error))}</p>`;
		return;
	}
	const codigos = new Map(((data ?? []) as Codigo[]).map((c) => [c.vivienda_ref, c]));
	const datos = new Map((viviendas ?? []).map((v) => [v.ref, v]));
	const refs = [...new Set([...datos.keys(), ...codigos.keys()])];
	const sinCodigo = refs.filter((r) => !codigos.has(r));
	const conCodigo = refs.length - sinCodigo.length;
	const detalle = (v?: Vivienda) => v ? [v.portal ? `Portal ${v.portal}` : '', v.planta ? `Planta ${v.planta}` : ''].filter(Boolean).join(' · ') : '';

	caja.innerHTML = `
		<h2>Compradores</h2>
		<p class="ayuda">${admin
			? 'Los códigos los genera y entrega la promotora desde MUNE Portal. Aquí ves qué viviendas tienen código y si el comprador ya ha entrado.'
			: 'Cada vivienda tiene un código de acceso. Compártelo con el comprador para que pueda entrar en su vivienda y acceder a su personalización. Los códigos solo se muestran al generarlos, así que descarga el Excel y guárdalo. Si un comprador pierde el suyo, cámbialo por otro.'}</p>
		<p class="promo-versiones">${conCodigo} de ${refs.length} vivienda${refs.length === 1 ? '' : 's'} con código</p>
		${aviso ? `<p class="aviso" role="status">${esc(aviso)}</p>` : ''}
		<div data-codigo-nuevo></div>
		${!admin && sinCodigo.length ? `<div class="acciones"><button class="boton" type="button" data-generar-todos>Generar los códigos de ${sinCodigo.length === refs.length ? 'todas las viviendas' : `las ${sinCodigo.length} viviendas sin código`} y descargar el Excel</button></div>` : ''}
		${refs.length ? `
		<label class="buscador">Buscar vivienda <input type="search" data-buscar placeholder="Por ejemplo: 1ºA" autocomplete="off"></label>
		${admin ? `<details class="ayuda-codigos" data-ayuda><summary>Ayudar con un código</summary>
			<p class="ayuda">Normalmente lo hace la promotora. Úsalo solo si te piden ayuda: al abrirlo aparecen los botones para generar o cambiar el código de cada vivienda.</p></details>` : ''}
		<div class="tabla compradores${admin ? '' : ' con-acciones'}"><table>
			<thead><tr><th>Vivienda</th><th>Código</th><th class="col-acciones"></th></tr></thead>
			<tbody>${refs.map((ref) => {
				const v = datos.get(ref);
				const c = codigos.get(ref);
				return `<tr data-vivienda="${esc(ref)}" data-texto="${esc(`${ref} ${detalle(v)}`.toLowerCase())}">
					<td><strong>${esc(ref)}</strong>${v ? `<br><span class="promo-lugar">${esc(detalle(v))}</span>` : ''}</td>
					<td>${c ? `<span class="estado al-dia">Con código</span><br><span class="promo-lugar">Desde el ${esc(d.fecha(c.creado_en))}${c.comprador > 1 ? ` · comprador nº ${c.comprador}` : ''}<br>${c.ultimo_acceso ? `Último acceso: ${esc(d.fecha(c.ultimo_acceso))} (${c.accesos} en total)` : 'Todavía no ha entrado'}</span>` : '<span class="estado">Sin código</span>'}</td>
					<td class="col-acciones">${c
						? `<button class="boton secundario pequeno" type="button" data-cambiar>Cambiar código…</button>
							<div class="cambio" data-opciones hidden>
								<p class="ayuda">¿Para quién es el código nuevo? El actual dejará de valer al momento.</p>
								<button class="boton secundario pequeno" type="button" data-generar="mismo">Mismo comprador (ha perdido el código)</button>
								<button class="boton secundario pequeno" type="button" data-generar="nuevo">Comprador nuevo (empieza de cero)</button>
								<button class="enlace" type="button" data-cancelar>Cancelar</button>
							</div>`
						: '<button class="boton secundario pequeno" type="button" data-generar="primero">Generar código</button>'}</td>
				</tr>`;
			}).join('')}</tbody></table></div>
		<p class="vacio" data-sin-resultados hidden>Ninguna vivienda coincide con la búsqueda.</p>`
		: '<p class="vacio">Todavía no hay lista de viviendas: aparecerá cuando MUNE prepare la primera versión de la promoción.</p>'}`;

	// Buscador
	const buscar = caja.querySelector<HTMLInputElement>('[data-buscar]');
	buscar?.addEventListener('input', () => {
		const q = buscar.value.trim().toLowerCase();
		let visibles = 0;
		caja.querySelectorAll<HTMLTableRowElement>('tr[data-vivienda]').forEach((f) => {
			f.hidden = !!q && !f.dataset.texto!.includes(q);
			if (!f.hidden) visibles++;
		});
		caja.querySelector<HTMLElement>('[data-sin-resultados]')!.hidden = visibles > 0;
	});

	// Panel: las acciones aparecen al abrir «Ayudar con un código»
	const ayuda = caja.querySelector<HTMLDetailsElement>('[data-ayuda]');
	ayuda?.addEventListener('toggle', () => caja.querySelector('.compradores')!.classList.toggle('con-acciones', ayuda.open));

	// Todos a la vez
	caja.querySelector<HTMLButtonElement>('[data-generar-todos]')?.addEventListener('click', async (ev) => {
		const b = ev.currentTarget as HTMLButtonElement;
		if (!confirm(`¿Generar ${sinCodigo.length === 1 ? 'el código de 1 vivienda' : `los códigos de ${sinCodigo.length} viviendas`}?\n\nSe descargará un Excel con todos. Guárdalo bien: los códigos no se pueden volver a ver.`)) return;
		b.disabled = true;
		const { data: nuevos, error: e } = await d.sb.rpc('generar_codigos_pendientes', { p_promocion: p.id, p_viviendas: sinCodigo });
		if (e) { b.disabled = false; alert(d.traducir(e)); return; }
		const lista = ((nuevos ?? []) as { vivienda_ref: string; codigo: string }[]).map((x) => [x.vivienda_ref, x.codigo] as [string, string]);
		excelCodigos(d, p, datos, lista);
		await pintarCompradores(caja, d, p, `✓ ${lista.length === 1 ? 'Código generado' : `${lista.length} códigos generados`}. Se ha descargado el Excel: guárdalo, los códigos no se pueden volver a ver.`);
		const zona = caja.querySelector<HTMLElement>('[data-codigo-nuevo]')!;
		zona.innerHTML = '<div class="acciones"><button class="boton secundario pequeno" type="button" data-otra-vez>Volver a descargar el Excel</button></div>';
		zona.querySelector('[data-otra-vez]')!.addEventListener('click', () => excelCodigos(d, p, datos, lista));
	});

	// Una vivienda
	caja.querySelectorAll<HTMLTableRowElement>('tr[data-vivienda]').forEach((fila) => {
		const opciones = fila.querySelector<HTMLElement>('[data-opciones]');
		const cambiar = fila.querySelector<HTMLButtonElement>('[data-cambiar]');
		cambiar?.addEventListener('click', () => { opciones!.hidden = false; cambiar.hidden = true; });
		fila.querySelector('[data-cancelar]')?.addEventListener('click', () => { opciones!.hidden = true; cambiar!.hidden = false; });
		fila.querySelectorAll<HTMLButtonElement>('[data-generar]').forEach((b) => b.addEventListener('click', async () => {
			const ref = fila.dataset.vivienda!;
			const tipo = b.dataset.generar!;
			if (tipo === 'nuevo' && !confirm(`¿Código para un comprador nuevo de ${ref}?\n\nEl nuevo comprador empezará de cero y no verá las selecciones del anterior. Las selecciones anteriores se conservarán en el historial interno de la vivienda. El código actual dejará de valer.`)) return;
			b.disabled = true;
			const { data: codigo, error: e } = await d.sb.rpc('generar_codigo_comprador', { p_promocion: p.id, p_vivienda: ref, p_nuevo_comprador: tipo === 'nuevo' });
			if (e || typeof codigo !== 'string') { b.disabled = false; alert(d.traducir(e)); return; }
			await pintarCompradores(caja, d, p);
			mostrarCodigo(caja.querySelector<HTMLElement>('[data-codigo-nuevo]')!, d, p, datos, ref, codigo);
		}));
	});
}

/** El código recién generado de una vivienda: se ve solo esta vez. */
function mostrarCodigo(destino: HTMLElement, d: Dependencias, p: Promo, datos: Map<string, Vivienda>, ref: string, codigo: string): void {
	const { esc } = d;
	const enlace = enlaceDe(d, p, codigo);
	const mensaje = `Hola: este es tu código de comprador de ${p.nombre} (vivienda ${ref}): ${codigo}\n\n`
		+ `Entra en ${d.escaparate}/${p.id}/ y pulsa «¿Ya eres comprador?», o abre directamente este enlace: ${enlace}\n\n`
		+ 'Guárdalo: es personal y te da acceso a tu vivienda y a su personalización.';
	destino.innerHTML = `<div class="codigo-nuevo" role="status">
		<p><strong>Código de ${esc(ref)}</strong> · cópialo o descárgalo ahora: no se podrá volver a ver.</p>
		<p class="codigo">${esc(codigo)}</p>
		<p class="promo-lugar">Enlace directo: ${esc(enlace)}</p>
		<div class="acciones">
			<button class="boton pequeno" type="button" data-copiar="codigo">Copiar código</button>
			<button class="boton secundario pequeno" type="button" data-copiar="mensaje">Copiar mensaje para el comprador</button>
			<button class="boton secundario pequeno" type="button" data-excel>Descargar en Excel</button>
			<button class="enlace" type="button" data-cerrar-codigo>Ya lo tengo</button>
		</div>
	</div>`;
	destino.querySelectorAll<HTMLButtonElement>('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(b.dataset.copiar === 'codigo' ? codigo : mensaje);
			b.textContent = '✓ Copiado';
		} catch {
			alert(b.dataset.copiar === 'codigo' ? codigo : mensaje);
		}
	}));
	destino.querySelector('[data-excel]')!.addEventListener('click', () => excelCodigos(d, p, datos, [[ref, codigo]]));
	destino.querySelector('[data-cerrar-codigo]')!.addEventListener('click', () => { destino.innerHTML = ''; });
	destino.scrollIntoView({ block: 'nearest' });
}

// MUNE Portal · pestaña «Documentación» de una promoción.
//
// La lista de documentos que MUNE necesita (requisitos). Casi todos guardan
// una sola cadena de versiones: cada archivo nuevo sustituye al anterior. Los
// que admiten varios archivos (varios = true) guardan uno por cada cosa que
// contienen («Cuadro de carpinterías», «Tipología A»…), cada uno con su propio
// historial, su estado y su «Sustituir» (020_equipos_y_validaciones.sql).
//
// La lista es de información, no de archivos (022): un mismo archivo puede
// cubrir varios documentos de la lista. Se sube una vez, en uno de ellos, y se
// marca qué más incluye; los demás cuentan como entregados con su estado.

import { MAX_TAM, esc, fecha, sb, traducir } from './comun';
import { FASES, conectarFase, htmlFase, leerHistorialFases } from './fase';

export interface Requisito {
	id: number; bloque: string; elemento: string; descripcion: string; obligatorio: boolean; orden: number;
	plantilla: string | null; varios: boolean; contenidos: string[];
}
export interface Documento {
	id: number; requisito_id: number; nombre: string; ruta: string; version: number; estado: string; nota: string | null;
	subido_en: string; fase?: string | null; contenido: string | null; detalle: string | null; reemplaza_a: number | null;
}

/** Qué otros requisitos cubre cada archivo: documento → requisitos. */
export type Cubre = Map<number, number[]>;

export async function leerCubre(documentos: Documento[]): Promise<Cubre> {
	const ids = documentos.map((d) => d.id);
	const cubre: Cubre = new Map();
	if (!ids.length) return cubre;
	const { data, error } = await sb.from('documento_cubre').select('documento_id, requisito_id').in('documento_id', ids);
	if (error) throw error;
	for (const x of (data ?? []) as { documento_id: number; requisito_id: number }[]) {
		cubre.set(x.documento_id, [...(cubre.get(x.documento_id) ?? []), x.requisito_id]);
	}
	return cubre;
}

/** Archivos vigentes en la lista (ninguno los sustituye) que cubren cada requisito además del suyo. */
function cubiertosPor(documentos: Documento[], cubre: Cubre): Map<number, Documento[]> {
	const sustituidos = new Set(documentos.map((d) => d.reemplaza_a).filter((x): x is number => x !== null));
	const porRequisito = new Map<number, Documento[]>();
	for (const d of documentos) {
		if (sustituidos.has(d.id)) continue;
		for (const r of cubre.get(d.id) ?? []) porRequisito.set(r, [...(porRequisito.get(r) ?? []), d]);
	}
	return porRequisito;
}

export const COLUMNAS_REQUISITO = 'id, bloque, elemento, descripcion, obligatorio, orden, plantilla, varios, contenidos';
export const COLUMNAS_DOCUMENTO = 'id, requisito_id, nombre, ruta, version, estado, nota, subido_en, fase, contenido, detalle, reemplaza_a';

/** Archivos de un requisito con varios: cada uno es su versión más reciente y las anteriores. */
function archivos(docs: Documento[]): { ultimo: Documento; anteriores: Documento[] }[] {
	const sustituidos = new Set(docs.map((d) => d.reemplaza_a).filter((x): x is number => x !== null));
	const porId = new Map(docs.map((d) => [d.id, d]));
	return docs.filter((d) => !sustituidos.has(d.id))
		.sort((a, b) => (a.contenido ?? '').localeCompare(b.contenido ?? '', 'es') || (a.detalle ?? '').localeCompare(b.detalle ?? '', 'es') || a.id - b.id)
		.map((ultimo) => {
			const anteriores: Documento[] = [];
			for (let d = ultimo.reemplaza_a !== null ? porId.get(ultimo.reemplaza_a) : undefined; d; d = d.reemplaza_a !== null ? porId.get(d.reemplaza_a) : undefined) {
				anteriores.push(d);
				if (anteriores.length > 500) break;
			}
			return { ultimo, anteriores };
		});
}

const ESTADO_DOC: Record<string, [string, string]> = {
	vigente: ['Aceptado', 'al-dia'], rechazado: ['Rechazado', 'rechazado'], pendiente: ['En revisión', ''],
};
const chip = (estado: string) => { const [t, c] = ESTADO_DOC[estado] ?? ESTADO_DOC.pendiente; return `<span class="estado ${c}">${t}</span>`; };

/** Cuántos documentos obligatorios faltan y cuántos hay que corregir (para los contadores). */
export function resumenDocumentos(requisitos: Requisito[], documentos: Documento[], cubre: Cubre = new Map()): { faltan: number; rechazados: number } {
	let faltan = 0;
	let rechazados = 0;
	const cubiertos = cubiertosPor(documentos, cubre);
	for (const r of requisitos) {
		const suyos = documentos.filter((d) => d.requisito_id === r.id);
		if (!suyos.length) { if (r.obligatorio && !cubiertos.get(r.id)?.length) faltan++; continue; }
		const ultimos = r.varios ? archivos(suyos).map((a) => a.ultimo) : [suyos[0]];
		if (ultimos.some((d) => d.estado === 'rechazado')) rechazados++;
	}
	return { faltan, rechazados };
}

/** Estado de un requisito con varios archivos: «3 archivos · 1 en revisión». */
function estadoVarios(r: Requisito, ultimos: Documento[]): [string, string] {
	if (!ultimos.length) return r.obligatorio ? ['Falta por entregar', 'pendiente'] : ['Opcional', ''];
	const n = (e: string) => ultimos.filter((d) => d.estado === e).length;
	const partes = [`${ultimos.length} archivo${ultimos.length === 1 ? '' : 's'}`];
	if (n('pendiente')) partes.push(`${n('pendiente')} en revisión`);
	if (n('rechazado')) partes.push(`${n('rechazado')} rechazado${n('rechazado') === 1 ? '' : 's'}`);
	if (n('vigente') === ultimos.length) partes.push(ultimos.length === 1 ? 'aceptado' : 'aceptados');
	return [partes.join(' · '), n('rechazado') ? 'rechazado' : n('vigente') === ultimos.length ? 'al-dia' : ''];
}

/** «También incluye…» de un archivo, con sus casillas para cambiarlo. */
function htmlIncluye(d: Documento, propio: number, requisitos: Requisito[], cubre: Cubre): string {
	const marcados = new Set(cubre.get(d.id) ?? []);
	const otros = requisitos.filter((r) => r.id !== propio);
	if (!otros.length) return '';
	const nombres = otros.filter((r) => marcados.has(r.id)).map((r) => r.elemento);
	return `<details class="incluye">
		<summary>${nombres.length ? `También incluye: ${esc(nombres.join(', '))} · <span class="enlace">Cambiar</span>`
			: '<span class="enlace">¿Este archivo incluye también otros documentos de la lista?</span>'}</summary>
		<form class="peticion-form" data-incluye="${d.id}" novalidate>
			<p class="ayuda">Marca lo que también contiene este archivo. No hará falta subirlo otra vez.</p>
			${otros.map((r) => `<label class="casilla"><input type="checkbox" name="requisito" value="${r.id}" ${marcados.has(r.id) ? 'checked' : ''}> ${esc(r.elemento)}</label>`).join('')}
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton pequeno" type="submit">Guardar</button></div>
		</form>
	</details>`;
}

/** Requisito sin archivo propio que va dentro de otro archivo. */
function htmlCubierto(r: Requisito, por: Documento[], requisitos: Requisito[]): string {
	const d = por[0];
	const de = requisitos.find((x) => x.id === d.requisito_id)?.elemento ?? '';
	const [texto, clase] = ESTADO_DOC[d.estado] ?? ESTADO_DOC.pendiente;
	return `<article class="requisito">
		<div class="requisito-cabeza">
			<span class="requisito-nombre">${esc(r.elemento)}</span>
			<span class="estado ${clase}">${esc(texto)}</span>
		</div>
		${r.descripcion ? `<p class="requisito-desc">${esc(r.descripcion)}</p>` : ''}
		<p class="promo-lugar">Incluido en «${esc(d.nombre)}»${de ? `, que está en «${esc(de)}»` : ''}${por.length > 1 ? ` y en ${por.length - 1} archivo${por.length > 2 ? 's' : ''} más` : ''}.</p>
		<div class="acciones">
			<button class="boton secundario pequeno" type="button" data-bajar="documentos" data-ruta="${esc(d.ruta)}" data-nombre="${esc(d.nombre)}">Descargar</button>
			<label class="boton secundario pequeno subir">Subir otro archivo aparte
				<input type="file" data-subir="${r.id}">
			</label>
		</div>
		<p class="aviso" data-progreso="${r.id}" role="status" hidden></p>
	</article>`;
}

const lineaVersion = (d: Documento) => `<div class="historial-fila">
	<span>v${d.version} · ${esc(d.nombre)} · ${esc(fecha(d.subido_en))}${d.fase ? ` · ${esc(FASES[d.fase] ?? '')}` : ''}</span>
	${chip(d.estado)}
	<button class="enlace" type="button" data-bajar="documentos" data-ruta="${esc(d.ruta)}" data-nombre="${esc(d.nombre)}">Descargar</button>
</div>`;

function htmlVarios(r: Requisito, suyos: Documento[], requisitos: Requisito[], cubre: Cubre): string {
	const lista = archivos(suyos);
	const [texto, clase] = estadoVarios(r, lista.map((a) => a.ultimo));
	const ejemplo = /tipolog/i.test(r.elemento) ? 'Por ejemplo: Tipología A' : 'Por ejemplo: Ventanas fachada sur';
	const opciones = (r.contenidos?.length ? r.contenidos : ['Otro']);
	return `<article class="requisito">
		<div class="requisito-cabeza">
			<span class="requisito-nombre">${esc(r.elemento)}</span>
			<span class="estado ${clase}">${esc(texto)}</span>
		</div>
		${r.descripcion ? `<p class="requisito-desc">${esc(r.descripcion)}</p>` : ''}
		${r.plantilla ? `<a class="enlace" href="${esc(r.plantilla)}" download>Descargar la plantilla</a>` : ''}
		${lista.length ? `<div class="archivos">${lista.map(({ ultimo: d, anteriores }) => `<div class="archivo">
			<div class="archivo-cabeza">
				<span><strong>${esc(d.contenido ?? 'Archivo')}</strong>${d.detalle ? ` · ${esc(d.detalle)}` : ''}</span>
				${chip(d.estado)}
			</div>
			<p class="promo-lugar">${esc(d.nombre)} · v${d.version} · ${esc(fecha(d.subido_en))}${d.fase ? ` · ${esc(FASES[d.fase] ?? '')}` : ''}</p>
			${d.estado === 'rechazado' ? `<p class="requisito-nota">${d.nota ? `${esc(d.nota)} ` : ''}Sustitúyelo por una versión corregida.</p>` : ''}
			<div class="acciones">
				<button class="boton secundario pequeno" type="button" data-bajar="documentos" data-ruta="${esc(d.ruta)}" data-nombre="${esc(d.nombre)}">Descargar</button>
				<label class="boton secundario pequeno subir">Sustituir
					<input type="file" data-sustituir="${d.id}" data-requisito="${r.id}"></label>
			</div>
			${htmlIncluye(d, r.id, requisitos, cubre)}
			${anteriores.length ? `<details class="historial-fases"><summary>Versiones anteriores (${anteriores.length})</summary>
				<div class="historial">${anteriores.map(lineaVersion).join('')}</div></details>` : ''}
		</div>`).join('')}</div>` : ''}
		<details class="anadir">
		<summary class="boton secundario pequeno">Añadir archivo</summary>
		<form class="anadir-archivo" data-anadir="${r.id}" novalidate>
			<label>¿Qué contiene? <select name="contenido" required>
				<option value="">Elige una opción</option>
				${opciones.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
			</select></label>
			<label>Detalle (opcional) <input name="detalle" maxlength="200" placeholder="${esc(ejemplo)}"></label>
			<label>Archivo <input type="file" name="archivo"></label>
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton pequeno" type="submit">Subir el archivo</button></div>
		</form>
		</details>
		<p class="aviso" data-progreso="${r.id}" role="status" hidden></p>
	</article>`;
}

function htmlUnico(r: Requisito, anteriores: Documento[], requisitos: Requisito[], cubre: Cubre): string {
	const ultimo = anteriores[0];
	const estado = !ultimo ? (r.obligatorio ? ['Falta por entregar', 'pendiente'] : ['Opcional', ''])
		: ESTADO_DOC[ultimo.estado] ?? ESTADO_DOC.pendiente;
	return `<article class="requisito">
		<div class="requisito-cabeza">
			<span class="requisito-nombre">${esc(r.elemento)}</span>
			<span class="estado ${estado[1]}">${esc(estado[0])}</span>
		</div>
		${r.descripcion ? `<p class="requisito-desc">${esc(r.descripcion)}</p>` : ''}
		${r.plantilla ? `<a class="enlace" href="${esc(r.plantilla)}" download>Descargar la plantilla</a>` : ''}
		${ultimo?.estado === 'rechazado' ? `<p class="requisito-nota">${ultimo.nota ? `${esc(ultimo.nota)} ` : ''}Sube una versión nueva con lo corregido.</p>` : ''}
		${ultimo ? htmlIncluye(ultimo, r.id, requisitos, cubre) : ''}
		${anteriores.length ? `<div class="historial">${anteriores.map((d) => `<div class="historial-fila">
			<span>v${d.version} · ${esc(d.nombre)} · ${esc(fecha(d.subido_en))}${d.fase ? ` · ${esc(FASES[d.fase] ?? '')}` : ''}</span>
			<button class="enlace" type="button" data-bajar="documentos" data-ruta="${esc(d.ruta)}" data-nombre="${esc(d.nombre)}">Descargar</button>
		</div>`).join('')}</div>` : ''}
		<div class="acciones">
			<label class="boton secundario pequeno subir">${anteriores.length ? 'Subir versión nueva' : 'Subir archivo'}
				<input type="file" data-subir="${r.id}">
			</label>
		</div>
		<p class="aviso" data-progreso="${r.id}" role="status" hidden></p>
	</article>`;
}

interface Promo { id: string; promotora_id: string; fase_proyecto?: string | null }

/** Pinta la pestaña. `recargar` vuelve a pintarla (con un aviso, si lo hay). */
export async function pintarDocumentacion(caja: HTMLElement, p: Promo, requisitos: Requisito[], documentos: Documento[],
	recargar: (mensaje?: string) => Promise<void>, cubre: Cubre = new Map()): Promise<void> {
	const bloques = new Map<string, Requisito[]>();
	for (const r of requisitos) bloques.set(r.bloque, [...(bloques.get(r.bloque) ?? []), r]);
	const cubiertos = cubiertosPor(documentos, cubre);
	const htmlDocs = [...bloques].map(([bloque, rs]) => `<div class="bloque"><h3>${esc(bloque)}</h3>${rs.map((r) => {
		const suyos = documentos.filter((d) => d.requisito_id === r.id);
		if (!suyos.length && cubiertos.get(r.id)?.length) return htmlCubierto(r, cubiertos.get(r.id)!, requisitos);
		return r.varios ? htmlVarios(r, suyos, requisitos, cubre) : htmlUnico(r, suyos, requisitos, cubre);
	}).join('')}</div>`).join('');
	const fase = p.fase_proyecto ?? null;
	const historial = await leerHistorialFases(sb, p.id);
	caja.innerHTML = `
		<h2>Documentación</h2>
		${htmlFase(fase, historial, 'promotora')}
		<p class="ayuda">Lo que necesitamos para preparar la promoción. Sube tus archivos tal como los tengas, de hasta 50 MB cada uno: no hace falta adaptarlos a MUNE. Si un mismo archivo contiene varias cosas de la lista (por ejemplo, plantas, alzados y superficies), súbelo una vez y marca en él todo lo que incluye. Para sustituir un archivo, sube una versión nueva: las anteriores se conservan. Si tus planos están en DWG, súbelos también en DXF (en AutoCAD: Guardar como → DXF): es el formato con el que trabajamos.</p>
		${htmlDocs || '<p class="vacio">El equipo de MUNE aún no ha preparado la lista de documentos de esta promoción.</p>'}`;
	conectarFase(caja, sb, p.id, fase, () => recargar('Fase del proyecto guardada.'), (e) => traducir(e, 'cambiar la fase'));

	// sin fase indicada no se sube nada: cada documento tiene que llevar su fase
	if (!fase) {
		caja.querySelectorAll<HTMLInputElement>('[data-subir], [data-sustituir]').forEach((input) => {
			input.disabled = true;
			input.closest('label')?.classList.add('desactivado');
		});
		caja.querySelectorAll<HTMLFormElement>('[data-anadir]').forEach((f) => {
			f.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button').forEach((x) => { x.disabled = true; });
			f.closest('details')?.classList.add('desactivado');
		});
	}

	const subirYAvisar = async (requisito: number, archivo: File, campos: Record<string, unknown>, bloquear: () => void, liberar: () => void) => {
		const aviso = caja.querySelector<HTMLElement>(`[data-progreso="${requisito}"]`)!;
		aviso.hidden = false;
		aviso.classList.remove('error');
		bloquear();
		try {
			await subir(p, requisito, archivo, campos, aviso);
			await recargar();
			// (la pestaña se ha vuelto a pintar: se busca en la página nueva)
			const nuevo = document.querySelector<HTMLElement>(`[data-progreso="${requisito}"]`);
			if (nuevo) {
				nuevo.hidden = false;
				nuevo.textContent = `Hemos recibido «${archivo.name}». Lo revisaremos y verás aquí su estado.`
					+ (/\.dwg$/i.test(archivo.name) ? ' Si puedes, sube también este plano en DXF (en AutoCAD: Guardar como → DXF): es el formato con el que trabajamos.' : '');
			}
		} catch (e) {
			aviso.classList.add('error');
			aviso.textContent = traducir(e, 'subir el archivo');
			liberar();
		}
	};

	caja.querySelectorAll<HTMLInputElement>('[data-subir]').forEach((input) => input.addEventListener('change', () => {
		const archivo = input.files?.[0];
		if (archivo) void subirYAvisar(Number(input.dataset.subir), archivo, {}, () => { input.disabled = true; }, () => { input.disabled = false; input.value = ''; });
	}));
	caja.querySelectorAll<HTMLInputElement>('[data-sustituir]').forEach((input) => input.addEventListener('change', () => {
		const archivo = input.files?.[0];
		if (archivo) void subirYAvisar(Number(input.dataset.requisito), archivo, { reemplaza_a: Number(input.dataset.sustituir) },
			() => { input.disabled = true; }, () => { input.disabled = false; input.value = ''; });
	}));
	caja.querySelectorAll<HTMLFormElement>('[data-incluye]').forEach((form) => form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		const error = form.querySelector<HTMLElement>('.error')!;
		const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
		error.textContent = '';
		boton.disabled = true;
		const marcados = [...form.querySelectorAll<HTMLInputElement>('input[name=requisito]:checked')].map((x) => Number(x.value));
		const { error: e } = await sb.rpc('cubrir_requisitos', { p_documento: Number(form.dataset.incluye), p_requisitos: marcados });
		if (e) { error.textContent = traducir(e, 'guardar lo que incluye el archivo'); boton.disabled = false; return; }
		await recargar(marcados.length ? 'Guardado: ese archivo cuenta también para lo que has marcado.' : 'Guardado.');
	}));
	caja.querySelectorAll<HTMLFormElement>('[data-anadir]').forEach((form) => form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		const error = form.querySelector<HTMLElement>('.error')!;
		const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
		error.textContent = '';
		const d = new FormData(form);
		const contenido = String(d.get('contenido') ?? '').trim();
		const archivo = form.querySelector<HTMLInputElement>('input[type=file]')!.files?.[0];
		if (!contenido) { error.textContent = 'Elige qué contiene el archivo.'; return; }
		if (!archivo) { error.textContent = 'Elige el archivo que quieres añadir.'; return; }
		void subirYAvisar(Number(form.dataset.anadir), archivo, { contenido, detalle: String(d.get('detalle') ?? '').trim() || null },
			() => { boton.disabled = true; }, () => { boton.disabled = false; });
	}));
}

async function huella(archivo: File): Promise<string> {
	const h = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer());
	return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Nombre seguro para el almacén: sin tildes, espacios ni símbolos raros. */
function nombreSeguro(nombre: string): string {
	return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-100) || 'archivo';
}

async function subir(p: Promo, requisito: number, archivo: File, campos: Record<string, unknown>, aviso: HTMLElement): Promise<void> {
	if (archivo.size > MAX_TAM) throw new Error('El archivo pesa más de 50 MB y no se ha podido subir. Si necesitas enviar uno más grande, escribe al equipo de MUNE.');
	if (archivo.size === 0) throw new Error('El archivo está vacío. Comprueba que es el correcto y vuelve a subirlo.');
	aviso.textContent = `Subiendo «${archivo.name}»… Con archivos grandes puede tardar un poco; no cierres la página.`;
	const ruta = `${p.promotora_id}/${p.id}/${requisito}/${Date.now()}-${nombreSeguro(archivo.name)}`;
	const tipo = archivo.type || 'application/octet-stream';
	const [firma, subida] = await Promise.all([
		huella(archivo),
		sb.storage.from('documentos').upload(ruta, archivo, { contentType: tipo, upsert: false }),
	]);
	if (subida.error) throw subida.error;
	const { data: subido, error } = await sb.from('documentos').insert({
		promocion_id: p.id, requisito_id: requisito, nombre: archivo.name.slice(0, 200), ruta, tipo: tipo.slice(0, 120), tamano: archivo.size, huella: firma,
		...campos,
	}).select('id').single();
	if (error) throw error;
	// Aviso por email al equipo de MUNE (si falla, el documento ya está subido igualmente).
	void sb.functions.invoke('aviso-subida', { body: { documento_id: subido.id } }).catch(() => undefined);
}

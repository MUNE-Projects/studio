// Pestaña «Documentación» de una promoción (Etapa 3 · recetas 2 y 13).
//
// · Lo que ha subido la promotora, documento a documento y con todas sus
//   versiones: descargar, aceptar o rechazar con una nota (la promotora ve el
//   estado y la nota en MUNE Portal). Los documentos que admiten varios
//   archivos (020) muestran cada archivo con lo que contiene y su historial, y
//   se revisa archivo a archivo.
// · La lista de documentos que tiene que entregar, que se puede ajustar.
// · Un archivo puede cubrir varios documentos de la lista (022): se ve en el
//   archivo («También incluye…») y en los documentos que cubre («Incluido en…»).
//
// Las reglas (005, 008) dejan a la administradora cambiar solo el estado y la
// nota; nadie puede borrar ni sobrescribir un documento.

import { FASES, conectarFase, htmlFase, leerHistorialFases } from './fase';
import { avisarPromotora } from './avisos';
import { alEnviar, anotar, conectarPlegables, esc, fecha, sb, traducir } from './comun';

interface PromocionMin { id: string; nombre: string; promotora_id: string; fase_proyecto?: string | null }
interface Requisito {
	id: number; bloque: string; elemento: string; descripcion: string; obligatorio: boolean; activo: boolean;
	varios?: boolean; contenidos?: string[] | null;
}
interface Documento {
	id: number; requisito_id: number; nombre: string; ruta: string; tamano: number; version: number;
	estado: string; nota: string | null; subido_por: string; subido_en: string; revisado_en: string | null; fase?: string | null;
	reemplaza_a?: number | null; contenido?: string | null; detalle?: string | null;
}

const BLOQUES = ['Planos', 'Viviendas y superficies', 'Calidades', 'Marca', 'Datos legales', 'Personalización'];
const ESTADOS_DOC: Record<string, [string, string]> = {
	pendiente: ['En revisión', 'pendiente'],
	vigente: ['Aceptado', 'al-dia'],
	rechazado: ['Rechazado', 'rechazado'],
};

function tamano(bytes: number): string {
	return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Descarga con un enlace temporal de 1 minuto. */
async function descargar(ruta: string, nombre: string, promocion: string): Promise<void> {
	const { data, error } = await sb.storage.from('documentos').createSignedUrl(ruta, 60, { download: nombre });
	if (error) { alert(traducir(error)); return; }
	void anotar('descarga un documento', { promocion, nombre });
	const a = document.createElement('a');
	a.href = data.signedUrl;
	a.rel = 'noopener';
	a.click();
}

/**
 * Cadenas de versiones de un requisito, de la más reciente a la más antigua.
 * Sin «varios archivos», una sola cadena. Con varios, una por archivo: la
 * última versión es la que nadie sustituye, y se sigue «reemplaza_a» hacia atrás.
 */
function cadenasDe(r: Requisito, documentos: Documento[]): Documento[][] {
	const suyos = documentos.filter((d) => d.requisito_id === r.id);
	if (!suyos.length) return [];
	if (!r.varios) return [suyos];
	const porId = new Map(suyos.map((d) => [d.id, d]));
	const sustituidos = new Set(suyos.map((d) => d.reemplaza_a).filter((x): x is number => typeof x === 'number'));
	return suyos.filter((d) => !sustituidos.has(d.id))
		.map((ultima) => {
			const cadena = [ultima];
			for (let d = ultima; d.reemplaza_a && porId.has(d.reemplaza_a) && cadena.length < 500;) {
				d = porId.get(d.reemplaza_a)!;
				cadena.push(d);
			}
			return cadena;
		})
		// en el orden en que se añadió cada archivo (su primera versión)
		.sort((a, b) => a[a.length - 1].id - b[b.length - 1].id);
}

/** Estado de un requisito según la última versión de cada archivo: en revisión > rechazado > aceptado. */
function estadoConjunto(ultimas: Documento[]): string | null {
	if (!ultimas.length) return null;
	if (ultimas.some((d) => d.estado === 'pendiente')) return 'pendiente';
	if (ultimas.some((d) => d.estado === 'rechazado')) return 'rechazado';
	return 'vigente';
}

/** Un archivo (o el documento entero, si no admite varios) con su historial, y aceptar o rechazar su última versión. */
function htmlCadena(versiones: Documento[], varios: boolean, quien: Map<string, string>, incluye: string[] = []): string {
	const u = versiones[0];
	const [etiqueta, clase] = ESTADOS_DOC[u.estado] ?? [u.estado, ''];
	return `<div class="${varios ? 'archivo-doc' : ''}">
		${varios ? `<div class="promo-cabeza"><span><strong>${esc(u.contenido ?? 'Archivo')}</strong>${u.detalle ? ` · ${esc(u.detalle)}` : ''}</span>
			<span class="estado ${clase}">${esc(etiqueta)}</span></div>` : ''}
		${incluye.length ? `<p class="promo-lugar">También incluye: ${esc(incluye.join(', '))}</p>` : ''}
		<div class="historial">${versiones.map((d, i) => `<div class="historial-fila">
			<span><strong>v${d.version}</strong> · ${esc(d.nombre)} · ${esc(tamano(d.tamano))} · ${esc(fecha(d.subido_en))}${d.fase ? ` · ${FASES[d.fase] ?? ''}` : ''} · ${esc(quien.get(d.subido_por) ?? '—')}
				${i > 0 || d.estado !== 'pendiente' ? ` · <span class="estado ${ESTADOS_DOC[d.estado]?.[1] ?? ''}">${esc(ESTADOS_DOC[d.estado]?.[0] ?? d.estado)}</span>` : ''}</span>
			<button class="enlace" type="button" data-bajar="${d.id}">Descargar</button>
		</div>${d.nota ? `<p class="promo-lugar nota-doc">Nota: ${esc(d.nota)}</p>` : ''}`).join('')}</div>
		<div class="acciones">
			${u.estado !== 'vigente' ? `<button class="boton pequeno" type="button" data-vigente="${u.id}">Aceptar v${u.version}</button>` : ''}
			${u.estado !== 'rechazado' ? `<button class="boton secundario pequeno" type="button" data-abrir="rechazo-${u.id}">Rechazar v${u.version}…</button>` : ''}
		</div>
		<form class="peticion-form" data-rechazo="${u.id}" data-plegable="rechazo-${u.id}" hidden novalidate>
			<label>¿Por qué se rechaza? (lo verá la promotora)
				<textarea name="nota" rows="3" maxlength="2000" required placeholder="Por ejemplo: faltan las cotas de la cocina; sube el plano acotado."></textarea>
			</label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Rechazar</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>
	</div>`;
}

export async function pintarDocumentacion(caja: HTMLElement, p: PromocionMin): Promise<void> {
	const [reqs, docs, personas, historial, cubreR] = await Promise.all([
		sb.from('requisitos').select('id, bloque, elemento, descripcion, obligatorio, activo, varios, contenidos').eq('promocion_id', p.id).order('orden').order('id'),
		sb.from('documentos').select('id, requisito_id, nombre, ruta, tamano, version, estado, nota, subido_por, subido_en, revisado_en, fase, reemplaza_a, contenido, detalle')
			.eq('promocion_id', p.id).order('version', { ascending: false }),
		sb.from('miembros').select('user_id, nombre').eq('promotora_id', p.promotora_id),
		leerHistorialFases(sb, p.id),
		sb.from('documento_cubre').select('documento_id, requisito_id, documentos!inner(promocion_id)').eq('documentos.promocion_id', p.id),
	]);
	for (const r of [reqs, docs, personas, cubreR]) if (r.error) throw r.error;
	const requisitos = (reqs.data ?? []) as Requisito[];
	const documentos = (docs.data ?? []) as Documento[];
	const quien = new Map(((personas.data ?? []) as { user_id: string; nombre: string }[]).map((x) => [x.user_id, x.nombre]));
	const recargar = () => pintarDocumentacion(caja, p);
	// Cada requisito tiene una o varias cadenas de versiones (una por archivo, si admite varios).
	const cadenas = new Map(requisitos.map((r) => [r.id, cadenasDe(r, documentos)]));
	// Lo que cubre cada archivo además de su documento (solo cuentan las versiones que nadie sustituye).
	const cubre = new Map<number, number[]>();
	for (const x of (cubreR.data ?? []) as { documento_id: number; requisito_id: number }[]) cubre.set(x.documento_id, [...(cubre.get(x.documento_id) ?? []), x.requisito_id]);
	const sustituidos = new Set(documentos.map((d) => d.reemplaza_a).filter((x): x is number => typeof x === 'number'));
	const cubiertoPor = (r: Requisito) => documentos.filter((d) => !sustituidos.has(d.id) && (cubre.get(d.id) ?? []).includes(r.id));
	const nombreReq = new Map(requisitos.map((r) => [r.id, r.elemento]));
	const incluye = (d: Documento) => (cubre.get(d.id) ?? []).map((id) => nombreReq.get(id) ?? '').filter(Boolean);
	const propios = (r: Requisito) => (cadenas.get(r.id) ?? []).map((c) => c[0]);
	// sin archivo propio, cuenta el archivo que lo incluye
	const ultimos = (r: Requisito) => propios(r).length ? propios(r) : cubiertoPor(r);
	const estadoReq = (r: Requisito) => estadoConjunto(ultimos(r));

	const activos = requisitos.filter((r) => r.activo);
	const obligatorios = activos.filter((r) => r.obligatorio);
	const entregados = obligatorios.filter((r) => ultimos(r).some((d) => d.estado !== 'rechazado')).length;
	const porRevisar = activos.filter((r) => ultimos(r).some((d) => d.estado === 'pendiente')).length;
	const vigentes = activos.filter((r) => estadoReq(r) === 'vigente').length;

	const bloques = new Map<string, Requisito[]>();
	for (const r of activos) bloques.set(r.bloque, [...(bloques.get(r.bloque) ?? []), r]);

	caja.innerHTML = `
		<h2>Documentación</h2>
		${htmlFase(p.fase_proyecto, historial, 'administradora')}
		<p class="resumen-docs">
			<span class="estado ${entregados === obligatorios.length && obligatorios.length ? 'al-dia' : 'pendiente'}">Obligatorios entregados: ${entregados} de ${obligatorios.length}</span>
			<span class="estado ${porRevisar ? 'pendiente' : ''}">En revisión: ${porRevisar}</span>
			<span class="estado ${vigentes ? 'al-dia' : ''}">Aceptados: ${vigentes}</span>
		</p>
		<p class="ayuda">Cuando aceptas o rechazas un documento, la promotora lo ve en MUNE Portal. Si lo rechazas, explica el motivo: la promotora recibirá tu nota tal cual, también por email.</p>
		${[...bloques].map(([bloque, rs]) => `<div class="bloque-docs"><h3>${esc(bloque)}</h3>${rs.map((r) => {
			const lista = cadenas.get(r.id) ?? [];
			const estado = estadoReq(r);
			const [etiqueta, clase] = estado ? ESTADOS_DOC[estado] ?? [estado, ''] : r.obligatorio ? ['Falta por entregar', 'pendiente'] : ['Opcional', ''];
			return `<article class="requisito-doc" data-requisito-doc="${r.id}">
				<div class="promo-cabeza">
					<span><strong>${esc(r.elemento)}</strong>${r.obligatorio ? '' : ' <span class="promo-lugar">(opcional)</span>'}${r.varios && lista.length ? ` <span class="promo-lugar">· ${lista.length === 1 ? '1 archivo' : `${lista.length} archivos`}</span>` : ''}</span>
					<span class="estado ${clase}">${esc(etiqueta)}</span>
				</div>
				${lista.length ? lista.map((versiones) => htmlCadena(versiones, !!r.varios, quien, incluye(versiones[0]))).join('')
					: cubiertoPor(r).length ? `<p class="promo-lugar">Incluido en ${cubiertoPor(r).map((d) => `«${esc(d.nombre)}» (en «${esc(nombreReq.get(d.requisito_id) ?? '')}»)`).join(', ')}. Se revisa en ese documento.</p>`
					: '<p class="vacio">La promotora todavía no ha subido nada.</p>'}
			</article>`;
		}).join('')}</div>`).join('') || '<p class="vacio">La lista de documentos está vacía. Pulsa «Ajustar la lista de documentos» para añadir la lista estándar o documentos sueltos.</p>'}
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-ajustar>Ajustar la lista de documentos</button></div>
		<div data-requisitos hidden></div>`;

	conectarPlegables(caja);
	// la fase también se ve en la cabecera de la promoción: se recarga la página entera
	conectarFase(caja, sb, p.id, p.fase_proyecto, () => location.reload(), traducir);
	caja.querySelectorAll<HTMLButtonElement>('[data-bajar]').forEach((b) => b.addEventListener('click', () => {
		const d = documentos.find((x) => x.id === Number(b.dataset.bajar))!;
		void descargar(d.ruta, d.nombre, p.id);
	}));
	caja.querySelectorAll<HTMLButtonElement>('[data-vigente]').forEach((b) => b.addEventListener('click', async () => {
		b.disabled = true;
		const { error } = await sb.from('documentos').update({ estado: 'vigente', nota: null }).eq('id', Number(b.dataset.vigente));
		if (error) { b.disabled = false; alert(traducir(error)); return; }
		await recargar();
	}));
	caja.querySelectorAll<HTMLFormElement>('[data-rechazo]').forEach((form) => alEnviar(form, async (d) => {
		const nota = String(d.get('nota')).trim();
		if (nota.length < 5) throw new Error('Explica por qué se rechaza, para que la promotora sepa qué corregir.');
		const { error } = await sb.from('documentos').update({ estado: 'rechazado', nota }).eq('id', Number(form.dataset.rechazo));
		if (error) throw error;
		const aviso = await avisarPromotora({ tipo: 'rechazado', documento_id: Number(form.dataset.rechazo) });
		await recargar();
		alert(`Documento rechazado. ${aviso}`);
	}));
	const ajustar = caja.querySelector<HTMLButtonElement>('[data-ajustar]')!;
	const lista = caja.querySelector<HTMLElement>('[data-requisitos]')!;
	ajustar.addEventListener('click', () => {
		lista.hidden = !lista.hidden;
		if (!lista.hidden) void pintarRequisitos(p, lista, recargar);
	});
}

async function pintarRequisitos(p: PromocionMin, destino: HTMLElement, alCambiar: () => Promise<void>): Promise<void> {
	const { data, error } = await sb.from('requisitos').select('id, bloque, elemento, descripcion, obligatorio, activo, varios, contenidos')
		.eq('promocion_id', p.id).order('orden').order('id');
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const reqs = (data ?? []) as Requisito[];
	const bloques = [...new Set([...BLOQUES, ...reqs.map((r) => r.bloque)])];
	destino.innerHTML = `<div class="requisitos">
		${reqs.length ? `<ul>${reqs.map((r) => `<li class="${r.activo ? '' : 'quitado'}"><strong>${esc(r.bloque)}</strong> · ${esc(r.elemento)}${r.obligatorio ? '' : ' <span class="promo-lugar">(opcional)</span>'}
			${r.varios ? ` <span class="promo-lugar">(varios archivos${r.contenidos?.length ? `: ${esc(r.contenidos.join(', '))}` : ''})</span>` : ''}
			${r.activo ? '' : ' <span class="promo-lugar">(quitado de la lista)</span>'}
			<button class="enlace" type="button" data-requisito="${r.id}" data-activo="${r.activo}">${r.activo ? 'Quitar' : 'Volver a poner'}</button>
			${r.descripcion ? `<br><span class="promo-lugar">${esc(r.descripcion)}</span>` : ''}</li>`).join('')}</ul>` : ''}
		${reqs.some((r) => r.activo) ? '' : `<p class="vacio">La lista está vacía: la promotora no verá nada que entregar.</p>
			<div class="acciones"><button class="boton secundario pequeno" type="button" data-estandar>Añadir la lista estándar</button></div>`}
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="requisito">Añadir un documento a la lista</button></div>
		<form class="peticion-form" data-plegable="requisito" hidden novalidate>
			<label>Bloque <input name="bloque" list="bloques-${esc(p.id)}" maxlength="80" required placeholder="Por ejemplo: Planos"></label>
			<datalist id="bloques-${esc(p.id)}">${bloques.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
			<label>Qué tiene que entregar <input name="elemento" maxlength="120" required placeholder="Por ejemplo: Plano de planta de cada tipología (PDF o DWG)"></label>
			<label>Explicación para la promotora (opcional) <input name="descripcion" maxlength="1000"></label>
			<label class="en-linea"><input name="obligatorio" type="checkbox" checked> Obligatorio</label>
			<label class="en-linea"><input name="varios" type="checkbox" data-varios> Admite varios archivos</label>
			<label data-contenidos hidden>¿Qué contiene? Opciones para que la promotora indique qué es cada archivo, separadas por comas
				<input name="contenidos" maxlength="600" placeholder="Por ejemplo: Memoria técnica, Cuadro de carpinterías, Fichas técnicas">
				<span class="promo-lugar">Se añade «Otro» al final.</span></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton pequeno" type="submit">Añadir a la lista</button>
				<button class="boton secundario pequeno" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>
	</div>`;
	conectarPlegables(destino);
	destino.querySelectorAll<HTMLButtonElement>('[data-requisito]').forEach((b) => b.addEventListener('click', async () => {
		const activo = b.dataset.activo !== 'true';
		b.disabled = true;
		const { error: e } = await sb.from('requisitos').update({ activo }).eq('id', Number(b.dataset.requisito));
		if (e) { b.disabled = false; alert(traducir(e)); return; }
		await anotar(activo ? 'vuelve a poner un documento en la lista' : 'quita un documento de la lista', { promocion: p.id, requisito: Number(b.dataset.requisito) });
		await alCambiar();
	}));
	destino.querySelector<HTMLButtonElement>('[data-estandar]')?.addEventListener('click', async (ev) => {
		(ev.currentTarget as HTMLButtonElement).disabled = true;
		const { error: e } = await sb.rpc('aplicar_lista_estandar', { p_promocion: p.id });
		if (e) alert(traducir(e));
		await alCambiar();
	});
	const formReq = destino.querySelector<HTMLFormElement>('form[data-plegable="requisito"]')!;
	const casillaVarios = formReq.querySelector<HTMLInputElement>('[data-varios]')!;
	casillaVarios.addEventListener('change', () => { formReq.querySelector<HTMLElement>('[data-contenidos]')!.hidden = !casillaVarios.checked; });
	alEnviar(formReq, async (d) => {
		const varios = d.get('varios') === 'on';
		const contenidos = varios ? [...new Set(String(d.get('contenidos') ?? '').split(',').map((x) => x.trim()).filter(Boolean))] : [];
		if (varios && !contenidos.length) throw new Error('Indica qué puede contener cada archivo (por ejemplo: Memoria técnica, Cuadro de carpinterías).');
		if (contenidos.some((x) => x.length > 80)) throw new Error('Cada opción de «¿Qué contiene?» puede tener como mucho 80 caracteres.');
		if (varios && !contenidos.some((x) => x.toLowerCase() === 'otro')) contenidos.push('Otro');
		const fila = {
			promocion_id: p.id,
			bloque: String(d.get('bloque')).trim(),
			elemento: String(d.get('elemento')).trim(),
			descripcion: String(d.get('descripcion')).trim(),
			obligatorio: d.get('obligatorio') === 'on',
			orden: reqs.length + 1,
			varios,
			contenidos,
		};
		if (!fila.bloque || !fila.elemento) throw new Error('Indica el bloque y qué tiene que entregar.');
		const { error: e } = await sb.from('requisitos').insert(fila);
		if (e) throw e;
		await anotar('añade un documento a la lista', { promocion: p.id, elemento: fila.elemento });
		await alCambiar();
	});
}

// Exportar todo lo de una promoción o de una promotora (receta 20): un ZIP con
// los datos (datos.json y un LEEME.txt legible) y todos los archivos
// (documentos subidos con sus versiones, planos entregados, fotos de las
// peticiones y el modelo de la promoción: sus datos de trabajo y los de cada
// versión preparada, 035_modelo_promocion.sql). Cada archivo se comprueba con su huella al descargarlo.
// Es obligatorio antes de borrar y recomendable antes de desactivar.

import { anotar, sb } from './comun';
import { Zip } from './zip';

type Fila = Record<string, unknown>;

export interface Resultado { archivos: number; avisos: string[] }

/** Para el nombre del ZIP: sin tildes ni símbolos («Construcciones Peñón» → Construcciones-Penon). */
const paraArchivo = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') || 'promotora';
const limpio = (texto: string) => texto.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || 'sin nombre';
const hoy = () => new Date().toISOString().slice(0, 10);
const json = (datos: unknown) => JSON.stringify(datos, null, '\t');

async function leer<T = Fila>(consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
	const { data, error } = await consulta;
	if (error) throw error;
	return (data ?? []) as T[];
}

async function huella(datos: Uint8Array): Promise<string> {
	const h = await crypto.subtle.digest('SHA-256', datos as BufferSource);
	return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Descarga un archivo del almacén; si se espera una huella, la comprueba. */
async function bajar(almacen: string, ruta: string, esperada: string | null, avisos: string[]): Promise<Uint8Array | null> {
	const { data, error } = await sb.storage.from(almacen).download(ruta);
	if (error || !data) {
		avisos.push(`No se ha podido descargar ${almacen}/${ruta}`);
		return null;
	}
	const datos = new Uint8Array(await data.arrayBuffer());
	if (esperada && (await huella(datos)) !== esperada) avisos.push(`El archivo descargado no coincide con el original guardado: ${almacen}/${ruta}`);
	return datos;
}

/** Mete en el ZIP, bajo «carpeta», todo lo de una promoción. Devuelve el resumen para el LEEME. */
async function anadirPromocion(zip: Zip, carpeta: string, id: string, equipo: Fila[], avisos: string[], progreso: (t: string) => void): Promise<string> {
	const [[promocion], requisitos, documentos, entregables, validaciones, peticiones, registro, codigos, selecciones, modelos, registroVersiones] = await Promise.all([
		leer(sb.from('promociones').select('*').eq('id', id)),
		leer(sb.from('requisitos').select('*').eq('promocion_id', id).order('orden').order('id')),
		leer(sb.from('documentos').select('*').eq('promocion_id', id).order('requisito_id').order('version')),
		leer(sb.from('entregables').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('validaciones').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('peticiones').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('registro').select('*').eq('detalle->>promocion', id).order('momento')),
		leer(sb.rpc('codigos_de_promocion', { p_promocion: id })),
		leer(sb.from('selecciones_comprador').select('*').eq('promocion_id', id).order('vivienda_ref').order('comprador')),
		leer(sb.from('modelo_promocion').select('id, version, archivos, huella, codigo, nota, guardado_en').eq('promocion_id', id).order('id')),
		leer(sb.from('versiones_promocion').select('*').eq('promocion_id', id).order('numero')),
	]);
	const reqPorId = new Map(requisitos.map((r) => [r.id, r]));
	const lineas: string[] = [];

	// Documentos subidos por la promotora, por elemento de la lista y versión.
	lineas.push(`Documentos subidos: ${documentos.length}`);
	for (const [i, d] of documentos.entries()) {
		progreso(`Descargando documentos de ${String(promocion?.nombre ?? id)} (${i + 1} de ${documentos.length})…`);
		const r = reqPorId.get(d.requisito_id);
		const sub = `${String(r?.orden ?? 0).padStart(2, '0')} ${limpio(`${r?.bloque ?? ''} - ${r?.elemento ?? ''}`)}`;
		const ruta = `${carpeta}documentos/${sub}/v${d.version} - ${limpio(String(d.nombre))}`;
		const datos = await bajar('documentos', String(d.ruta), String(d.huella), avisos);
		if (datos) zip.anadir(ruta, datos);
		lineas.push(`  · ${r?.bloque} › ${r?.elemento} · v${d.version} · ${d.nombre} · ${d.estado}${d.nota ? ` («${d.nota}»)` : ''} · subido ${String(d.subido_en).slice(0, 10)}`);
	}

	// Planos e infografías entregados, por versión.
	lineas.push(`Entregables (planos, infografías, PDF): ${entregables.length}`);
	for (const e of entregables) {
		const datos = await bajar('entregables', String(e.ruta), String(e.huella), avisos);
		if (datos) zip.anadir(`${carpeta}entregables/${limpio(String(e.version))}/${limpio(String(e.ruta).split('/').pop() ?? String(e.nombre))}`, datos);
		const v = validaciones.find((x) => x.entregable_id === e.id);
		lineas.push(`  · ${e.version} · ${e.nombre}${v ? ` · ${v.decision} el ${String(v.momento).slice(0, 10)}${v.comentario ? ` («${v.comentario}»)` : ''}` : ' · sin validar'}`);
	}

	// Fotos de referencia de las peticiones de cambios.
	lineas.push(`Peticiones de cambios: ${peticiones.length}`);
	for (const p of peticiones) {
		const { data: fotos } = await sb.storage.from('referencias').list(String(p.id));
		for (const f of fotos ?? []) {
			const datos = await bajar('referencias', `${p.id}/${f.name}`, null, avisos);
			if (datos) zip.anadir(`${carpeta}peticiones/${p.id}/${limpio(f.name)}`, datos);
		}
		lineas.push(`  · #${p.id} (${p.estado}) ${String(p.texto).slice(0, 100)}`);
	}

	// Modelo de la promoción: los datos de trabajo más recientes y los de cada versión preparada.
	const trabajo = modelos.filter((m) => !m.version).at(-1);
	const versiones = modelos.filter((m) => m.version);
	lineas.push(`Modelo de la promoción: ${trabajo ? `datos de trabajo del ${String(trabajo.guardado_en).slice(0, 10)}` : 'sin datos de trabajo'} y ${versiones.length} ${versiones.length === 1 ? 'versión preparada' : 'versiones preparadas'}`);
	for (const m of [...(trabajo ? [trabajo] : []), ...versiones]) {
		const sub = m.version ? limpio(String(m.version)) : 'trabajo';
		for (const [ruta, texto] of Object.entries(m.archivos as Record<string, string>)) {
			zip.anadir(`${carpeta}modelo/${sub}/${ruta.split('/').map(limpio).join('/')}`, texto);
		}
		if (m.version) lineas.push(`  · ${m.version} · ${String(m.guardado_en).slice(0, 10)} · ${m.nota || 'sin nota'}`);
	}

	lineas.push(`Personas con acceso a esta promoción: ${equipo.length}`);
	for (const a of equipo) lineas.push(`  · ${a.nombre} <${a.email}>${a.cargo ? ` · ${a.cargo}` : ''}${a.activo ? '' : ' · acceso retirado'}`);

	lineas.push(`Viviendas con código de comprador: ${codigos.length} (los códigos no se exportan: por seguridad, MUNE no los guarda)`);
	zip.anadir(`${carpeta}datos.json`, json({ promocion, equipo, requisitos, documentos, entregables, validaciones, peticiones, codigos_de_comprador: codigos, selecciones_de_comprador: selecciones, versiones: registroVersiones, registro }));
	return [`■ ${promocion?.nombre ?? id} (${id})`, ...lineas].join('\n');
}

function leeme(titulo: string, cuerpo: string, avisos: string[]): string {
	return [
		`MUNE · Exportación de ${titulo}`,
		`Fecha: ${new Date().toLocaleString('es-ES')}`,
		'',
		'Contenido:',
		'  · datos.json: todos los datos (ficha, datos fiscales, lista de documentos, equipo, peticiones, compradores y actividad).',
		'  · documentos/: lo que subió la promotora, con todas sus versiones.',
		'  · entregables/: planos, infografías y PDF entregados, por versión.',
		'  · peticiones/: fotos de referencia de las peticiones de cambios.',
		'  · modelo/: los datos con los que MUNE construye la promoción (trabajo/ los más recientes; v1, v2… los de cada versión preparada).',
		'',
		avisos.length ? `ATENCIÓN, ${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}:\n${avisos.map((a) => `  ! ${a}`).join('\n')}` : 'Todos los archivos se han descargado completos y coinciden con los originales.',
		'',
		cuerpo,
		'',
	].join('\n');
}

function guardar(zip: Zip, nombre: string): void {
	const url = URL.createObjectURL(zip.cerrar());
	const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportarPromocion(id: string, progreso: (t: string) => void = () => {}): Promise<Resultado> {
	const [promocion] = await leer(sb.from('promociones').select('promotora_id, nombre').eq('id', id));
	if (!promocion) throw new Error('No se ha encontrado la promoción. Puede que se haya borrado.');
	const [promotora] = await leer(sb.from('promotoras').select('*').eq('id', promocion.promotora_id));
	const equipo = (await leer(sb.rpc('accesos', { p_promotora: promocion.promotora_id }))).filter((a) => a.promocion_id === id);
	const zip = new Zip();
	const avisos: string[] = [];
	const cuerpo = await anadirPromocion(zip, '', id, equipo, avisos, progreso);
	zip.anadir('promotora.json', json(promotora));
	zip.anadir('LEEME.txt', leeme(`la promoción «${promocion.nombre}»`, cuerpo, avisos));
	guardar(zip, `MUNE-${id}-${hoy()}.zip`);
	await anotar('exporta una promoción', { promocion: id, archivos: zip.cuantos, avisos: avisos.length });
	return { archivos: zip.cuantos, avisos };
}

export async function exportarPromotora(id: string, progreso: (t: string) => void = () => {}): Promise<Resultado> {
	const [promotora] = await leer(sb.from('promotoras').select('*').eq('id', id));
	if (!promotora) throw new Error('No se ha encontrado la promotora. Puede que se haya borrado.');
	const [promociones, accesos, registro] = await Promise.all([
		leer(sb.from('promociones').select('id').eq('promotora_id', id).order('nombre')),
		leer(sb.rpc('accesos', { p_promotora: id })),
		leer(sb.from('registro').select('*').eq('detalle->>promotora', id).order('momento')),
	]);
	const zip = new Zip();
	const avisos: string[] = [];
	const partes: string[] = [];
	for (const p of promociones) {
		const pid = String(p.id);
		partes.push(await anadirPromocion(zip, `promociones/${limpio(pid)}/`, pid, accesos.filter((a) => a.promocion_id === pid), avisos, progreso));
	}
	const todas = accesos.filter((a) => a.promocion_id === null);
	zip.anadir('datos.json', json({ promotora, acceso_a_todas: todas, accesos, registro }));
	const cabecera = [
		`Promociones: ${promociones.length}`,
		`Personas con acceso a todas las promociones: ${todas.length}`,
		...todas.map((a) => `  · ${a.nombre} <${a.email}>${a.cargo ? ` · ${a.cargo}` : ''}`),
	].join('\n');
	zip.anadir('LEEME.txt', leeme(`la promotora «${promotora.nombre}»`, [cabecera, ...partes].join('\n\n'), avisos)
		.replace('  · datos.json: todos los datos', '  · datos.json: los datos de la promotora y sus accesos. Cada promoción tiene su carpeta en promociones/, con su datos.json')
		.replace(/  · (documentos|entregables|peticiones)\//g, '  · promociones/<promoción>/$1/'));
	guardar(zip, `MUNE-${paraArchivo(String(promotora.nombre))}-${hoy()}.zip`);
	await anotar('exporta una promotora', { promotora: id, archivos: zip.cuantos, avisos: avisos.length });
	return { archivos: zip.cuantos, avisos };
}

// ── Exportación para la promotora, al eliminar (decisión 70, 045) ──────────
// Solo lo que corresponde a la promotora: su documentación con todas sus
// versiones, los planos y materiales que le ha entregado MUNE y los datos de
// la promoción (ficha, equipo, selecciones de compradores, catálogo,
// validaciones y comentarios). Nada interno de MUNE: ni el modelo, ni las
// peticiones y sus fotos, ni el registro de actividad, ni la web construida.
// Se sube en partes de 40 MB como mucho al almacén privado «exportaciones», se
// comprueba cada parte y se envía con un enlace privado (función «exportacion»).

const MAX_PARTE = 40 * 1024 * 1024;

class Partes {
	zips: Zip[] = [new Zip()];
	archivos = 0;
	anadir(ruta: string, contenido: Uint8Array | string): void {
		const tam = typeof contenido === 'string' ? contenido.length * 3 : contenido.length;
		let actual = this.zips.at(-1)!;
		if (actual.cuantos && actual.bytes + tam > MAX_PARTE) this.zips.push((actual = new Zip()));
		actual.anadir(ruta, contenido);
		this.archivos++;
	}
}

async function anadirParaPromotora(partes: Partes, carpeta: string, id: string, equipo: Fila[], avisos: string[], progreso: (t: string) => void): Promise<string> {
	const [[promocion], requisitos, documentos, entregables, validaciones, aprobaciones, selecciones, categorias, ajustes, packs, comentarios] = await Promise.all([
		leer(sb.from('promociones').select('*').eq('id', id)),
		leer(sb.from('requisitos').select('*').eq('promocion_id', id).order('orden').order('id')),
		leer(sb.from('documentos').select('*').eq('promocion_id', id).order('requisito_id').order('version')),
		leer(sb.from('entregables').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('validaciones').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('aprobaciones').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('selecciones_comprador').select('*').eq('promocion_id', id).order('vivienda_ref').order('comprador')),
		leer(sb.from('catalogo_categorias').select('*').eq('promocion_id', id)),
		leer(sb.from('catalogo_ajustes').select('*').eq('promocion_id', id)),
		leer(sb.from('packs_promocion').select('*').eq('promocion_id', id)),
		sb.rpc('comentarios_de', { p_promocion: id }).then((r) => ({ data: ((r.data ?? []) as Fila[]).filter((c) => !c.interno), error: r.error })).then((r) => r.data),
	]);
	const reqPorId = new Map(requisitos.map((r) => [r.id, r]));
	const lineas: string[] = [];
	lineas.push(`Documentación subida: ${documentos.length}`);
	for (const [i, d] of documentos.entries()) {
		progreso(`Preparando la documentación de ${String(promocion?.nombre ?? id)} (${i + 1} de ${documentos.length})…`);
		const r = reqPorId.get(d.requisito_id);
		const sub = `${String(r?.orden ?? 0).padStart(2, '0')} ${limpio(`${r?.bloque ?? ''} - ${r?.elemento ?? ''}`)}`;
		const datos = await bajar('documentos', String(d.ruta), String(d.huella), avisos);
		if (datos) partes.anadir(`${carpeta}documentacion/${sub}/v${d.version} - ${limpio(String(d.nombre))}`, datos);
		lineas.push(`  · ${r?.bloque} › ${r?.elemento} · v${d.version} · ${d.nombre} · ${d.estado} · subido ${String(d.subido_en).slice(0, 10)}`);
	}
	lineas.push(`Planos y materiales entregados por MUNE: ${entregables.length}`);
	for (const [i, e] of entregables.entries()) {
		progreso(`Preparando los planos y materiales de ${String(promocion?.nombre ?? id)} (${i + 1} de ${entregables.length})…`);
		const datos = await bajar('entregables', String(e.ruta), String(e.huella), avisos);
		if (datos) partes.anadir(`${carpeta}materiales/${limpio(String(e.version))}/${limpio(String(e.ruta).split('/').pop() ?? String(e.nombre))}`, datos);
		const v = validaciones.find((x) => x.entregable_id === e.id);
		lineas.push(`  · ${e.version} · ${e.titulo ?? e.nombre}${v ? ` · ${v.decision} el ${String(v.momento).slice(0, 10)}` : ''}`);
	}
	lineas.push(`Personas con acceso: ${equipo.length}`);
	lineas.push(`Selecciones de compradores: ${selecciones.length}`);
	partes.anadir(`${carpeta}datos.json`, json({
		promocion, equipo: equipo.map((a) => ({ nombre: a.nombre, email: a.email, cargo: a.cargo, activo: a.activo })),
		documentacion: documentos.map((d) => ({ elemento: reqPorId.get(d.requisito_id)?.elemento, nombre: d.nombre, version: d.version, estado: d.estado, nota: d.nota, subido_en: d.subido_en, huella: d.huella })),
		materiales: entregables.map((e) => ({ version: e.version, nombre: e.titulo ?? e.nombre, huella: e.huella })),
		validaciones, aprobaciones, selecciones_de_comprador: selecciones,
		catalogo: { categorias, ajustes, packs }, comentarios,
	}));
	return [`■ ${promocion?.nombre ?? id}`, ...lineas].join('\n');
}

export interface Preparada { id: string; partes: number; archivos: number; bytes: number }

/** Prepara, sube y comprueba la exportación (aún no la envía). Si algo falla, la deja como fallida. */
export async function prepararExportacion(promotora: string, promocion: string | null, dias: number, progreso: (t: string) => void = () => {}): Promise<Preparada> {
	const { data: id, error } = await sb.rpc('exportacion_nueva', { p_promotora: promotora, p_promocion: promocion, p_dias: dias });
	if (error) throw error;
	try {
		const partes = new Partes();
		const avisos: string[] = [];
		const accesos = await leer(sb.rpc('accesos', { p_promotora: promotora }));
		const [po] = await leer(sb.from('promotoras').select('nombre, razon_social, cif, domicilio_fiscal, contacto').eq('id', promotora));
		const resumenes: string[] = [];
		const ids = promocion ? [promocion] : (await leer(sb.from('promociones').select('id').eq('promotora_id', promotora).order('nombre'))).map((p) => String(p.id));
		for (const pid of ids) {
			const carpeta = promocion ? '' : `promociones/${limpio(pid)}/`;
			resumenes.push(await anadirParaPromotora(partes, carpeta, pid, accesos.filter((a) => a.promocion_id === pid || (!promocion && a.promocion_id === null)), avisos, progreso));
		}
		if (!promocion) {
			const [marca] = await leer(sb.from('marcas').select('nombre, logo_svg, color_principal, color_secundario, tipografia, telefono, email, web, direccion').eq('promotora_id', promotora).is('promocion_id', null));
			partes.anadir('promotora.json', json({ promotora: po, marca: marca ?? null }));
		}
		if (avisos.length) throw new Error(`No se ha podido preparar completa: ${avisos.slice(0, 3).join(' · ')}${avisos.length > 3 ? '…' : ''}`);
		const leeme = [
			`MUNE · Exportación de ${promocion ? 'la promoción' : 'la promotora'}`,
			`Fecha: ${new Date().toLocaleString('es-ES')}`, '',
			'Contenido:',
			`  · ${promocion ? '' : 'promociones/<promoción>/'}documentacion/: lo que subisteis a MUNE Portal, con todas sus versiones.`,
			`  · ${promocion ? '' : 'promociones/<promoción>/'}materiales/: los planos y materiales que os ha entregado MUNE, por versión.`,
			`  · ${promocion ? '' : 'promociones/<promoción>/'}datos.json: ficha, equipo, selecciones de compradores, catálogo, validaciones y comentarios.`,
			...(promocion ? [] : ['  · promotora.json: los datos de la promotora y su marca.']),
			`  · ${partes.zips.length > 1 ? `La exportación va en ${partes.zips.length} partes: descárgalas todas.` : 'Todo va en este ZIP.'}`,
			'', 'Todos los archivos coinciden con los originales guardados (se han comprobado con su huella).', '',
			resumenes.join('\n\n'), '',
		].join('\n');
		partes.zips[0].anadir('LEEME.txt', leeme);
		const lista: { ruta: string; tamano: number; huella: string }[] = [];
		for (const [i, zip] of partes.zips.entries()) {
			progreso(`Subiendo la parte ${i + 1} de ${partes.zips.length}…`);
			const datos = new Uint8Array(await zip.cerrar().arrayBuffer());
			const ruta = `${id}/parte-${i + 1}.zip`;
			const firma = await huella(datos);
			const { error: eSubir } = await sb.storage.from('exportaciones').upload(ruta, datos, { contentType: 'application/zip', upsert: false });
			if (eSubir) throw eSubir;
			// comprobación: lo guardado es exactamente lo preparado
			progreso(`Comprobando la parte ${i + 1} de ${partes.zips.length}…`);
			const { data: vuelta, error: eBajar } = await sb.storage.from('exportaciones').download(ruta);
			if (eBajar || !vuelta || (await huella(new Uint8Array(await vuelta.arrayBuffer()))) !== firma) throw new Error(`La parte ${i + 1} no se ha guardado bien`);
			lista.push({ ruta, tamano: datos.length, huella: firma });
		}
		const { error: eLista } = await sb.rpc('exportacion_lista', { p_id: id, p_partes: lista, p_archivos: partes.archivos });
		if (eLista) throw eLista;
		await anotar('prepara y comprueba una exportación', { exportacion: id, promotora, promocion, partes: lista.length, archivos: partes.archivos });
		return { id: String(id), partes: lista.length, archivos: partes.archivos, bytes: lista.reduce((s, p) => s + p.tamano, 0) };
	} catch (e) {
		await sb.rpc('exportacion_fallida', { p_id: id, p_error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) });
		throw e;
	}
}

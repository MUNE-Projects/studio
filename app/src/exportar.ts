// Exportar todo lo de una promoción o de una promotora (receta 20): un ZIP con
// los datos (datos.json y un LEEME.txt legible) y todos los archivos
// (documentos subidos con sus versiones, planos entregados y fotos de las
// peticiones). Cada archivo se comprueba con su huella al descargarlo.
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
	const [[promocion], requisitos, documentos, entregables, validaciones, peticiones, registro, codigos, selecciones] = await Promise.all([
		leer(sb.from('promociones').select('*').eq('id', id)),
		leer(sb.from('requisitos').select('*').eq('promocion_id', id).order('orden').order('id')),
		leer(sb.from('documentos').select('*').eq('promocion_id', id).order('requisito_id').order('version')),
		leer(sb.from('entregables').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('validaciones').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('peticiones').select('*').eq('promocion_id', id).order('id')),
		leer(sb.from('registro').select('*').eq('detalle->>promocion', id).order('momento')),
		leer(sb.rpc('codigos_de_promocion', { p_promocion: id })),
		leer(sb.from('selecciones_comprador').select('*').eq('promocion_id', id).order('vivienda_ref').order('comprador')),
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

	lineas.push(`Personas con acceso a esta promoción: ${equipo.length}`);
	for (const a of equipo) lineas.push(`  · ${a.nombre} <${a.email}>${a.cargo ? ` · ${a.cargo}` : ''}${a.activo ? '' : ' · acceso retirado'}`);

	lineas.push(`Viviendas con código de comprador: ${codigos.length} (los códigos no se exportan: por seguridad, MUNE no los guarda)`);
	zip.anadir(`${carpeta}datos.json`, json({ promocion, equipo, requisitos, documentos, entregables, validaciones, peticiones, codigos_de_comprador: codigos, selecciones_de_comprador: selecciones, registro }));
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
		'La experiencia 3D y los datos de construcción de cada promoción no van en esta exportación: MUNE los guarda aparte (almacén privado «taller» de GitHub).',
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

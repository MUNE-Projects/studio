// Función «archivo-robot» de Supabase: los archivos que lee Claude, sin metadatos
// (decisión 66, 041_archivos_robot.sql).
//
// El robot de Claude ya no descarga los originales de las promotoras (documentos,
// adjuntos de las opciones pedidas) ni las fotos de referencia de las peticiones:
// los pide aquí, y esta función se los da limpios, ANTES de que salgan hacia el
// ordenador de Claude:
//  · fotos (JPEG, PNG, WebP): sin EXIF (GPS, autor, móvil, número de serie,
//    fechas), XMP, IPTC ni comentarios; se conserva la orientación. Los píxeles
//    no se tocan (no se vuelven a comprimir).
//  · PDF: sin la ficha del documento (autor, título, asunto, palabras clave,
//    programa), XMP, datos privados de programas (PieceInfo), autor de las
//    notas, archivos adjuntos dentro del PDF ni metadatos de las fotos que lleve
//    dentro. Las páginas, el texto, los vectores, las cotas y la escala, igual:
//    no se convierte en imagen.
//  · cualquier otro formato (DWG, Word, Excel, HEIC…): no se entrega. Hay que
//    pedirlo a la promotora en PDF (o la administradora lo mira por su cuenta).
// La limpieza quita metadatos, no lo que se ve: un cajetín con nombres o una
// firma siguen en el plano.
//
// Órdenes (POST, con la sesión del robot):
//  · { accion: 'archivo', almacen: 'documentos' | 'referencias', ruta }  → el archivo limpio
//    (cabeceras X-Huella-Original —la del archivo tal como se subió— y X-Limpieza);
//  · { accion: 'fotos', peticion }  → la lista de fotos de referencia de una petición.
//
// Se pega en Supabase → Edge Functions con el nombre «archivo-robot».

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'npm:pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const MAXIMO = 52428800; // 50 MB, lo mismo que admite el almacén

function claveServicio(): string | undefined {
	const legado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (legado) return legado;
	try {
		const claves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
		return claves.default ?? Object.values(claves)[0];
	} catch {
		return undefined;
	}
}

const sinSesion = { persistSession: false, autoRefreshToken: false };

// ─── Limpieza ────────────────────────────────────────────────────────────────

export type Limpio = { datos: Uint8Array; tipo: string; quitado: string[] };

const latin = (b: Uint8Array, desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta));
const unir = (partes: Uint8Array[]) => {
	const total = partes.reduce((s, p) => s + p.length, 0);
	const salida = new Uint8Array(total);
	let i = 0;
	for (const p of partes) {
		salida.set(p, i);
		i += p.length;
	}
	return salida;
};

/** Orientación EXIF (1-8) de un bloque TIFF; null si no la tiene. */
function orientacionTIFF(t: Uint8Array): number | null {
	if (t.length < 8) return null;
	const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
	const le = latin(t, 0, 2) === 'II';
	const ifd = v.getUint32(4, le);
	if (ifd + 2 > t.length) return null;
	const n = v.getUint16(ifd, le);
	for (let k = 0; k < n; k++) {
		const e = ifd + 2 + k * 12;
		if (e + 12 > t.length) break;
		if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
	}
	return null;
}

/** Bloque TIFF con solo la orientación. */
const tiffSoloOrientacion = (o: number) =>
	new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);

/**
 * JPEG: quita APP1 (EXIF y XMP), APP13 (IPTC/Photoshop) y comentarios. Conserva
 * APP0, el perfil de color (APP2), APP14 (Adobe) y la imagen tal cual. Con
 * `orientacion`, deja un EXIF mínimo con la orientación original.
 */
export function limpiarJPEG(b: Uint8Array, orientacion = true): Limpio {
	if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('JPEG dañado');
	const partes: Uint8Array[] = [];
	const quitado = new Set<string>();
	let giro: number | null = null;
	let i = 2;
	while (i < b.length) {
		if (b[i] !== 0xff) throw new Error('JPEG dañado');
		const m = b[i + 1];
		if (m === 0xff) { i++; continue; } // relleno
		if (m === 0xd9 || m === 0xda || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { partes.push(b.subarray(i)); break; }
		const largo = (b[i + 2] << 8) | b[i + 3];
		const seg = b.subarray(i, i + 2 + largo);
		const firma = latin(seg, 4, Math.min(seg.length, 33));
		if (m === 0xe1 && firma.startsWith('Exif\0')) {
			giro = orientacionTIFF(seg.subarray(10)) ?? giro;
			quitado.add('EXIF (GPS, autor, dispositivo, fechas…)');
		} else if (m === 0xe1) quitado.add('XMP');
		else if (m === 0xed) quitado.add('IPTC');
		else if (m === 0xfe) quitado.add('comentarios');
		else partes.push(seg);
		i += 2 + largo;
	}
	if (orientacion && giro && giro !== 1) {
		const cuerpo = unir([new TextEncoder().encode('Exif\0\0'), tiffSoloOrientacion(giro)]);
		// después de APP0 (JFIF), si lo hay
		const despues = partes.length && partes[0][1] === 0xe0 ? 1 : 0;
		partes.splice(despues, 0, new Uint8Array([0xff, 0xe1, (cuerpo.length + 2) >> 8, (cuerpo.length + 2) & 255]), cuerpo);
	}
	return { datos: unir([b.subarray(0, 2), ...partes]), tipo: 'image/jpeg', quitado: [...quitado] };
}

/** PNG: quita los bloques de texto (autor, programa, comentarios…), EXIF y fecha. */
export function limpiarPNG(b: Uint8Array): Limpio {
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const fuera = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
	const partes: Uint8Array[] = [b.subarray(0, 8)];
	const quitado = new Set<string>();
	for (let i = 8; i + 12 <= b.length;) {
		const largo = v.getUint32(i);
		const tipo = latin(b, i + 4, i + 8);
		if (fuera.has(tipo)) quitado.add(tipo === 'eXIf' ? 'EXIF' : tipo === 'tIME' ? 'fecha' : 'textos (autor, programa, comentarios)');
		else partes.push(b.subarray(i, i + 12 + largo));
		i += 12 + largo;
	}
	return { datos: unir(partes), tipo: 'image/png', quitado: [...quitado] };
}

/** WebP: quita EXIF y XMP; conserva la orientación. */
export function limpiarWebP(b: Uint8Array): Limpio {
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const partes: Uint8Array[] = [];
	const quitado = new Set<string>();
	let giro: number | null = null;
	let vp8x = -1;
	for (let i = 12; i + 8 <= b.length;) {
		const tipo = latin(b, i, i + 4);
		const largo = v.getUint32(i + 4, true);
		const trozo = b.subarray(i, i + 8 + largo + (largo & 1));
		if (tipo === 'EXIF') {
			const t = b.subarray(i + 8, i + 8 + largo);
			giro = orientacionTIFF(latin(t, 0, 4) === 'Exif' ? t.subarray(6) : t) ?? giro;
			quitado.add('EXIF (GPS, autor, dispositivo, fechas…)');
		} else if (tipo === 'XMP ') quitado.add('XMP');
		else {
			if (tipo === 'VP8X') vp8x = partes.length;
			partes.push(trozo);
		}
		i += 8 + largo + (largo & 1);
	}
	if (vp8x >= 0) {
		const cab = partes[vp8x].slice();
		cab[8] &= ~(0x08 | 0x04); // sin EXIF ni XMP
		if (giro && giro !== 1) cab[8] |= 0x08;
		partes[vp8x] = cab;
	}
	if (vp8x >= 0 && giro && giro !== 1) {
		const t = tiffSoloOrientacion(giro);
		const c = new Uint8Array(8 + t.length + (t.length & 1));
		c.set(new TextEncoder().encode('EXIF'));
		new DataView(c.buffer).setUint32(4, t.length, true);
		c.set(t, 8);
		partes.push(c);
	}
	const cuerpo = unir(partes);
	const cab = new Uint8Array(12);
	cab.set(new TextEncoder().encode('RIFF'));
	new DataView(cab.buffer).setUint32(4, cuerpo.length + 4, true);
	cab.set(new TextEncoder().encode('WEBP'), 8);
	return { datos: unir([cab, cuerpo]), tipo: 'image/webp', quitado: [...quitado] };
}

/**
 * PDF: quita la ficha del documento, XMP (del documento, de las páginas y de
 * cada objeto), PieceInfo, el autor de las notas, los archivos adjuntos y los
 * metadatos de las fotos JPEG que lleva dentro. Reescribe solo los objetos que
 * usa el documento (fuera revisiones antiguas, que podían conservar la ficha).
 */
export async function limpiarPDF(b: Uint8Array): Promise<Limpio> {
	let doc: PDFDocument;
	try {
		doc = await PDFDocument.load(b, { updateMetadata: false });
	} catch (e) {
		throw new Error(/encrypt/i.test(String(e)) ? 'PDF protegido con contraseña' : 'PDF dañado');
	}
	const ctx = doc.context;
	const paginas = doc.getPageCount();
	const quitado = new Set<string>();
	if (ctx.trailerInfo.Info) quitado.add('ficha del documento (autor, título, asunto, programa…)');
	ctx.trailerInfo.Info = undefined;
	ctx.trailerInfo.ID = undefined;
	const nombres = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
	if (nombres?.has(PDFName.of('EmbeddedFiles'))) {
		nombres.delete(PDFName.of('EmbeddedFiles'));
		quitado.add('archivos adjuntos');
	}
	const N = (n: string) => PDFName.of(n);
	for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
		const dict = obj instanceof PDFDict ? obj : (obj as { dict?: PDFDict }).dict;
		if (!(dict instanceof PDFDict)) continue;
		if (dict.has(N('Metadata'))) { dict.delete(N('Metadata')); quitado.add('XMP'); }
		if (dict.has(N('PieceInfo'))) { dict.delete(N('PieceInfo')); quitado.add('datos privados de programas (PieceInfo)'); }
		// notas: su autor (/T); en los campos de formulario, /T es el nombre del campo y se queda
		if ((dict.get(N('Type')) === N('Annot') || (dict.has(N('Subtype')) && dict.has(N('Rect')))) && dict.get(N('Subtype')) !== N('Widget')) {
			if (dict.has(N('T'))) { dict.delete(N('T')); quitado.add('autor de las notas'); }
			if (dict.get(N('Subtype')) === N('FileAttachment') && dict.has(N('FS'))) { dict.delete(N('FS')); quitado.add('archivos adjuntos'); }
		}
		// fotos JPEG dentro del PDF: sin sus metadatos (la imagen, igual)
		if (obj instanceof PDFRawStream && dict.get(N('Subtype')) === N('Image')) {
			const f = dict.get(N('Filter'));
			const soloDCT = f === N('DCTDecode') || (f instanceof PDFArray && f.size() === 1 && f.get(0) === N('DCTDecode'));
			if (soloDCT) {
				try {
					const limpio = limpiarJPEG(obj.contents, false);
					if (limpio.quitado.length) {
						dict.set(N('Length'), ctx.obj(limpio.datos.length));
						ctx.assign(ref, PDFRawStream.of(dict, limpio.datos));
						quitado.add('metadatos de las fotos de dentro');
					}
				} catch { /* imagen que no se entiende: se deja como está */ }
			}
		}
	}
	// solo lo que usa el documento
	const vistos = new Set<string>();
	const pila: unknown[] = [ctx.trailerInfo.Root];
	while (pila.length) {
		const o = pila.pop();
		if (o instanceof PDFRef) {
			if (vistos.has(o.tag)) continue;
			vistos.add(o.tag);
			pila.push(ctx.lookup(o));
		} else if (o instanceof PDFDict) {
			for (const [, v] of o.entries()) pila.push(v);
		} else if (o instanceof PDFArray) {
			for (let k = 0; k < o.size(); k++) pila.push(o.get(k));
		} else if ((o as { dict?: PDFDict })?.dict instanceof PDFDict) pila.push((o as { dict: PDFDict }).dict);
	}
	let sobrantes = 0;
	for (const [ref] of ctx.enumerateIndirectObjects()) if (!vistos.has(ref.tag)) { ctx.delete(ref); sobrantes++; }
	if (sobrantes) quitado.add('restos de versiones anteriores del archivo');
	const datos = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
	if ((await PDFDocument.load(datos, { updateMetadata: false })).getPageCount() !== paginas) throw new Error('el PDF limpio no tiene las mismas páginas');
	return { datos, tipo: 'application/pdf', quitado: [...quitado] };
}

/** Limpia según lo que el archivo es de verdad (no según su nombre). */
export async function limpiar(b: Uint8Array): Promise<Limpio> {
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return limpiarJPEG(b);
	if (latin(b, 0, 8) === '\x89PNG\r\n\x1a\n') return limpiarPNG(b);
	if (latin(b, 0, 4) === 'RIFF' && latin(b, 8, 12) === 'WEBP') return limpiarWebP(b);
	if (latin(b, 0, Math.min(b.length, 1024)).includes('%PDF-')) return await limpiarPDF(b);
	throw new Error('formato que no se puede limpiar');
}

// ─── Servicio ────────────────────────────────────────────────────────────────

const huella = async (b: Uint8Array) =>
	[...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') Deno.serve(async (req) => {
	const responder = (estado: number, datos: Record<string, unknown>) =>
		new Response(JSON.stringify(datos), { status: estado, headers: { 'Content-Type': 'application/json' } });
	if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });

	const auth = req.headers.get('authorization');
	if (!auth?.startsWith('Bearer ')) return responder(401, { error: 'Sin sesión' });
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, { global: { headers: { Authorization: auth } }, auth: sinSesion });
	const { data: esRobot, error: eRobot } = await sb.rpc('es_robot');
	if (eRobot || esRobot !== true) return responder(403, { error: 'Solo para el robot de Claude' });

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const clave = claveServicio();
	if (!clave) return responder(500, { error: 'Falta la configuración del servidor' });
	const servicio = createClient(SUPABASE_URL, clave, { auth: sinSesion });

	if (cuerpo.accion === 'fotos') {
		const peticion = String(cuerpo.peticion ?? '');
		if (!/^\d{1,12}$/.test(peticion)) return responder(400, { error: 'Petición no válida' });
		const { data, error } = await servicio.storage.from('referencias').list(peticion, { limit: 100 });
		if (error) return responder(500, { error: 'No se ha podido leer la lista de fotos' });
		return responder(200, { fotos: (data ?? []).filter((a) => a.id).map((a) => ({ nombre: a.name, ruta: `${peticion}/${a.name}` })) });
	}

	if (cuerpo.accion !== 'archivo') return responder(400, { error: 'Orden no válida' });
	const almacen = String(cuerpo.almacen ?? '');
	const ruta = String(cuerpo.ruta ?? '');
	if (!ruta || ruta.length > 500 || ruta.split('/').some((p) => !p || p === '.' || p === '..')) return responder(400, { error: 'Ruta no válida' });
	if (almacen === 'documentos') {
		// solo documentación de una promoción o adjuntos de sus opciones pedidas (nunca la marca ni otras carpetas)
		const [{ data: doc }, { data: opcion }] = await Promise.all([
			sb.rpc('carpeta_de_documentos_valida', { p_ruta: ruta }),
			sb.rpc('carpeta_de_opciones_valida', { p_ruta: ruta }),
		]);
		if (!doc && !opcion) return responder(403, { error: 'Ese archivo no es documentación ni un adjunto de una opción' });
	} else if (almacen === 'referencias') {
		if (!/^\d{1,12}\/[^/]+$/.test(ruta)) return responder(400, { error: 'Ruta no válida' });
	} else return responder(400, { error: 'Almacén no válido' });

	const { data: archivo, error: eBajar } = await servicio.storage.from(almacen).download(ruta);
	if (eBajar || !archivo) return responder(404, { error: 'No existe ese archivo' });
	if (archivo.size > MAXIMO) return responder(413, { error: 'Archivo demasiado grande' });
	const original = new Uint8Array(await archivo.arrayBuffer());
	let limpio: Limpio;
	try {
		limpio = await limpiar(original);
	} catch (e) {
		return responder(415, { error: `No se entrega: ${(e as Error).message}. Pide a la promotora el documento en PDF (o la foto en JPG o PNG).` });
	}
	return new Response(limpio.datos, {
		status: 200,
		headers: {
			'Content-Type': limpio.tipo,
			'X-Huella-Original': await huella(original),
			'X-Limpieza': encodeURIComponent(JSON.stringify(limpio.quitado)),
		},
	});
});

// Función «archivo-robot» de Supabase: los archivos que lee Claude, sin metadatos
// (decisión 67, 042_archivos_robot.sql).
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
//  · Word, Excel, PowerPoint y LibreOffice: sin la ficha (autor, último en
//    guardar, empresa…), sin el nombre de quien comenta o hace cambios y sin los
//    metadatos de sus fotos; el contenido, igual.
//  · DXF: sin «último en guardar» ni las propiedades del dibujo (título, autor,
//    comentarios…). IFC (BIM): sin autores, organización, personas, direcciones,
//    teléfonos ni emails. La geometría, igual.
//  · ZIP: cada archivo de dentro, limpio; lo que no se puede limpiar se queda fuera.
//  · texto (CSV, TXT, SVG…): no lleva datos ocultos (del SVG se quita su ficha).
//  · DWG, HEIC, TIFF y formatos propios de programas (RVT, SKP…), y los PDF o
//    ZIP con contraseña: no se entregan. Se piden a la promotora en DXF, PDF o
//    JPG (la promotora puede subir lo que quiera: esto es solo lo que llega a Claude).
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
import { unzipSync, zipSync, type Zippable } from 'npm:fflate@0.8.2';

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

const texto = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (t: string) => new TextEncoder().encode(t);
const PAPEL = 'Autor';

/** Archivos de Office (Word, Excel, PowerPoint): ficha, autores de comentarios y cambios, y fotos de dentro. */
async function limpiarOffice(partes: Record<string, Uint8Array>, quitado: Set<string>) {
	for (const nombre of Object.keys(partes)) {
		const n = nombre.toLowerCase();
		if (n === 'docprops/core.xml') {
			partes[nombre] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>');
			quitado.add('ficha del documento (autor, último en guardar, título, fechas…)');
		} else if (n === 'docprops/app.xml') {
			const t = texto(partes[nombre]);
			const limpio = t.replace(/<(Company|Manager|HyperlinkBase|Template)>[\s\S]*?<\/\1>|<(Company|Manager|HyperlinkBase|Template)\/>/g, '');
			if (limpio !== t) quitado.add('empresa, responsable y plantilla');
			partes[nombre] = bytes(limpio);
		} else if (n === 'docprops/custom.xml') {
			partes[nombre] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"/>');
			quitado.add('propiedades personalizadas');
		} else if (n.endsWith('.xml') || n.endsWith('.rels')) {
			const t = texto(partes[nombre]);
			let limpio = t
				// autores de comentarios y de cambios (Word), iniciales
				.replace(/\b(w|w15|w16cex|w16du):(author|initials)="[^"]*"/g, (_, ns, a) => `${ns}:${a}="${a === 'author' ? PAPEL : ''}"`)
				// comentarios de Excel
				.replace(/<author>[^<]*<\/author>/g, `<author>${PAPEL}</author>`);
			// listas de personas (Word, Excel y PowerPoint)
			if (/(people|persons?|authors|commentauthors)\.xml$/.test(n)) {
				limpio = limpio.replace(/\b((?:\w+:)?(?:author|displayName|name|initials|userId|providerId))="[^"]*"/g, (_, a) => `${a}="${/initials|userId|providerId/.test(a) ? '' : PAPEL}"`);
			}
			if (limpio !== t) { quitado.add('autores de comentarios y cambios'); partes[nombre] = bytes(limpio); }
		} else await limpiarImagenDentro(partes, nombre, quitado);
	}
}

/** Archivos de LibreOffice / OpenDocument: ficha, autores de notas y cambios, y fotos de dentro. */
async function limpiarOpenDocument(partes: Record<string, Uint8Array>, quitado: Set<string>) {
	for (const nombre of Object.keys(partes)) {
		if (nombre === 'meta.xml') {
			const t = texto(partes[nombre]);
			partes[nombre] = bytes(t.replace(/<office:meta>[\s\S]*<\/office:meta>/, '<office:meta/>'));
			quitado.add('ficha del documento (autor, fechas, programa…)');
		} else if (nombre.endsWith('.xml')) {
			const t = texto(partes[nombre]);
			const limpio = t.replace(/<(dc:creator|meta:initial-creator|meta:creator-initials)>[^<]*<\/\1>/g, (_, e) => `<${e}>${e === 'meta:creator-initials' ? '' : PAPEL}</${e}>`);
			if (limpio !== t) { quitado.add('autores de notas y cambios'); partes[nombre] = bytes(limpio); }
		} else await limpiarImagenDentro(partes, nombre, quitado);
	}
}

async function limpiarImagenDentro(partes: Record<string, Uint8Array>, nombre: string, quitado: Set<string>) {
	const b = partes[nombre];
	if (!(b[0] === 0xff && b[1] === 0xd8) && latin(b, 0, 4) !== '\x89PNG') return;
	try {
		const r = await limpiar(b);
		if (r.quitado.length) { partes[nombre] = r.datos; quitado.add('metadatos de las fotos de dentro'); }
	} catch { /* imagen que no se entiende: se deja */ }
}

/** ZIP: Office, OpenDocument o una carpeta comprimida (cada archivo, limpio; lo que no se puede limpiar, fuera). */
export async function limpiarZip(b: Uint8Array): Promise<Limpio> {
	let partes: Record<string, Uint8Array>;
	try {
		partes = unzipSync(b);
	} catch {
		throw new Error('ZIP dañado o protegido con contraseña');
	}
	const quitado = new Set<string>(['datos del archivo comprimido (fechas, programa)']);
	const mime = partes['mimetype'] ? texto(partes['mimetype']).trim() : '';
	if (partes['[Content_Types].xml']) {
		await limpiarOffice(partes, quitado);
		return { datos: comprimir(partes), tipo: 'application/vnd.openxmlformats-officedocument', quitado: [...quitado] };
	}
	if (mime.startsWith('application/vnd.oasis.opendocument')) {
		await limpiarOpenDocument(partes, quitado);
		// «mimetype», el primero y sin comprimir (lo exige el formato)
		const { mimetype, ...resto } = partes;
		return { datos: comprimir({ mimetype: [mimetype, { level: 0 }], ...resto }), tipo: mime, quitado: [...quitado] };
	}
	const fuera: string[] = [];
	for (const nombre of Object.keys(partes)) {
		if (nombre.endsWith('/')) continue;
		try {
			const r = await limpiar(partes[nombre]);
			partes[nombre] = r.datos;
			r.quitado.forEach((q) => quitado.add(q));
		} catch (e) {
			delete partes[nombre];
			fuera.push(`${nombre} (${(e as Error).message})`);
		}
	}
	if (fuera.length) quitado.add(`no incluidos: ${fuera.join(', ')}`);
	return { datos: comprimir(partes), tipo: 'application/zip', quitado: [...quitado] };
}

// sin fechas reales de los archivos ni datos del ordenador de origen
const comprimir = (partes: Zippable) => zipSync(partes, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });

/** DXF (AutoCAD en texto): «último en guardar» y las propiedades del dibujo (título, autor, comentarios…). */
export function limpiarDXF(b: Uint8Array): Limpio {
	const t = texto(b);
	const fin = t.includes('\r\n') ? '\r\n' : '\n';
	const l = t.split(/\r?\n/);
	const quitado = new Set<string>();
	for (let i = 0; i + 1 < l.length; i += 2) {
		const codigo = l[i].trim();
		// cabecera: $LASTSAVEDBY y la base de los hipervínculos
		if (codigo === '9' && ['$LASTSAVEDBY', '$HYPERLINKBASE'].includes(l[i + 1].trim()) && i + 3 < l.length && l[i + 3] !== '') {
			l[i + 3] = '';
			quitado.add('último en guardar');
		}
		// propiedades del dibujo (DWGPROPS): título, asunto, autor, comentarios, palabras clave, último en guardar, revisión y las personalizadas
		if (codigo === '1' && l[i + 1].trim() === 'DWGPROPS COOKIE') {
			for (let k = i + 2; k + 1 < l.length && l[k].trim() !== '0'; k += 2) {
				const c = Number(l[k].trim());
				if ([2, 3, 4, 6, 7, 8, 9].includes(c) || (c >= 300 && c <= 309) || c === 1) { if (l[k + 1] !== '') { l[k + 1] = ''; quitado.add('propiedades del dibujo (título, autor, comentarios…)'); } }
			}
		}
	}
	return { datos: bytes(l.join(fin)), tipo: 'image/vnd.dxf', quitado: [...quitado] };
}

/** IFC (BIM): autores y organización de la cabecera, y personas, direcciones, teléfonos y emails. */
export function limpiarIFC(b: Uint8Array): Limpio {
	const t = texto(b);
	const quitado = new Set<string>();
	const cadena = /'(?:[^']|'')*'/g;
	let limpio = t.replace(/FILE_NAME\s*\(([\s\S]*?)\);/, (todo) => {
		// FILE_NAME('nombre','fecha',(autores),(organizaciones),'preprocesador','programa','autorización')
		const partes = todo.match(/\((?:[^()']|'(?:[^']|'')*')*\)|'(?:[^']|'')*'|\$/g) ?? [];
		if (partes.length < 7) return todo;
		quitado.add('autores y organización del archivo');
		return `FILE_NAME(${partes[0]},${partes[1]},(''),(''),${partes[4]},${partes[5]},'');`;
	});
	limpio = limpio.replace(/^(#\d+\s*=\s*IFC(?:PERSON|ORGANIZATION|POSTALADDRESS|TELECOMADDRESS)\s*\()([\s\S]*?)(\);)/gim, (_, a, medio, z) => {
		quitado.add('personas, direcciones, teléfonos y emails');
		return a + medio.replace(cadena, "''") + z;
	});
	return { datos: bytes(limpio), tipo: 'application/x-step', quitado: [...quitado] };
}

/** Texto (CSV, TXT, XML, SVG…): no lleva datos ocultos; del SVG, su ficha (<metadata>). */
function limpiarTexto(b: Uint8Array): Limpio {
	const t = new TextDecoder('utf-8', { fatal: true }).decode(b);
	if (/<svg[\s>]/i.test(t.slice(0, 4096))) {
		const limpio = t.replace(/<metadata[\s\S]*?<\/metadata>/gi, '').replace(/\s(?:sodipodi|inkscape):[\w-]+="[^"]*"/g, '');
		return { datos: bytes(limpio), tipo: 'image/svg+xml', quitado: limpio !== t ? ['ficha del dibujo (autor, programa)'] : [] };
	}
	return { datos: b, tipo: 'text/plain; charset=utf-8', quitado: [] };
}

/** Limpia según lo que el archivo es de verdad (no según su nombre). */
export async function limpiar(b: Uint8Array): Promise<Limpio> {
	const inicio = latin(b, 0, Math.min(b.length, 1024));
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return limpiarJPEG(b);
	if (inicio.startsWith('\x89PNG\r\n\x1a\n')) return limpiarPNG(b);
	if (inicio.startsWith('RIFF') && inicio.slice(8, 12) === 'WEBP') return limpiarWebP(b);
	if (inicio.includes('%PDF-')) return await limpiarPDF(b);
	if (inicio.startsWith('PK\x03\x04')) return await limpiarZip(b);
	if (/^AC10\d\d/.test(inicio)) throw new Error('es un DWG: pide a la promotora el mismo plano en DXF (o en PDF)');
	if (inicio.startsWith('AutoCAD Binary DXF')) throw new Error('es un DXF binario: pide a la promotora el DXF en texto (ASCII)');
	if (inicio.slice(4, 12) === 'ftypheic' || inicio.slice(4, 12) === 'ftypheix' || inicio.slice(4, 12) === 'ftypmif1') throw new Error('es una foto HEIC: pídela en JPG');
	if (inicio.startsWith('II*\0') || inicio.startsWith('MM\0*')) throw new Error('es un TIFF: pídelo en PDF, JPG o PNG');
	if (inicio.trimStart().startsWith('ISO-10303-21;')) return limpiarIFC(b);
	if (/^\s*0\r?\n\s*SECTION\r?\n/.test(inicio)) return limpiarDXF(b);
	if (!inicio.includes('\0')) {
		try {
			return limpiarTexto(b);
		} catch { /* no es texto */ }
	}
	throw new Error('formato que no se puede limpiar (como RVT, SKP o un programa propio): pide a la promotora el documento en PDF, DXF o IFC');
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
		return responder(415, { error: `No se entrega: ${(e as Error).message}.` });
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

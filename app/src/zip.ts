// ZIP mínimo (sin comprimir, sin dependencias) para las exportaciones.
// Los documentos suelen ser PDF, Excel o imágenes, que ya van comprimidos.

const TABLA = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(datos: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < datos.length; i++) c = TABLA[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export class Zip {
	private partes: Uint8Array[] = [];
	private central: Uint8Array[] = [];
	private posicion = 0;
	private nombres = new Set<string>();
	private readonly hora: number;
	private readonly dia: number;

	constructor(fecha = new Date()) {
		this.hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
		this.dia = ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
	}

	/** Añade un archivo. Si el nombre ya existe, le pone «(2)», «(3)»… */
	anadir(ruta: string, contenido: Uint8Array | string): void {
		const datos = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
		let nombre = ruta;
		for (let i = 2; this.nombres.has(nombre); i++) nombre = ruta.replace(/(\.[^./]*)?$/, ` (${i})$1`);
		this.nombres.add(nombre);
		const bytesNombre = new TextEncoder().encode(nombre);
		const crc = crc32(datos);

		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true);
		local.setUint16(6, 0x0800, true); // nombres en UTF-8
		local.setUint16(10, this.hora, true);
		local.setUint16(12, this.dia, true);
		local.setUint32(14, crc, true);
		local.setUint32(18, datos.length, true);
		local.setUint32(22, datos.length, true);
		local.setUint16(26, bytesNombre.length, true);

		const cen = new DataView(new ArrayBuffer(46));
		cen.setUint32(0, 0x02014b50, true);
		cen.setUint16(4, 20, true);
		cen.setUint16(6, 20, true);
		cen.setUint16(8, 0x0800, true);
		cen.setUint16(12, this.hora, true);
		cen.setUint16(14, this.dia, true);
		cen.setUint32(16, crc, true);
		cen.setUint32(20, datos.length, true);
		cen.setUint32(24, datos.length, true);
		cen.setUint16(28, bytesNombre.length, true);
		cen.setUint32(42, this.posicion, true);

		this.partes.push(new Uint8Array(local.buffer), bytesNombre, datos);
		this.central.push(new Uint8Array(cen.buffer), bytesNombre);
		this.posicion += 30 + bytesNombre.length + datos.length;
	}

	get cuantos(): number {
		return this.nombres.size;
	}

	cerrar(): Blob {
		const tamano = this.central.reduce((s, p) => s + p.length, 0);
		const fin = new DataView(new ArrayBuffer(22));
		fin.setUint32(0, 0x06054b50, true);
		fin.setUint16(8, this.nombres.size, true);
		fin.setUint16(10, this.nombres.size, true);
		fin.setUint32(12, tamano, true);
		fin.setUint32(16, this.posicion, true);
		return new Blob([...this.partes, ...this.central, new Uint8Array(fin.buffer)] as BlobPart[], { type: 'application/zip' });
	}
}

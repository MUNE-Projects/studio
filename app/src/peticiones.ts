// Peticiones de cambios (con fotos de referencia) de una promoción.
//
// La administradora escribe lo que quiere cambiar; Claude las atiende cuando
// ella se lo pide (de momento no hay ninguna tarea automática) y va marcando su
// estado. Fotos: almacén privado «referencias/<petición>/…» (004_referencias.sql).

import { alEnviar, anotar, esc, fecha, sb, traducir } from './comun';
import { anotarEnlaces, enlace } from './versiones';

const MAX_FOTOS = 5;
const MAX_TAM_FOTO = 10 * 1024 * 1024;
const TIPOS_FOTO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function comprobarFotos(fotos: File[]): void {
	if (fotos.length > MAX_FOTOS) throw new Error(`Puedes adjuntar como máximo ${MAX_FOTOS} fotos.`);
	for (const f of fotos) {
		if (!TIPOS_FOTO[f.type]) throw new Error(`«${f.name}» no es una foto JPG, PNG o WebP. Elige otra.`);
		if (f.size > MAX_TAM_FOTO) throw new Error(`«${f.name}» pesa más de 10 MB. Elige una foto más ligera.`);
	}
}

async function subirFotos(peticion: number, fotos: File[]): Promise<void> {
	for (const [i, f] of fotos.entries()) {
		const ruta = `${peticion}/${i + 1}.${TIPOS_FOTO[f.type]}`;
		const { error } = await sb.storage.from('referencias').upload(ruta, f, { contentType: f.type, upsert: false });
		if (error) {
			console.error('[MUNE Studio]', error);
			throw new Error(`La petición se ha guardado, pero la foto «${f.name}» no se ha podido subir. Recarga la página y, si la necesitas, envíala en una petición nueva.`);
		}
	}
}

/** Miniaturas de las fotos de una petición (enlaces temporales de 1 hora). */
async function miniaturas(peticion: number): Promise<string> {
	const { data: archivos } = await sb.storage.from('referencias').list(String(peticion));
	if (!archivos?.length) return '';
	const { data: urls } = await sb.storage.from('referencias')
		.createSignedUrls(archivos.map((a) => `${peticion}/${a.name}`), 3600);
	return `<div class="fotos">${(urls ?? []).filter((u) => u.signedUrl).map((u, i) =>
		`<a href="${esc(u.signedUrl!)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u.signedUrl!)}" alt="Foto de referencia ${i + 1}" loading="lazy"></a>`).join('')}</div>`;
}

interface Peticion {
	id: number; promocion_id: string; version: string | null; texto: string; estado: string;
	nota: string | null; enlace: string | null; creada_en: string; promociones: { nombre: string } | null;
}

export const ESTADOS_PETICION: Record<string, [string, string]> = {
	pendiente: ['Pendiente', 'pendiente'],
	en_curso: ['En curso', 'pendiente'],
	lista: ['Lista para revisar', 'al-dia'],
	descartada: ['Descartada', ''],
};

/**
 * Pestaña «Peticiones de cambios» de una promoción: el formulario «Pedir
 * cambios» y sus peticiones, de la más reciente a la más antigua.
 */
export async function pintarPeticiones(destino: HTMLElement, p: { id: string; nombre: string }, version: string | null): Promise<void> {
	const { data, error } = await sb.from('peticiones')
		.select('id, promocion_id, version, texto, estado, nota, enlace, creada_en, promociones(nombre)')
		.eq('promocion_id', p.id).order('creada_en', { ascending: false }).limit(50);
	if (error) {
		destino.innerHTML = `<p class="error">${esc(traducir(error))}</p>`;
		return;
	}
	const lista = (data ?? []) as unknown as Peticion[];
	const fotos = await Promise.all(lista.map((x) => miniaturas(x.id)));
	destino.innerHTML = `
		<p class="ayuda">Cuando quieras que Claude se ponga con ellas, díselo en Claude Code: «revisa las peticiones del Panel».</p>
		<div class="acciones"><button class="boton secundario" type="button" data-pedir>Pedir cambios</button></div>
		<form class="peticion-form" data-form hidden novalidate>
			<label>¿Qué quieres cambiar de ${esc(p.nombre)}${version ? ` (${esc(version)})` : ''}?
				<textarea name="texto" rows="4" maxlength="4000" required
					placeholder="Por ejemplo: el suelo de la cocina más claro y el sofá del salón en gris."></textarea>
			</label>
			<label>Fotos de referencia (opcional, hasta ${MAX_FOTOS}: JPG, PNG o WebP, máx. 10 MB cada una)
				<input name="fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
			</label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Enviar petición</button>
				<button class="boton secundario" type="button" data-cancelar>Cancelar</button>
			</div>
		</form>
		${lista.length ? lista.map((x, i) => {
			const [etiqueta, clase] = ESTADOS_PETICION[x.estado] ?? [x.estado, ''];
			return `<article class="peticion">
				<div class="promo-cabeza">
					<p class="promo-lugar">${x.version ? `${esc(x.version)} · ` : ''}${esc(fecha(x.creada_en))}</p>
					<span class="estado ${clase}">${esc(etiqueta)}</span>
				</div>
				<p class="peticion-texto">${esc(x.texto)}</p>
				${fotos[i]}
				${x.nota ? `<p class="peticion-nota"><strong>Claude:</strong> ${esc(x.nota)}</p>` : ''}
				<div class="acciones">
					${x.enlace ? enlace(x.enlace, 'Ver propuesta', 'abre la propuesta de una petición', { promocion: p.id, peticion: String(x.id) }, true) : ''}
					${x.estado === 'pendiente' ? `<button class="boton secundario" type="button" data-descartar="${x.id}">Descartar</button>` : ''}
				</div>
			</article>`;
		}).join('') : '<p class="vacio">Todavía no hay peticiones de esta promoción.</p>'}`;

	anotarEnlaces(destino);
	destino.querySelectorAll<HTMLButtonElement>('[data-descartar]').forEach((b) => b.addEventListener('click', async () => {
		b.disabled = true;
		const id = Number(b.dataset.descartar);
		const { error: e } = await sb.from('peticiones').update({ estado: 'descartada' }).eq('id', id);
		if (e) { b.disabled = false; alert(traducir(e)); return; }
		await anotar('descarta una petición', { promocion: p.id, peticion: id });
		void pintarPeticiones(destino, p, version);
	}));

	const boton = destino.querySelector<HTMLButtonElement>('[data-pedir]')!;
	const form = destino.querySelector<HTMLFormElement>('form[data-form]')!;
	const cerrar = () => { form.hidden = true; form.reset(); boton.hidden = false; };
	boton.addEventListener('click', () => { form.hidden = false; boton.hidden = true; form.querySelector('textarea')!.focus(); });
	form.querySelector('[data-cancelar]')!.addEventListener('click', cerrar);
	alEnviar(form, async (d) => {
		const texto = String(d.get('texto')).trim();
		if (texto.length < 3) throw new Error('Escribe qué quieres cambiar.');
		const fotos = (d.getAll('fotos') as File[]).filter((f) => f.size > 0);
		comprobarFotos(fotos);
		const { data: nueva, error: e } = await sb.from('peticiones')
			.insert({ promocion_id: p.id, version, texto })
			.select('id').single();
		if (e) throw e;
		await subirFotos(nueva.id, fotos);
		await anotar('pide cambios', { promocion: p.id, peticion: nueva.id, fotos: fotos.length });
		await pintarPeticiones(destino, p, version);
	});
}

/** Peticiones abiertas de todas las promociones (para Inicio). */
export async function peticionesAbiertas(): Promise<Peticion[]> {
	const { data } = await sb.from('peticiones')
		.select('id, promocion_id, version, texto, estado, nota, enlace, creada_en, promociones(nombre)')
		.in('estado', ['pendiente', 'en_curso', 'lista']).order('creada_en', { ascending: false }).limit(50);
	return (data ?? []) as unknown as Peticion[];
}

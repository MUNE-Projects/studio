// Comentarios visuales de una versión (038_comentarios.sql). El mismo archivo
// está en MUNE Studio (app/src) y en MUNE Portal (portal/src): si cambias uno,
// copia el otro.
//
// · Se pulsa en el sitio del plano (o del 3D, desde la web de la promoción) y se
//   escribe. El punto es opcional: sin él, el comentario es general de ese plano,
//   tipología o personalización; y también los hay de toda la versión.
// · Pendiente de enviar → Enviado: «Pedir cambios» envía juntos los pendientes
//   (textoPedirCambios los lleva también en el texto de la petición). Claude
//   solo trabaja con lo enviado y, al preparar la versión nueva, marca los que
//   resuelve. Si la promotora responde a uno resuelto, se reabre.
// · En MUNE Studio, lo que escribe la administradora en la vista previa son
//   notas internas para Claude (la promotora no las ve).

import type { SupabaseClient } from '@supabase/supabase-js';

export type TipoComentario = 'version' | 'plano' | 'experiencia' | 'personalizacion';
export interface PuntoPlano { x: number; y: number }
export interface Punto3D { p: number[]; cam: number[]; obj: number[]; vista?: string }
interface Mensaje { id: number; texto: string; autor: string; de_mune: boolean; mio: boolean; creado_en: string }
export interface Hilo extends Mensaje {
	version: string; tipo: TipoComentario; clave: string | null; punto: PuntoPlano | Punto3D | null; interno: boolean;
	enviado_en: string | null; resuelto_en: string | null; resuelto_version: string | null; respuestas: Mensaje[];
}

export interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	traducir: (e: unknown) => string;
	/** MUNE Studio: responde como el equipo de MUNE; sus comentarios son notas para Claude. */
	admin: boolean;
	/** Abre el 3D profesional en el sitio de un comentario (o para marcar uno, sin hilo; en personalización, en modo Personalizar). */
	abrir3D?: (clave: string | null, hilo: Hilo | null, tipo: TipoComentario) => void;
	/** Enlace temporal a la imagen de un plano (para ver dónde está un comentario). */
	imagenPlano?: (clave: string, version: string) => Promise<string | null>;
}

const num = (v: string) => Number(v.slice(1)) || 0;
const cuando = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function leerHilos(sb: SupabaseClient, promocion: string): Promise<Hilo[]> {
	const { data, error } = await sb.rpc('comentarios_de', { p_promocion: promocion });
	if (error) throw error;
	return (data ?? []) as Hilo[];
}

/** Los hilos de un sitio que se ven en una versión: los de esa versión y los abiertos de las anteriores. */
export function hilosDe(hilos: Hilo[], tipo: TipoComentario, clave: string | null, version: string): Hilo[] {
	return hilos
		.filter((h) => h.tipo === tipo && (clave === null || h.clave === clave))
		.filter((h) => h.version === version || (num(h.version) < num(version) && (!h.resuelto_en || num(h.resuelto_version ?? h.version) >= num(version))))
		.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
}

export const abiertos = (hs: Hilo[]) => hs.filter((h) => !h.resuelto_en);
/** Abiertos y todavía sin enviar: los que enviará el próximo «Pedir cambios». */
export const pendientes = (hs: Hilo[]) => hs.filter((h) => !h.resuelto_en && !h.enviado_en);

/** El texto de «Pedir cambios» con los comentarios pendientes de ese sitio (y lo que se escriba, si algo). */
export function textoPedirCambios(hs: Hilo[], texto: string): string {
	const lista = pendientes(hs).map((h, i) => `${i + 1}. ${h.punto ? '(punto marcado) ' : ''}${h.texto.replace(/\s+/g, ' ').trim()}`);
	const partes = [texto.trim(), lista.length ? `Comentarios marcados:\n${lista.join('\n')}` : ''].filter(Boolean);
	const todo = partes.join('\n\n');
	return todo.length > 4000 ? `${todo.slice(0, 3990)}…` : todo;
}

function htmlMensaje(esc: Dependencias['esc'], m: Mensaje): string {
	return `<p class="comentario-autor"><strong>${esc(m.de_mune ? 'Equipo de MUNE' : m.autor)}</strong> · ${esc(cuando(m.creado_en))}</p>
		<p class="comentario-texto">${esc(m.texto)}</p>`;
}

/** En qué punto está un comentario. */
function chipEstado(d: Dependencias, h: Hilo): string {
	const { esc } = d;
	if (h.resuelto_en) return `<span class="estado al-dia">Resuelto${h.resuelto_version ? ` en la ${esc(h.resuelto_version)}` : ''}</span>`;
	if (h.interno) return h.enviado_en ? '<span class="estado pendiente">Enviada a Claude</span>' : '<span class="estado">Nota sin enviar</span>';
	return h.enviado_en ? `<span class="estado pendiente">${d.admin ? 'Pedido' : 'Enviado a MUNE'}</span>` : '<span class="estado">Pendiente de enviar</span>';
}

/** Un hilo: el comentario, sus respuestas y las acciones. n: su número en el plano (si tiene punto). */
function htmlHilo(d: Dependencias, h: Hilo, n: number | null, lugar: string): string {
	const { esc } = d;
	const resuelto = !!h.resuelto_en;
	const sinRespuestaAjena = h.respuestas.every((r) => r.mio);
	return `<article class="hilo ${resuelto ? 'resuelto' : ''}" data-hilo="${h.id}">
		<div class="hilo-cabecera">
			${n !== null ? `<span class="marca-numero">${n}</span>` : ''}
			<span class="promo-lugar">${lugar ? `${esc(lugar)} · ` : ''}${h.punto ? 'en un punto' : 'general'} · ${esc(h.version)}</span>
			${chipEstado(d, h)}
		</div>
		${htmlMensaje(esc, h)}
		${h.respuestas.map((r) => `<div class="respuesta">${htmlMensaje(esc, r)}</div>`).join('')}
		<div class="acciones">
			${(h.tipo === 'experiencia' || h.tipo === 'personalizacion') && h.clave && h.punto && d.abrir3D ? '<button class="boton secundario pequeno" type="button" data-ver-3d>Ver en 3D</button>' : ''}
			${h.tipo === 'plano' && h.punto && d.imagenPlano ? '<button class="boton secundario pequeno" type="button" data-ver-plano>Ver en el plano</button>' : ''}
			${h.interno ? '' : '<button class="boton secundario pequeno" type="button" data-responder>Responder</button>'}
			${d.admin && resuelto ? '<button class="enlace" type="button" data-reabrir>No está resuelto: reabrir</button>' : ''}
			${h.mio && !h.enviado_en && sinRespuestaAjena ? '<button class="enlace" type="button" data-borrar>Borrar</button>' : ''}
		</div>
		<div data-zona-plano></div>
		<form class="peticion-form respuesta-form" data-respuesta hidden novalidate>
			<label>Tu respuesta<textarea name="texto" rows="2" maxlength="2000"></textarea></label>
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton pequeno" type="submit">Enviar</button><button class="enlace" type="button" data-cancelar>Cancelar</button></div>
		</form>
	</article>`;
}

/** El plano con las marcas numeradas de los hilos dados (y la del comentario que se está escribiendo). */
export function htmlPlanoConMarcas(esc: Dependencias['esc'], src: string, alt: string, hs: Hilo[], marcar: boolean): string {
	const marcas = hs.filter((h) => h.punto).map((h, i) => {
		const p = h.punto as PuntoPlano;
		return `<button type="button" class="marca-plano" data-ir-hilo="${h.id}" style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%" title="${esc(h.texto.slice(0, 80))}">${i + 1}</button>`;
	}).join('');
	return `<div class="plano-marcas ${marcar ? 'se-puede-marcar' : ''}" data-plano-marcas>
		<img class="plano-grande" src="${esc(src)}" alt="${esc(alt)}">
		${marcas}<span class="marca-plano nueva" data-marca-nueva hidden>+</span>
	</div>`;
}

export interface Sitio {
	promocion: string;
	/** La versión que se está viendo (en la que se comenta). */
	version: string;
	tipo: TipoComentario;
	clave: string | null;
	/** ¿Se puede comentar? (la versión más reciente) */
	comentar: boolean;
	/** Lista de varios sitios (MUNE Studio): qué hilos se enseñan y el nombre de su sitio («Plano · Tipología A»). */
	filtro?: (h: Hilo) => boolean;
	lugar?: (h: Hilo) => string;
	/** Texto de ayuda del formulario (si no, el de cada sitio). */
	ayuda?: string;
	/** Enseñar los resueltos a la vista, no plegados (MUNE Studio: «Qué resuelve la vN»). */
	resueltosALaVista?: boolean;
	/** Tras comentar, responder, resolver o borrar: los hilos de este sitio, al día. */
	alCambiar?: (hs: Hilo[]) => void;
}

/**
 * Pinta los hilos de un sitio y el formulario para comentar. Si en `caja` hay un
 * plano con marcas (htmlPlanoConMarcas), al pulsar en él se marca el punto.
 * Devuelve los hilos de ese sitio (para «Pedir cambios»).
 */
export async function pintarComentarios(caja: HTMLElement, plano: HTMLElement | null, d: Dependencias, s: Sitio,
	hilosLeidos?: Hilo[]): Promise<Hilo[]> {
	const { esc } = d;
	let todos: Hilo[];
	try {
		todos = hilosLeidos ?? await leerHilos(d.sb, s.promocion);
	} catch (e) {
		caja.innerHTML = `<p class="error">${esc(d.traducir(e))}</p>`;
		return [];
	}
	const base = s.lugar ? todos.slice().sort((a, b) => a.creado_en.localeCompare(b.creado_en)) : hilosDe(todos, s.tipo, s.clave, s.version);
	const hs = s.filtro ? base.filter(s.filtro) : base;
	const abiertosAqui = abiertos(hs);
	const resueltos = hs.filter((h) => h.resuelto_en);
	const conPunto = abiertosAqui.filter((h) => h.punto);
	const numero = (h: Hilo) => (!s.lugar && h.tipo === 'plano' && h.punto && !h.resuelto_en ? conPunto.indexOf(h) + 1 : null);
	const lugar = (h: Hilo) => s.lugar?.(h) ?? '';
	const ayuda = s.ayuda ?? (s.tipo === 'plano'
		? 'Para comentar un sitio concreto, pulsa en el plano y escribe. Si no marcas ningún sitio, el comentario es general del plano.'
		: s.tipo === 'experiencia'
			? 'Escribe un comentario general de esta tipología, o márcalo en su sitio dentro del 3D con «Comentar en el 3D».'
			: s.tipo === 'personalizacion'
				? 'Escribe lo que hay que cambiar de la personalización (opciones, packs, cómo se ve en el 3D…), o márcalo en el 3D con «Comentar en el 3D».'
				: 'Para lo que no es de un plano ni de una tipología concreta (por ejemplo, «falta la zona de piscina»).');

	caja.innerHTML = s.resueltosALaVista ? (hs.length ? hs.map((h) => htmlHilo(d, h, null, lugar(h))).join('') : '<p class="vacio">Ninguno.</p>') : `
		${abiertosAqui.length ? abiertosAqui.map((h) => htmlHilo(d, h, numero(h), lugar(h))).join('') : s.lugar ? '<p class="vacio">No hay comentarios abiertos.</p>' : ''}
		${resueltos.length ? `<details class="resueltos"><summary>${resueltos.length === 1 ? '1 comentario resuelto' : `${resueltos.length} comentarios resueltos`}</summary>
			${resueltos.map((h) => htmlHilo(d, h, null, lugar(h))).join('')}</details>` : ''}
		${s.comentar ? `<form class="peticion-form comentar-form" data-comentar novalidate>
			<p class="ayuda">${ayuda}</p>
			<p class="aviso-punto" data-aviso-punto hidden>Comentario en el punto marcado <span class="marca-plano nueva en-linea">+</span> · <button class="enlace" type="button" data-quitar-punto>Quitar el punto</button></p>
			<label>Comentario<textarea name="texto" rows="2" maxlength="2000" placeholder="${s.tipo === 'plano' ? 'Por ejemplo: esta puerta debería abrir hacia el pasillo.' : s.tipo === 'experiencia' ? 'Por ejemplo: en general, los muebles se ven pequeños.' : s.tipo === 'personalizacion' ? 'Por ejemplo: el suelo de roble se ve demasiado oscuro.' : 'Por ejemplo: falta la zona de piscina.'}"></textarea></label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton secundario pequeno" type="submit">Comentar</button>
				${(s.tipo === 'experiencia' && s.clave) || s.tipo === 'personalizacion' ? (d.abrir3D ? '<button class="boton secundario pequeno" type="button" data-comentar-3d>Comentar en el 3D</button>' : '') : ''}
			</div>
		</form>` : ''}`;

	// ── el punto en el plano
	let punto: PuntoPlano | null = null;
	const form = caja.querySelector<HTMLFormElement>('[data-comentar]');
	const avisoPunto = caja.querySelector<HTMLElement>('[data-aviso-punto]');
	const nueva = plano?.querySelector<HTMLElement>('[data-marca-nueva]') ?? null;
	const ponerPunto = (p: PuntoPlano | null) => {
		punto = p;
		if (avisoPunto) avisoPunto.hidden = !p;
		if (nueva) {
			nueva.hidden = !p;
			if (p) Object.assign(nueva.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%` });
		}
	};
	if (plano && form) {
		const img = plano.querySelector('img')!;
		img.addEventListener('click', (ev) => {
			const r = img.getBoundingClientRect();
			const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
			const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
			ponerPunto({ x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 });
			form.querySelector('textarea')!.focus({ preventScroll: true });
			form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
	}
	if (plano) for (const b of plano.querySelectorAll<HTMLButtonElement>('[data-ir-hilo]')) {
		b.addEventListener('click', () => {
			const h = caja.querySelector<HTMLElement>(`[data-hilo="${b.dataset.irHilo}"]`);
			h?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			h?.classList.add('resaltado');
			setTimeout(() => h?.classList.remove('resaltado'), 1600);
		});
	}
	caja.querySelector('[data-quitar-punto]')?.addEventListener('click', () => ponerPunto(null));
	caja.querySelector('[data-comentar-3d]')?.addEventListener('click', () => d.abrir3D!(s.clave, null, s.tipo));

	// Repinta todo (plano incluido) y vuelve a conectar: más sencillo que tocar trozos.
	const recargar = async () => {
		if (plano) {
			const img = plano.querySelector('img')!;
			const nuevos = await leerHilos(d.sb, s.promocion);
			const div = document.createElement('div');
			div.innerHTML = htmlPlanoConMarcas(esc, img.src, img.alt, abiertos(hilosDe(nuevos, s.tipo, s.clave, s.version).filter(s.filtro ?? (() => true))), s.comentar);
			const nuevoPlano = div.firstElementChild as HTMLElement;
			plano.replaceWith(nuevoPlano);
			const hs = await pintarComentarios(caja, nuevoPlano, d, s, nuevos);
			s.alCambiar?.(hs);
		} else {
			const hs = await pintarComentarios(caja, null, d, s);
			s.alCambiar?.(hs);
		}
	};
	if (form) form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
		const error = form.querySelector<HTMLElement>('.error')!;
		const texto = String(new FormData(form).get('texto') ?? '').trim();
		error.textContent = '';
		if (!texto) { error.textContent = 'Escribe el comentario.'; return; }
		boton.disabled = true;
		const { error: e } = await d.sb.rpc('comentar', {
			p_promocion: s.promocion, p_version: s.version, p_tipo: s.tipo, p_clave: s.clave, p_punto: punto, p_texto: texto,
		});
		if (e) { error.textContent = d.traducir(e); boton.disabled = false; return; }
		await recargar();
	});

	for (const art of caja.querySelectorAll<HTMLElement>('[data-hilo]')) {
		const id = Number(art.dataset.hilo);
		const h = hs.find((x) => x.id === id)!;
		const resp = art.querySelector<HTMLFormElement>('[data-respuesta]')!;
		art.querySelector('[data-responder]')?.addEventListener('click', () => {
			resp.hidden = false;
			resp.querySelector('textarea')!.focus();
		});
		resp.querySelector('[data-cancelar]')!.addEventListener('click', () => (resp.hidden = true));
		resp.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const boton = resp.querySelector<HTMLButtonElement>('button[type=submit]')!;
			const error = resp.querySelector<HTMLElement>('.error')!;
			const texto = String(new FormData(resp).get('texto') ?? '').trim();
			error.textContent = '';
			if (!texto) { error.textContent = 'Escribe la respuesta.'; return; }
			boton.disabled = true;
			const { error: e } = await d.sb.rpc('comentar', {
				p_promocion: s.promocion, p_version: h.version, p_tipo: h.tipo, p_clave: h.clave, p_punto: null, p_texto: texto, p_padre: id,
			});
			if (e) { error.textContent = d.traducir(e); boton.disabled = false; return; }
			await recargar();
		});
		art.querySelector('[data-reabrir]')?.addEventListener('click', async () => {
			if (!confirm('¿Reabrir este comentario? Volverá a estar pendiente para Claude.')) return;
			const { error: e } = await d.sb.rpc('reabrir_comentario', { p_comentario: id });
			if (e) { alert(d.traducir(e)); return; }
			await recargar();
		});
		art.querySelector('[data-borrar]')?.addEventListener('click', async () => {
			if (!confirm('¿Borrar este comentario?')) return;
			const { error: e } = await d.sb.rpc('borrar_comentario', { p_comentario: id });
			if (e) { alert(d.traducir(e)); return; }
			await recargar();
		});
		art.querySelector('[data-ver-3d]')?.addEventListener('click', () => d.abrir3D!(h.clave, h, h.tipo));
		art.querySelector('[data-ver-plano]')?.addEventListener('click', async (ev) => {
			const zona = art.querySelector<HTMLElement>('[data-zona-plano]')!;
			const boton = ev.currentTarget as HTMLButtonElement;
			if (zona.innerHTML) { zona.innerHTML = ''; boton.textContent = 'Ver en el plano'; return; }
			const src = await d.imagenPlano!(h.clave!, h.version);
			if (!src) { zona.innerHTML = '<p class="vacio">No se ha podido abrir el plano.</p>'; return; }
			zona.innerHTML = htmlPlanoConMarcas(esc, src, 'Plano', [h], false);
			boton.textContent = 'Ocultar el plano';
		});
	}
	return hs;
}

// MUNE Portal · pestaña «Planos comerciales» de una promoción.
//
// MUNE genera los planos comerciales de cada versión (uno por tipología y
// variante, o por vivienda en las unifamiliares) y, cuando la administradora ha
// revisado la versión, se los envía a la promotora. Aquí el equipo los ve y los
// descarga, y las personas elegidas en «Quién valida» los aprueban o piden
// cambios. Un plano queda validado cuando lo aprueban todas. Quedan registrados
// la persona, el momento y la huella del archivo exacto. Si un plano no cambia
// de una versión a otra, sus aprobaciones siguen valiendo.

import { alEnviar, esc, sb, traducir } from './comun';
import { type Hilo, abiertos, hilosDe, htmlPlanoConMarcas, leerHilos, pintarComentarios, textoPedirCambios } from './comentarios';
import {
	type Contexto, type Elemento, baseVisita, avance, chipEstado, depsComentarios, faltanTrasAprobar, guardarDecision, htmlPersonas,
	htmlSinAprobadores, leerValidacion, mensajeAprobado, miVoto, textoPublicando, versionesCon,
} from './validacion';

export const versionesConPlanos = (id: string) => versionesCon(id, 'planos');
export const leerPlanos = (id: string, version: string) => leerValidacion(id, version, 'planos');

/** Enlaces temporales (10 minutos) a las miniaturas. */
async function miniaturas(planos: Elemento[]): Promise<Map<string, string>> {
	const rutas = planos.map((p) => p.miniatura).filter((r): r is string => !!r);
	if (!rutas.length) return new Map();
	const { data } = await sb.storage.from('entregables').createSignedUrls(rutas, 600);
	return new Map((data ?? []).filter((x) => x.signedUrl).map((x) => [x.path!, x.signedUrl!] as [string, string]));
}

const pdfBoton = (p: Elemento, texto = 'Descargar PDF') =>
	`<button class="boton secundario pequeno" type="button" data-bajar="entregables" data-ruta="${esc(p.ruta)}" data-nombre="${esc(p.titulo)}.pdf">${texto}</button>`;

/** ¿Le toca a la sesión validar este plano ahora? */
const meToca = (p: Elemento, ctx: Contexto, actual: boolean) =>
	actual && p.estado !== 'aprobado' && !!miVoto(p, ctx) && miVoto(p, ctx)!.decision !== 'aprobado';

/** La versión más reciente (de las dadas) con todos sus planos validados. */
async function ultimaValidada(id: string, versiones: string[]): Promise<string | null> {
	for (const v of versiones) {
		const { data } = await sb.rpc('validacion_lista', { p_promocion: id, p_version: v, p_tipo: 'planos' });
		if (data === 'listos') return v;
	}
	return null;
}

/** Lista de planos de una versión: siempre a mano para consultarlos y descargarlos, y para validarlos si toca. */
export async function htmlLista(id: string, version: string, versiones: string[], ctx: Contexto): Promise<string> {
	const planos = await leerPlanos(id, version);
	const urls = await miniaturas(planos);
	const actual = version === versiones[0];
	const aprobados = planos.filter((p) => p.estado === 'aprobado').length;
	const sinAprobadores = planos.some((p) => p.estado === 'sin_aprobadores');
	const todos = planos.length > 0 && aprobados === planos.length;
	// Si la versión más reciente aún se está validando, los últimos validados siguen a mano.
	const anteriorValidada = actual && !todos ? await ultimaValidada(id, versiones.slice(1)) : null;
	return `
		<h2>Planos comerciales · ${esc(version)}</h2>
		${!actual ? '<p class="ayuda">Es una versión anterior: puedes consultarla y descargar sus planos.</p>'
			: todos ? '<p class="ayuda">Todos validados. Tenlos siempre a mano aquí para consultarlos y descargarlos.</p>'
			: '<p class="ayuda">El equipo de MUNE los ha preparado a partir de la documentación que aportaste. Puedes consultarlos y descargarlos cuando quieras. Cada plano queda validado cuando lo aprueban todas las personas elegidas para validarlo; si algo no está bien, pide cambios explicando qué hay que corregir. Lo que se apruebe es lo que se publicará.</p>'}
		${anteriorValidada ? `<p class="aviso">Mientras se valida ${esc(version)}, los últimos planos validados siguen disponibles: <a class="enlace" href="#/promocion/${esc(id)}/planos/${esc(anteriorValidada)}">planos de ${esc(anteriorValidada)}</a>.</p>` : ''}
		${actual && sinAprobadores ? htmlSinAprobadores(id, 'planos', ctx) : ''}
		${todos ? '' : `<p class="promo-versiones">${aprobados} de ${planos.length} aprobados</p>
		<progress class="progreso" value="${aprobados}" max="${Math.max(1, planos.length)}" aria-hidden="true"></progress>`}
		${planos.map((p) => {
			const toca = meToca(p, ctx, actual);
			return `<div class="plano-fila">
			${urls.get(p.miniatura ?? '') ? `<a href="#/promocion/${esc(id)}/planos/${p.id}"><img class="plano-mini" src="${esc(urls.get(p.miniatura!)!)}" alt="Miniatura del plano ${esc(p.titulo)}"></a>` : '<span class="plano-mini"></span>'}
			<div class="plano-info">
				<div class="plano-titulo"><span class="requisito-nombre">${esc(p.titulo)}</span>${chipEstado(p, 'planos')}</div>
				<p class="promo-lugar">${esc(p.detalle ?? '')}${p.viviendas ? ` · ${esc(p.viviendas)}` : ''}</p>
				${avance(p, 'planos') ? `<p class="avance">${avance(p, 'planos')}</p>` : ''}
				${htmlPersonas(p, version)}
				<div class="acciones">
					<a class="boton ${toca ? '' : 'secundario'} pequeno" href="#/promocion/${esc(id)}/planos/${p.id}">${toca ? 'Revisar y validar' : 'Ver'}</a>
					${pdfBoton(p)}
				</div>
			</div>
		</div>`;
		}).join('')}
		${versiones.length > 1 ? `<p class="ayuda separado">Planos de otras versiones: ${versiones.filter((v) => v !== version)
			.map((v) => `<a class="enlace" href="#/promocion/${esc(id)}/planos/${esc(v)}">${esc(v)}</a>`).join(' · ')}</p>` : ''}`;
}

/** Un plano: verlo en grande, descargarlo y aprobarlo o pedir cambios. */
export async function pintarDetalle(caja: HTMLElement, id: string, planoId: number, versiones: string[], ctx: Contexto,
	alValidar: (mensaje: string) => void): Promise<void> {
	const { data: e, error } = await sb.from('entregables').select('version').eq('id', planoId).eq('promocion_id', id).eq('tipo', 'plano').maybeSingle();
	if (error) throw error;
	const p = e ? (await leerPlanos(id, e.version)).find((x) => x.id === planoId) : null;
	if (!e || !p) {
		caja.innerHTML = `<a class="enlace volver" href="#/promocion/${esc(id)}/planos">← Todos los planos</a><p class="vacio">No encontramos este plano. Vuelve a la lista y ábrelo desde allí.</p>`;
		return;
	}
	const [urls, hilos] = await Promise.all([miniaturas([p]), leerHilos(sb, id).catch(() => [] as Hilo[])]);
	const actual = e.version === versiones[0];
	const aqui = hilosDe(hilos, 'plano', p.clave, e.version);
	const voto = miVoto(p, ctx);
	const puede = actual && p.estado !== 'aprobado' && !!voto;
	// la visita 3D de esta versión: la publicada, o la vista previa si aún no se ha publicado
	const visita = `${await baseVisita(id, e.version)}/${id}/`;

	caja.innerHTML = `
		<a class="enlace volver" href="#/promocion/${esc(id)}/planos${actual ? '' : `/${esc(e.version)}`}">← Todos los planos</a>
		<div class="plano-titulo separado"><h2>${esc(p.titulo)} · ${esc(e.version)}</h2>${chipEstado(p, 'planos')}</div>
		<p class="promo-lugar">${esc(p.detalle ?? '')}${p.viviendas ? ` · ${esc(p.viviendas)}` : ''}</p>
		${avance(p, 'planos') ? `<p class="avance">${avance(p, 'planos')}</p>` : ''}
		${htmlPersonas(p, e.version)}
		${actual && p.estado === 'sin_aprobadores' ? htmlSinAprobadores(id, 'planos', ctx) : ''}
		${urls.get(p.miniatura ?? '') ? htmlPlanoConMarcas(esc, urls.get(p.miniatura!)!, `Plano ${p.titulo}`, abiertos(aqui), actual) : ''}
		<div class="acciones">
			<button class="boton secundario pequeno" type="button" data-pantalla>Ver a pantalla completa</button>
			${pdfBoton(p)}
			<a class="boton secundario pequeno" href="${esc(visita)}" target="_blank" rel="noopener noreferrer">Ver esta versión en 3D</a>
		</div>
		<section class="comentarios">
			<h2>Comentarios</h2>
			<div data-comentarios></div>
		</section>
		${puede ? `<div class="validar">
			${voto!.decision === 'aprobado' ? '<p class="aviso">Ya has aprobado este plano. Falta que lo aprueben las demás personas. Si ves algo que corregir, todavía puedes pedir cambios.</p>' : ''}
			${voto!.decision === 'rechazado' ? '<p class="aviso">Has pedido cambios en este plano. Si ya está bien, puedes aprobarlo.</p>' : ''}
			${voto!.decision === null && voto!.anterior ? `<p class="aviso">En la ${esc(voto!.anterior.version ?? '')} pediste cambios en este plano${voto!.anterior.comentario ? `: «${esc(voto!.anterior.comentario)}»` : ''}. Comprueba que están hechos antes de aprobarlo.</p>` : ''}
			${voto!.decision !== 'aprobado' ? `<form class="peticion-form" data-aprobar novalidate>
				<h2>Aprobar</h2>
				<label class="casilla"><input type="checkbox" name="confirmado"> He revisado la distribución, las superficies y los datos del plano, y son correctos.</label>
				<p class="error" role="alert"></p>
				<div class="acciones"><button class="boton" type="submit">Aprobar este plano</button></div>
			</form>` : ''}
			<form class="peticion-form" data-rechazar novalidate>
				<h2>Pedir cambios</h2>
				<p class="ayuda" data-recoge hidden></p>
				<label><span data-etiqueta-pedir>Qué hay que corregir</span>
					<textarea name="comentario" rows="3" maxlength="4000" placeholder="Por ejemplo: el dormitorio 2 mide 3,10 m de ancho, no 2,90."></textarea></label>
				<p class="error" role="alert"></p>
				<div class="acciones"><button class="boton secundario" type="submit">Pedir cambios</button></div>
			</form>
			<p class="ayuda">Quedará registrado quién lo aprueba, cuándo y qué archivo exacto. Si el plano cambia después, habrá que validarlo de nuevo.</p>
		</div>` : !actual ? '<p class="ayuda">Este plano es de una versión anterior y solo se puede consultar.</p>' : ''}`;

	// los comentarios del plano; «Pedir cambios» recoge los abiertos
	let hilosPlano = aqui;
	const recoge = caja.querySelector<HTMLElement>('[data-recoge]');
	const pintarRecoge = () => {
		if (!recoge) return;
		const n = abiertos(hilosPlano).length;
		recoge.hidden = !n;
		recoge.textContent = n === 1 ? 'Se enviará el comentario abierto de este plano. Si quieres, añade algo más.'
			: `Se enviarán los ${n} comentarios abiertos de este plano. Si quieres, añade algo más.`;
		caja.querySelector<HTMLElement>('[data-etiqueta-pedir]')!.textContent = n ? 'Algo más (opcional)' : 'Qué hay que corregir';
	};
	pintarRecoge();
	const zonaComentarios = caja.querySelector<HTMLElement>('[data-comentarios]')!;
	hilosPlano = await pintarComentarios(zonaComentarios, caja.querySelector<HTMLElement>('[data-plano-marcas]'), { ...depsComentarios(id), imagenPlano: undefined }, {
		promocion: id, version: e.version, tipo: 'plano', clave: p.clave, comentar: actual,
		alCambiar: (hs) => { hilosPlano = hs; pintarRecoge(); },
	}, hilos);

	caja.querySelector('[data-pantalla]')!.addEventListener('click', async () => {
		const ventana = window.open('about:blank', '_blank');
		if (ventana) ventana.opener = null;
		const { data, error: e2 } = await sb.storage.from('entregables').createSignedUrl(p.ruta, 600);
		if (e2 || !data) { ventana?.close(); alert(traducir(e2, 'abrir el plano')); return; }
		if (ventana) ventana.location.href = data.signedUrl;
	});

	const aprobar = caja.querySelector<HTMLFormElement>('[data-aprobar]');
	if (aprobar) alEnviar(aprobar, async (d) => {
		if (!d.get('confirmado')) throw new Error('Marca la casilla para confirmar que lo has revisado.');
		const faltan = faltanTrasAprobar(p, ctx);
		const texto = faltan
			? `¿Aprobar el plano «${p.titulo}»?\n\nTu aprobación quedará registrada. El plano quedará validado para esta versión cuando lo aprueben todas las personas que tienen que validarlo (${faltan === 1 ? 'falta 1 más' : `faltan ${faltan} más`}). Si más adelante detectas algo que corregir, el equipo de MUNE preparará una versión nueva.`
			: `¿Aprobar el plano «${p.titulo}»?\n\nUna vez aprobado quedará validado para esta versión. Si más adelante detectas algo que corregir, el equipo de MUNE preparará una versión nueva.`;
		if (!confirm(texto)) {
			aprobar.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
			return;
		}
		const despues = await guardarDecision(id, e.version, 'planos', p.id, { decision: 'aprobado', confirmado: true });
		alValidar((despues?.estado === 'aprobado' ? `✓ Plano «${p.titulo}» validado.` : `✓ ${mensajeAprobado(despues, 'planos')}`) + textoPublicando());
	});
	const rechazar = caja.querySelector<HTMLFormElement>('[data-rechazar]');
	if (rechazar) alEnviar(rechazar, async (d) => {
		const escrito = String(d.get('comentario') ?? '').trim();
		if (!abiertos(hilosPlano).length && escrito.length < 3) throw new Error('Explica qué hay que corregir, o marca en el plano lo que hay que cambiar.');
		const comentario = textoPedirCambios(hilosPlano, escrito);
		await guardarDecision(id, e.version, 'planos', p.id, { decision: 'rechazado', comentario });
		alValidar(`Hemos recibido tu petición de cambios en «${p.titulo}». El equipo de MUNE preparará el plano corregido.`);
	});
}

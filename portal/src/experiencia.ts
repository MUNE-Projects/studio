// MUNE Portal · pestaña «Experiencia 3D» de una promoción: siempre se puede
// recorrer (la versión publicada y, si la hay, la que está en revisión).
//
// Cada versión se valida por tipología o variante 3D (y, si existe, el bloque
// «Entorno y elementos generales»), nunca por vista. La validan las personas
// elegidas en «Equipo → Quién valida»; queda validada cuando aprueban todas.
// Las unidades son entregables de tipo «experiencia», sin archivo.
//
// Modo profesional (paso 6a, 027_profesional.sql): desde aquí el 3D se abre con
// un pase de la persona (…/#p-<pase>), sin códigos: todas las viviendas, su
// personalización con precios y lo que ha elegido cada comprador; renders y
// plano comercial. Con «Gestionar personalizaciones», también elegir en su nombre.

import { ESCAPARATE, REVISION, alEnviar, esc, sb, traducir } from './comun';
import {
	type Contexto, type Elemento, avance, baseVisita, chipEstado, faltanTrasAprobar, guardarDecision, htmlPersonas,
	htmlSinAprobadores, leerValidacion, mensajeAprobado, miVoto, textoPublicando, numVersion, tituloUnidad, versionPublicada, versionesCon,
} from './validacion';

export const versionesConExperiencia = (id: string) => versionesCon(id, 'experiencia');

export interface Promocion3D { id: string; nombre: string; publicaActiva: boolean }

export async function pintarExperiencia(caja: HTMLElement, promo: Promocion3D, extra: string, ctx: Contexto,
	alValidar: (mensaje: string, version: string) => void): Promise<void> {
	const { id } = promo;
	const [versiones, publicada] = await Promise.all([versionesConExperiencia(id), versionPublicada(id)]);
	// La versión enviada a validar que aún no se ha publicado se ve en la vista previa.
	const enRevision = versiones[0] && (!publicada || numVersion(versiones[0]) > numVersion(publicada)) ? versiones[0] : null;
	const cabecera = `
		<h2>Experiencia 3D</h2>
		<p class="ayuda">La experiencia 3D de la promoción, siempre a mano para recorrerla y enseñarla. Se abre en modo profesional: ves todas las viviendas con su personalización y lo que ha elegido cada comprador, y puedes sacar renders y descargar el plano comercial.</p>
		${publicada || enRevision ? `<div class="acciones">
			${publicada ? `<a class="boton pequeno" href="${esc(`${ESCAPARATE}/${id}/`)}" data-profesional target="_blank" rel="noopener noreferrer">Recorrer la versión publicada (${esc(publicada)})</a>` : ''}
			${enRevision ? `<a class="boton ${publicada ? 'secundario' : ''} pequeno" href="${esc(`${REVISION}/${id}/`)}" data-profesional target="_blank" rel="noopener noreferrer">Recorrer la versión en revisión (${esc(enRevision)})</a>` : ''}
			${publicada ? `<a class="enlace" href="${esc(`${ESCAPARATE}/${id}/`)}" target="_blank" rel="noopener noreferrer">Ver como el público</a>` : ''}
		</div>
		<p class="error" role="alert" data-error-profesional></p>
		${htmlCompartir(promo, publicada)}` : '<p class="vacio">Todavía no hay ninguna versión. Cuando el equipo de MUNE prepare la primera, podrás recorrerla aquí y validarla cuando haga falta.</p>'}`;
	if (!versiones.length) {
		caja.innerHTML = cabecera;
		abrirProfesional(caja, id);
	conectarCompartir(caja);
		return;
	}
	const version = versiones.includes(extra) ? extra : versiones[0];
	const actual = version === versiones[0];
	const [unidades, base] = await Promise.all([leerValidacion(id, version, 'experiencia'), baseVisita(id, version)]);
	const aprobadas = unidades.filter((u) => u.estado === 'aprobado').length;
	const todas = unidades.length > 0 && aprobadas === unidades.length;
	const pendientes = unidades.filter((u) => u.estado !== 'aprobado').map(tituloUnidad);

	caja.innerHTML = `${cabecera}
		<h2 class="separado">${todas ? 'Tipologías' : 'Validación'} · ${esc(version)}</h2>
		${!actual ? '<p class="ayuda">Es una versión anterior y solo se puede consultar.</p>'
			: todas ? '<p class="ayuda">Todas validadas. Puedes recorrer cada tipología cuando quieras.</p>'
			: '<p class="ayuda">Recorre cada tipología en 3D: distribución, espacios, materiales, acabados, mobiliario, vistas guiadas, exteriores y modo Plano. Cada una queda validada cuando la aprueban todas las personas elegidas para validarla. Si algo no está bien, pide cambios e indica, si quieres, en qué vista o zona.</p>'}
		${actual && unidades.some((u) => u.estado === 'sin_aprobadores') ? htmlSinAprobadores(id, 'experiencia', ctx) : ''}
		${todas ? '' : `<p class="promo-versiones">${aprobadas} de ${unidades.length} aprobadas${pendientes.length && aprobadas ? ` · Pendiente: ${esc(pendientes.join(', '))}` : ''}</p>
		<progress class="progreso" value="${aprobadas}" max="${Math.max(1, unidades.length)}" aria-hidden="true"></progress>`}
		${unidades.map((u) => htmlUnidad(id, u, version, actual, base, ctx)).join('')}
		${versiones.length > 1 ? `<p class="ayuda separado">Otras versiones: ${versiones.filter((v) => v !== version)
			.map((v) => `<a class="enlace" href="#/promocion/${esc(id)}/experiencia/${esc(v)}">${esc(v)}</a>`).join(' · ')}</p>` : ''}`;
	abrirProfesional(caja, id);
	conectarCompartir(caja);

	for (const u of unidades) {
		const raiz = caja.querySelector<HTMLElement>(`[data-unidad="${u.id}"]`);
		if (!raiz) continue;
		const nombre = `Experiencia 3D · ${tituloUnidad(u)}`;
		const aprobar = raiz.querySelector<HTMLFormElement>('[data-aprobar]');
		if (aprobar) alEnviar(aprobar, async (d) => {
			if (!d.get('confirmado')) throw new Error('Marca la casilla para confirmar que la has recorrido.');
			const faltan = faltanTrasAprobar(u, ctx);
			const texto = faltan
				? `¿Aprobar «${nombre}»?\n\nTu aprobación quedará registrada. Quedará validada para esta versión cuando la aprueben todas las personas que tienen que validarla (${faltan === 1 ? 'falta 1 más' : `faltan ${faltan} más`}). Si más adelante detectas algo que corregir, el equipo de MUNE preparará una versión nueva.`
				: `¿Aprobar «${nombre}»?\n\nUna vez aprobada quedará validada para esta versión. Si más adelante detectas algo que corregir, el equipo de MUNE preparará una versión nueva.`;
			if (!confirm(texto)) {
				aprobar.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
				return;
			}
			const despues = await guardarDecision(id, version, 'experiencia', u.id, { decision: 'aprobado', confirmado: true });
			alValidar(`✓ ${mensajeAprobado(despues, 'experiencia')}${textoPublicando()}`, version);
		});
		const rechazar = raiz.querySelector<HTMLFormElement>('[data-rechazar]');
		if (rechazar) alEnviar(rechazar, async (d) => {
			const comentario = String(d.get('comentario') ?? '').trim();
			if (comentario.length < 3) throw new Error('Explica qué hay que cambiar.');
			const zona = String(d.get('zona') ?? '').trim();
			await guardarDecision(id, version, 'experiencia', u.id, { decision: 'rechazado', comentario, zona: zona || null });
			alValidar(`Hemos recibido tu petición de cambios en «${nombre}». El equipo de MUNE preparará la versión corregida.`, version);
		});
	}
}

function htmlUnidad(id: string, u: Elemento, version: string, actual: boolean, base: string, ctx: Contexto): string {
	const voto = miVoto(u, ctx);
	const puede = actual && u.estado !== 'aprobado' && !!voto;
	const vistas = (u.vistas ?? []).filter((v) => v && v.nombre);
	return `<article class="unidad" data-unidad="${u.id}">
		<div class="plano-titulo"><h3>Experiencia 3D · ${esc(tituloUnidad(u))}</h3>${chipEstado(u, 'experiencia')}</div>
		${u.detalle || u.viviendas ? `<p class="promo-lugar">${esc(u.detalle ?? '')}${u.detalle && u.viviendas ? ' · ' : ''}${esc(u.viviendas ?? '')}</p>` : ''}
		${avance(u, 'experiencia') ? `<p class="avance">${avance(u, 'experiencia')}</p>` : ''}
		${htmlPersonas(u, version)}
		${actual ? `<div class="acciones"><a class="boton ${puede && voto!.decision !== 'aprobado' ? '' : 'secundario'} pequeno" href="${esc(`${base}/${id}/?ver=${encodeURIComponent(u.clave)}`)}" data-profesional target="_blank" rel="noopener noreferrer">Recorrer en 3D</a></div>` : ''}
		${puede ? `<details class="validar-plegable" ${voto!.decision === null ? 'open' : ''}>
			<summary>${voto!.decision === 'aprobado' ? 'Ya la has aprobado · pedir cambios' : 'Validar'}</summary>
			<div class="validar">
				${voto!.decision === 'aprobado' ? '<p class="aviso">Ya has aprobado esta parte. Falta que la aprueben las demás personas. Si ves algo que corregir, todavía puedes pedir cambios.</p>' : ''}
				${voto!.decision === 'rechazado' ? '<p class="aviso">Has pedido cambios aquí. Si ya está bien, puedes aprobarla.</p>' : ''}
				${voto!.decision === null && voto!.anterior ? `<p class="aviso">En la ${esc(voto!.anterior.version ?? '')} pediste cambios aquí${voto!.anterior.zona ? ` (${esc(voto!.anterior.zona)})` : ''}${voto!.anterior.comentario ? `: «${esc(voto!.anterior.comentario)}»` : ''}. Comprueba que están hechos antes de aprobarla.</p>` : ''}
				${voto!.decision !== 'aprobado' ? `<form class="peticion-form" data-aprobar novalidate>
					<h3 class="subtitulo">Aprobar</h3>
					<label class="casilla"><input type="checkbox" name="confirmado"> He recorrido esta tipología: distribución, espacios, materiales, acabados, mobiliario, vistas guiadas, exteriores y modo Plano.</label>
					<p class="error" role="alert"></p>
					<div class="acciones"><button class="boton" type="submit">Aprobar Experiencia 3D</button></div>
				</form>` : ''}
				<form class="peticion-form" data-rechazar novalidate>
					<h3 class="subtitulo">Pedir cambios</h3>
					<label>Vista o zona (opcional)
						<select name="zona">
							${vistas.map((v) => `<option value="${esc(v.nombre.slice(0, 120))}">${esc(v.nombre)}</option>`).join('')}
							<option value="" selected>General / otra</option>
						</select></label>
					<label>Qué hay que cambiar
						<textarea name="comentario" rows="3" maxlength="4000" placeholder="Por ejemplo: la ventana del dormitorio principal debe llegar hasta el suelo."></textarea></label>
					<p class="error" role="alert"></p>
					<div class="acciones"><button class="boton secundario" type="submit">Pedir cambios</button></div>
				</form>
			</div>
		</details>` : ''}
	</article>`;
}

/**
 * Los enlaces al 3D se abren en modo profesional: se pide un pase a Supabase y
 * se añade al enlace (#p-…), que la web quita de la dirección al entrar. La
 * pestaña se abre antes de pedirlo para que el navegador no la bloquee.
 */
function abrirProfesional(caja: HTMLElement, id: string): void {
	const error = caja.querySelector<HTMLElement>('[data-error-profesional]');
	for (const a of caja.querySelectorAll<HTMLAnchorElement>('a[data-profesional]')) {
		a.addEventListener('click', async (ev) => {
			ev.preventDefault();
			if (error) error.textContent = '';
			const ventana = window.open('', '_blank');
			if (ventana) {
				ventana.opener = null;
				ventana.document.title = 'Abriendo la Experiencia 3D…';
			}
			const { data, error: e } = await sb.rpc('abrir_experiencia_profesional', { p_promocion: id });
			if (e || typeof data !== 'string') {
				ventana?.close();
				if (error) error.textContent = traducir(e, 'abrir la Experiencia 3D');
				else alert(traducir(e, 'abrir la Experiencia 3D'));
				return;
			}
			const destino = `${a.href.split('#')[0]}#p-${data}`;
			if (ventana) ventana.location.href = destino;
			else location.href = destino;
		});
	}
}

/**
 * La Experience pública para compartir (paso 6b): su dirección y el código para
 * insertarla en cualquier web. Solo con la Experience pública activa y una
 * versión publicada.
 */
function htmlCompartir(promo: Promocion3D, publicada: string | null): string {
	if (!promo.publicaActiva) {
		return `<h2 class="separado">Experiencia pública</h2>
			<p class="ayuda">La experiencia pública de esta promoción está apagada: su dirección no enseña la visita. Siguen entrando los compradores con su código y tu equipo desde aquí. Para encenderla, escribe al equipo de MUNE.</p>`;
	}
	if (!publicada) return '';
	const url = `${ESCAPARATE}/${promo.id}/`;
	const codigo = `<iframe src="${url}" title="${esc(`Experiencia 3D · ${promo.nombre}`)}" style="width:100%;aspect-ratio:16/10;border:0;border-radius:12px" allow="fullscreen; xr-spatial-tracking" allowfullscreen loading="lazy"></iframe>`;
	return `<h2 class="separado">Compartir la experiencia pública</h2>
		<p class="ayuda">La dirección de la visita pública, para enviarla o enlazarla, y el código para insertarla en tu web (o en cualquier otra). Siempre enseña la última versión publicada.</p>
		<label>Dirección pública <input type="text" readonly value="${esc(url)}" data-compartir-texto></label>
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-copiar="${esc(url)}">Copiar dirección pública</button></div>
		<label>Código de inserción <textarea rows="3" readonly data-compartir-texto>${esc(codigo)}</textarea></label>
		<div class="acciones"><button class="boton secundario pequeno" type="button" data-copiar="${esc(codigo)}">Copiar código de inserción</button></div>`;
}

function conectarCompartir(caja: HTMLElement): void {
	for (const t of caja.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-compartir-texto]')) {
		t.addEventListener('focus', () => t.select());
	}
	for (const b of caja.querySelectorAll<HTMLButtonElement>('button[data-copiar]')) {
		const texto = b.textContent ?? '';
		b.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(b.dataset.copiar ?? '');
				b.textContent = 'Copiado ✓';
			} catch {
				b.textContent = 'Selecciónalo y cópialo a mano';
			}
			setTimeout(() => (b.textContent = texto), 2500);
		});
	}
}

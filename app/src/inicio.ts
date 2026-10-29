// Inicio de MUNE Studio: lo que necesita tu atención, con enlace a cada sitio.
// Arriba, los avisos del sistema (015_sistema.sql); después, las versiones
// pendientes con el estado de su validación (planos comerciales y Experiencia
// 3D), la documentación por revisar, los comentarios de las promotoras, las
// opciones nuevas pedidas y las peticiones abiertas.

import { esc, fecha, sb, traducir } from './comun';
import { ESTADOS_PETICION, peticionesAbiertas } from './peticiones';
import { avisosSistema, pintarAvisos } from './sistema';
import { leerValidacion, pasoInicio } from './validacion';
import { REVISION, estadoVersiones } from './versiones';

export async function pantallaInicio(destino: HTMLElement): Promise<void> {
	destino.innerHTML = `
		<section class="tarjeta" data-avisos hidden>
			<h2>Avisos del sistema</h2>
			<div data-lista-avisos></div>
		</section>
		<section class="tarjeta">
			<h2>Versiones pendientes</h2>
			<div data-versiones><p class="vacio">Comprobando las versiones…</p></div>
		</section>
		<section class="tarjeta">
			<h2>Documentación por revisar</h2>
			<div data-documentos><p class="vacio">Cargando…</p></div>
		</section>
		<section class="tarjeta" data-comentarios hidden>
			<h2>Comentarios de las promotoras</h2>
			<p class="ayuda">Comentarios abiertos en los planos, el 3D o la versión. Respóndelos y márcalos como resueltos en «Resumen y versiones» de cada promoción. Claude también los lee con el robot al preparar la versión siguiente.</p>
			<div data-lista-comentarios></div>
		</section>
		<section class="tarjeta" data-opciones-pedidas hidden>
			<h2>Opciones por preparar</h2>
			<p class="ayuda">Personalizaciones y mejoras que una promotora ha añadido. Hay que preparar su aspecto en el 3D (con el documento que hayan adjuntado) y añadirlas en una versión nueva; después, márcalas como añadidas en la pestaña Personalización de su promoción. Claude puede leer esos documentos con el robot.</p>
			<div data-lista-opciones></div>
		</section>
		<section class="tarjeta">
			<h2>Peticiones de cambios abiertas</h2>
			<p class="ayuda">Cuando quieras que Claude se ponga con ellas, díselo en Claude Code: «revisa las peticiones del Panel».</p>
			<div data-peticiones><p class="vacio">Cargando…</p></div>
		</section>
		<p class="ayuda" data-sistema-en-orden hidden>✓ Todo en orden: llaves vigentes, espacio suficiente y vigilancia funcionando. <a href="#/sistema">Ver el estado</a></p>
		<div class="acciones"><a class="boton secundario" href="#/promotoras">Ver todas las promotoras y promociones</a></div>`;

	void avisosSistema().then((avisos) => {
		const caja = destino.querySelector<HTMLElement>('[data-avisos]');
		if (!caja) return;
		caja.hidden = !avisos.length;
		destino.querySelector<HTMLElement>('[data-sistema-en-orden]')!.hidden = !!avisos.length;
		caja.querySelector<HTMLElement>('[data-lista-avisos]')!.innerHTML = pintarAvisos(avisos);
	}, (e) => {
		const caja = destino.querySelector<HTMLElement>('[data-avisos]');
		if (!caja) return;
		caja.hidden = false;
		caja.querySelector<HTMLElement>('[data-lista-avisos]')!.innerHTML = `<p class="error">${esc(traducir(e))}</p>`;
	});

	const { data } = await sb.from('promociones').select('id, nombre, promotoras(nombre)').eq('activa', true).order('nombre');
	const promociones = (data ?? []) as unknown as { id: string; nombre: string; promotoras: { nombre: string } | null }[];

	void Promise.all(promociones.map(async (p) => {
		const e = await estadoVersiones(p.id);
		if (!e.pendiente) return null;
		const version = e.rev!.version;
		let paso: [string, string, string, number];
		try {
			paso = pasoInicio(await leerValidacion(REVISION, p.id, version, e.pub?.version ?? null));
		} catch (err) {
			console.error('[MUNE Studio]', err);
			paso = ['Sin comprobar', '', 'No se ha podido comprobar la validación. Ábrela para verla.', 6];
		}
		return { p, version, fechaV: e.rev!.fecha, paso };
	})).then((lista) => {
		// Primero lo que depende de ti (publicar, corregir, enviar); al final lo que espera a la promotora
		const pendientes = lista.filter((x) => x !== null).sort((a, b) => a.paso[3] - b.paso[3]);
		const caja = destino.querySelector<HTMLElement>('[data-versiones]');
		if (!caja) return;
		caja.innerHTML = pendientes.length ? `<div class="lista-enlaces">${pendientes.map((x) => {
			const [etiqueta, clase, texto] = x.paso;
			return `<a class="fila-enlace" href="#/promocion/${esc(x.p.id)}/resumen">
				<span><strong>${esc(x.p.nombre)} · ${esc(x.version)}</strong><br><span class="promo-lugar">${esc(x.p.promotoras?.nombre ?? '')} · preparada el ${esc(fecha(x.fechaV))}. ${esc(texto)}</span></span>
				<span class="estado ${clase}">${esc(etiqueta)}</span>
			</a>`;
		}).join('')}</div>` : '<p class="vacio">Nada pendiente: todas las promociones están al día.</p>';
	});

	void sb.from('documentos').select('id, promocion_id, requisito_id, version, subido_en, promociones(nombre)')
		.eq('estado', 'pendiente').order('subido_en', { ascending: false }).limit(200).then(({ data: docs }) => {
			const caja = destino.querySelector<HTMLElement>('[data-documentos]');
			if (!caja) return;
			// Por promoción: cuántos documentos esperan revisión y desde cuándo.
			const grupos = new Map<string, { nombre: string; n: number; ultimo: string }>();
			for (const d of (docs ?? []) as unknown as { promocion_id: string; subido_en: string; promociones: { nombre: string } | null }[]) {
				const g = grupos.get(d.promocion_id) ?? { nombre: d.promociones?.nombre ?? d.promocion_id, n: 0, ultimo: d.subido_en };
				g.n += 1;
				grupos.set(d.promocion_id, g);
			}
			caja.innerHTML = grupos.size ? `<div class="lista-enlaces">${[...grupos].map(([id, g]) => `
				<a class="fila-enlace" href="#/promocion/${esc(id)}/documentacion">
					<span><strong>${esc(g.nombre)}</strong><br><span class="promo-lugar">Última subida: ${esc(fecha(g.ultimo))}</span></span>
					<span class="estado pendiente">${g.n} por revisar</span>
				</a>`).join('')}</div>` : '<p class="vacio">No hay documentación por revisar.</p>';
		});

	void sb.rpc('comentarios_abiertos').then(({ data: filas }) => {
		const caja = destino.querySelector<HTMLElement>('[data-comentarios]');
		const lista = (filas ?? []) as { promocion_id: string; abiertos: number; sin_respuesta: number }[];
		if (!caja || !lista.length) return;
		const nombre = new Map(promociones.map((p) => [p.id, p.nombre]));
		caja.hidden = false;
		caja.querySelector<HTMLElement>('[data-lista-comentarios]')!.innerHTML = `<div class="lista-enlaces">${lista
			.sort((a, b) => b.sin_respuesta - a.sin_respuesta).map((x) => `
			<a class="fila-enlace" href="#/promocion/${esc(x.promocion_id)}/resumen">
				<span><strong>${esc(nombre.get(x.promocion_id) ?? x.promocion_id)}</strong><br><span class="promo-lugar">${x.abiertos === 1 ? '1 comentario abierto' : `${x.abiertos} comentarios abiertos`}</span></span>
				<span class="estado ${x.sin_respuesta ? 'pendiente' : ''}">${x.sin_respuesta ? `${x.sin_respuesta} sin responder` : 'Respondidos'}</span>
			</a>`).join('')}</div>`;
	});

	void sb.rpc('opciones_pedidas_pendientes').then(({ data: pedidas }) => {
		const caja = destino.querySelector<HTMLElement>('[data-opciones-pedidas]');
		const lista = (pedidas ?? []) as { promocion_id: string; promocion: string; nombre: string; pedido_en: string }[];
		if (!caja || !lista.length) return;
		caja.hidden = false;
		caja.querySelector<HTMLElement>('[data-lista-opciones]')!.innerHTML = `<div class="lista-enlaces">${lista.map((x) => `
			<a class="fila-enlace" href="#/promocion/${esc(x.promocion_id)}/personalizacion">
				<span><strong>${esc(x.promocion)}</strong><br><span class="promo-lugar">${esc(x.nombre)} · pedida el ${esc(fecha(x.pedido_en))}</span></span>
				<span class="estado pendiente">En preparación</span>
			</a>`).join('')}</div>`;
	});

	const peticiones = await peticionesAbiertas();
	const caja = destino.querySelector<HTMLElement>('[data-peticiones]');
	if (!caja) return;
	caja.innerHTML = peticiones.length ? `<div class="lista-enlaces">${peticiones.map((x) => {
		const [etiqueta, clase] = ESTADOS_PETICION[x.estado] ?? [x.estado, ''];
		return `<a class="fila-enlace" href="#/promocion/${esc(x.promocion_id)}/peticiones">
			<span><strong>${esc(x.promociones?.nombre ?? x.promocion_id)}</strong><br><span class="promo-lugar">${esc(x.texto.length > 90 ? `${x.texto.slice(0, 90)}…` : x.texto)}</span></span>
			<span class="estado ${clase}">${esc(etiqueta)}</span>
		</a>`;
	}).join('')}</div>` : '<p class="vacio">No hay peticiones abiertas.</p>';
}

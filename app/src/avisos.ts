// Avisos por email a la promotora (función «avisar-promotora», 012): planos
// para validar, documento rechazado y versión publicada. Devuelve una frase
// para mostrar en MUNE Studio; si el aviso falla, lo hecho no se deshace.

import { sb, traducir } from './comun';

export async function avisarPromotora(cuerpo: Record<string, unknown>): Promise<string> {
	const { data, error } = await sb.functions.invoke('avisar-promotora', { body: cuerpo });
	if (error) {
		let texto = error.message;
		try { texto = (await (error as { context?: Response }).context?.json())?.error ?? texto; } catch { /* sin detalle */ }
		const motivo = traducir(new Error(texto));
		return `No se ha podido avisar a la promotora por email${motivo === texto ? ` (${motivo.replace(/\.$/, '')})` : ''}. Lo demás está hecho: si hace falta, avísale tú.`;
	}
	const r = data as { enviado: boolean; destinatarios?: number; motivo?: string };
	return r.enviado ? `Se ha avisado por email a ${r.destinatarios} persona${r.destinatarios === 1 ? '' : 's'} de la promotora.`
		: `No se ha enviado ningún email: ${(r.motivo ?? 'sin motivo indicado').replace(/\.$/, '')}.`;
}

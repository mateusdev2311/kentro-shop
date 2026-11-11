import { Logger } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { verificarDestino } from '../conectores/nucleo/destino';
import { tipoDaImagem } from '../integracoes/fotos.service';

// Conversa com a API oficial do WhatsApp (Graph API da Meta). O token só existe no servidor.

export const CLIENTE_META = Symbol('CLIENTE_META');

const GRAPH = 'https://graph.facebook.com/v24.0';
const ESPERA_MS = 20_000;
/** Limite da Meta para imagem em mensagem. */
const MAX_FOTO_BYTES = 5 * 1024 * 1024;

export interface FotoMeta {
  bytes: Buffer;
  tipo: 'image/jpeg' | 'image/png';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RespostaMeta = Record<string, any>;

export interface ClienteMeta {
  chamar(token: string, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<RespostaMeta>;
  /** Sobe a foto para o envio; devolve o id da mídia. */
  enviarMidia(token: string, telefoneId: string, foto: FotoMeta): Promise<string>;
  /** Sobe a foto de exemplo do template; devolve o "handle" que a Meta pede na aprovação. */
  enviarExemplo(token: string, appId: string, foto: FotoMeta): Promise<string>;
  /** Baixa a foto do produto. Null: não abriu, é grande demais ou não é JPG/PNG (únicos formatos aceitos pela Meta). */
  baixarFoto(url: string): Promise<FotoMeta | null>;
}

/** Recusa da Meta, já com a mensagem para a pessoa. */
export class ErroMeta extends ErroApi {
  constructor(
    mensagem: string,
    readonly codigoMeta?: number,
    readonly subcodigoMeta?: number,
  ) {
    super(400, 'META_RECUSOU', mensagem);
  }
}

const MUITAS_SOLICITACOES = new Set([4, 80008, 613, 130429, 131056]);
const logger = new Logger('Meta');

/** O que a Meta disse, com o código: vai junto da explicação para dar para diagnosticar sem abrir o servidor. */
function detalheDaMeta(e: RespostaMeta, codigo?: number, subcodigo?: number): string {
  const partes = [e.message, e.error_user_msg, e.error_data?.details].map((p) => String(p ?? '').trim()).filter(Boolean);
  const texto = [...new Set(partes)].join(' — ');
  const numero = codigo === undefined ? '' : `#${codigo}${subcodigo === undefined ? '' : `/${subcodigo}`}`;
  return [numero, texto].filter(Boolean).join(' ');
}

export function erroDaMeta(status: number, corpo: RespostaMeta): ErroMeta {
  const e: RespostaMeta = corpo?.error ?? {};
  const codigo = typeof e.code === 'number' ? e.code : undefined;
  const subcodigo = typeof e.error_subcode === 'number' ? e.error_subcode : undefined;
  const detalhe = String(e.error_data?.details ?? '');
  const original = String(e.error_user_msg || detalhe || e.message || `A Meta respondeu com erro ${status}.`);
  const com = (texto: string) => new ErroMeta(texto, codigo, subcodigo);
  if (codigo === 190) return com('O token da Meta é inválido ou expirou. Gere outro e salve de novo na aba WhatsApp das Configurações.');
  if (codigo === 10 || (codigo !== undefined && codigo >= 200 && codigo <= 299)) {
    // O código 10 também cobre recusas que não são do token (ex.: regra do número ou do destinatário): o detalhe diz qual.
    return com(`A Meta negou esta operação por permissão. Detalhe da Meta: ${detalheDaMeta(e, codigo, subcodigo) || `erro ${status}`}.`);
  }
  if (codigo !== undefined && MUITAS_SOLICITACOES.has(codigo)) return com('A Meta recusou por excesso de envios seguidos. Aguarde um minuto e tente de novo.');
  if (codigo === 132001) return com('O template deste carrossel não existe ou ainda não foi aprovado pela Meta. Confira na aba WhatsApp das Configurações.');
  if (codigo === 132000 || codigo === 132012) return com('O envio não bate com o template aprovado na Meta. Confira os templates na aba WhatsApp das Configurações.');
  if (codigo === 131026) return com('A Meta não conseguiu entregar: este número pode não ter WhatsApp.');
  if (codigo === 131049) return com('A Meta decidiu não entregar para manter a qualidade (limite de mensagens de marketing por pessoa).');
  return com(`A Meta recusou: ${original}`);
}

/** Caminho sem a consulta (o debug_token leva o token na URL). */
function semConsulta(url: string): string {
  return url.split('?')[0].replace(GRAPH, '');
}

async function requisitar(url: string, init: RequestInit): Promise<RespostaMeta> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(ESPERA_MS) });
  } catch {
    throw new ErroApi(502, 'META_INDISPONIVEL', 'A Meta não respondeu. Tente de novo em instantes.');
  }
  const corpo = (await resposta.json().catch(() => ({}))) as RespostaMeta;
  if (!resposta.ok || corpo?.error) {
    const e: RespostaMeta = corpo?.error ?? {};
    logger.warn(
      `${init.method ?? 'GET'} ${semConsulta(url)} → ${resposta.status} ` +
        JSON.stringify({ code: e.code, subcode: e.error_subcode, type: e.type, message: e.message, user: e.error_user_msg, details: e.error_data?.details, trace: e.fbtrace_id }),
    );
    throw erroDaMeta(resposta.status, corpo);
  }
  return corpo;
}

export const clienteMetaHttp: ClienteMeta = {
  chamar(token, metodo, caminho, corpo) {
    return requisitar(`${GRAPH}/${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  },

  async enviarMidia(token, telefoneId, foto) {
    const formulario = new FormData();
    formulario.set('messaging_product', 'whatsapp');
    formulario.set('type', foto.tipo);
    formulario.set('file', new Blob([new Uint8Array(foto.bytes)], { type: foto.tipo }), foto.tipo === 'image/png' ? 'foto.png' : 'foto.jpg');
    const r = await requisitar(`${GRAPH}/${telefoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formulario });
    return String(r.id);
  },

  async enviarExemplo(token, appId, foto) {
    const consulta = new URLSearchParams({ file_length: String(foto.bytes.length), file_type: foto.tipo });
    const sessao = await requisitar(`${GRAPH}/${appId}/uploads?${consulta}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!String(sessao.id ?? '').startsWith('upload:')) throw new ErroMeta('A Meta não abriu o envio da foto de exemplo.');
    const r = await requisitar(`${GRAPH}/${sessao.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
      body: new Uint8Array(foto.bytes),
    });
    return String(r.h);
  },

  async baixarFoto(url) {
    try {
      await verificarDestino(url);
      const resposta = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(ESPERA_MS) });
      if (!resposta.ok) return null;
      const bytes = Buffer.from(await resposta.arrayBuffer());
      if (bytes.length > MAX_FOTO_BYTES) return null;
      const tipo = tipoDaImagem(bytes);
      return tipo === 'image/jpeg' || tipo === 'image/png' ? { bytes, tipo } : null;
    } catch {
      return null;
    }
  },
};

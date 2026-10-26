import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Writable } from 'node:stream';
import { Client, enterPassiveModeIPv6, FTPContext } from 'basic-ftp';
// A estratégia que força o IP do servidor não sai no índice do pacote.
import { enterPassiveModeIPv4_forceControlHostIP } from 'basic-ftp/dist/transfer';
import { CampoCredencial } from './conector';
import { hostPublico, Resolvedor } from './destino';
import { resolverHostPublico } from './banco';
import { CredencialInvalida, ErroConector, PlataformaIndisponivel, RecusadoPelaPlataforma } from './erros';

// Fotos dos produtos num FTP da loja (ex.: banco de imagens do ERP). Só leitura: listar e baixar.
// O cliente final nunca acessa o FTP: a API copia as fotos e as serve em https.

export interface ArquivoFtp {
  nome: string;
  tamanho: number;
  /** Como o servidor informa (só serve para perceber que o arquivo mudou). */
  modificadoEm: string;
}

export interface ConexaoFotos {
  listar(): Promise<ArquivoFtp[]>;
  baixar(nome: string, maxBytes: number): Promise<Buffer>;
  fechar(): void;
}

export interface CredenciaisFtp {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
  pasta: string;
}

/** Abre o FTP de fotos da loja. Os testes trocam por um FTP em memória. */
export type AbrirFtp = (credenciais: CredenciaisFtp) => Promise<ConexaoFotos>;

export const ABRIR_FTP = Symbol('ABRIR_FTP');

const PORTA_FTP = 21;
const NOME_HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Campos opcionais: sem servidor, a loja fica sem fotos (como hoje). */
export function camposFtpFotos(): CampoCredencial[] {
  return [
    { chave: 'ftp_host', rotulo: 'Fotos: servidor FTP', tipo: 'texto', obrigatorio: false, ajuda: 'Opcional. Onde ficam as fotos dos produtos, nomeadas pelo código de barras (ex.: 7891234567890.jpg). Sem ftp://.' },
    { chave: 'ftp_porta', rotulo: 'Fotos: porta do FTP', tipo: 'texto', obrigatorio: false, ajuda: `Vazio = ${PORTA_FTP}.` },
    { chave: 'ftp_usuario', rotulo: 'Fotos: usuário do FTP', tipo: 'texto', obrigatorio: false },
    { chave: 'ftp_senha', rotulo: 'Fotos: senha do FTP', tipo: 'segredo', obrigatorio: false },
    { chave: 'ftp_pasta', rotulo: 'Fotos: pasta', tipo: 'texto', obrigatorio: false, ajuda: 'Vazio = pasta inicial do FTP. Ex.: /Banco de imagens' },
  ];
}

/** null = loja sem FTP de fotos; texto = o que está errado. */
export function lerCredenciaisFtp(c: Record<string, string>): CredenciaisFtp | null | string {
  const host = (c.ftp_host ?? '').trim().toLowerCase().replace(/^ftp:\/\//, '').replace(/\/+$/, '');
  if (!host) return null;
  if (/[/:@\s]/.test(host) && !isIP(host)) return 'Informe só o nome ou o IP do servidor FTP, sem ftp://, porta ou pasta.';
  if (!isIP(host) && !NOME_HOST.test(host)) return 'O servidor FTP não é um IP nem um nome válido.';
  if (!hostPublico(host)) return 'O servidor FTP precisa ter endereço público.';
  const textoPorta = (c.ftp_porta ?? '').trim();
  const porta = textoPorta ? Number(textoPorta) : PORTA_FTP;
  if (!/^\d{0,5}$/.test(textoPorta) || !Number.isInteger(porta) || porta < 1 || porta > 65535) return 'A porta do FTP precisa ser um número de 1 a 65535.';
  const usuario = (c.ftp_usuario ?? '').trim();
  if (!usuario || !c.ftp_senha) return 'Informe o usuário e a senha do FTP.';
  const pasta = (c.ftp_pasta ?? '').trim() || '/';
  if (pasta.length > 200 || /[\r\n]/.test(pasta) || pasta.split('/').includes('..')) return 'A pasta do FTP não é válida.';
  return { host, porta, usuario, senha: c.ftp_senha, pasta };
}

/** Para onde a senha do FTP vai (trocar o servidor exige digitar a senha de novo). */
export function destinoFtp(c: Record<string, string>): string {
  const host = (c.ftp_host ?? '').trim().toLowerCase();
  return host ? `${host}:${(c.ftp_porta ?? '').trim() || PORTA_FTP}` : '';
}

/** Erro do FTP no erro padrão dos conectores (a resposta do servidor nunca volta para a tela). */
export function traduzirErroFtp(e: unknown): ErroConector {
  if (e instanceof ErroConector) return e;
  const codigo = (e as { code?: unknown } | null)?.code;
  if (codigo === 530) return new CredencialInvalida();
  if (codigo === 550) return new RecusadoPelaPlataforma('A pasta das fotos não existe no FTP ou o usuário não tem acesso a ela.');
  const mensagem = e instanceof Error ? e.message : '';
  if (/passive mode|data connection/i.test(mensagem)) {
    return new RecusadoPelaPlataforma('O FTP conectou, mas recusou a transferência dos arquivos (portas do modo passivo bloqueadas no firewall do servidor).');
  }
  return new PlataformaIndisponivel();
}

/**
 * Modo passivo sempre no IP do próprio servidor: o endereço que o servidor indica para os dados é ignorado,
 * para um servidor malicioso não fazer a API conectar em outro lugar (rede interna, por exemplo).
 */
async function passivoNoMesmoServidor(ftp: FTPContext) {
  try {
    return await enterPassiveModeIPv6(ftp); // EPSV: só a porta, no mesmo IP
  } catch {
    return enterPassiveModeIPv4_forceControlHostIP(ftp);
  }
}

const resolverDns: Resolvedor = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

const NOME_SEGURO = /^[^/\\\r\n]{1,200}$/;

export function criarAbrirFtp(resolver: Resolvedor = resolverDns): AbrirFtp {
  return async (credenciais) => {
    const cliente = new Client(30_000);
    try {
      const ip = await resolverHostPublico(credenciais.host, resolver);
      // O servidor de fotos da Rede Biomax recusa TLS: FTP simples. O usuário deve ter só leitura.
      await cliente.access({ host: ip, port: credenciais.porta, user: credenciais.usuario, password: credenciais.senha, secure: false });
      cliente.prepareTransfer = passivoNoMesmoServidor;
      if (credenciais.pasta !== '/') await cliente.cd(credenciais.pasta);
    } catch (e) {
      cliente.close();
      throw traduzirErroFtp(e);
    }

    return {
      async listar() {
        try {
          return (await cliente.list())
            .filter((a) => a.isFile && NOME_SEGURO.test(a.name))
            .map((a) => ({ nome: a.name, tamanho: a.size, modificadoEm: a.rawModifiedAt || a.modifiedAt?.toISOString() || '' }));
        } catch (e) {
          throw traduzirErroFtp(e);
        }
      },
      async baixar(nome, maxBytes) {
        if (!NOME_SEGURO.test(nome)) throw new RecusadoPelaPlataforma('Nome de arquivo inválido.');
        const partes: Buffer[] = [];
        let total = 0;
        const destino = new Writable({
          write(parte: Buffer, _codificacao, pronto) {
            total += parte.length;
            if (total > maxBytes) return pronto(new RecusadoPelaPlataforma(`A foto ${nome} passa do tamanho máximo.`));
            partes.push(parte);
            pronto();
          },
        });
        try {
          await cliente.downloadTo(destino, nome);
        } catch (e) {
          throw traduzirErroFtp(e);
        }
        return Buffer.concat(partes);
      },
      fechar: () => cliente.close(),
    };
  };
}

export const abrirFtpPadrao: AbrirFtp = criarAbrirFtp();

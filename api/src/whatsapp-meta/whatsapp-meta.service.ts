import { Inject, Injectable } from '@nestjs/common';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cifrar, decifrar } from '../comum/cripto';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { Produto } from '../contratos/modelo';
import { moeda } from '../sessoes/calculo';
import { SessoesService } from '../sessoes/sessoes.service';
import { SessaoCompleta } from '../sessoes/tipos';
import { CLIENTE_META, ClienteMeta, ErroMeta, FotoMeta, RespostaMeta } from './cliente-meta';

// Carrossel de imagem da API oficial do WhatsApp: foto, nome e preço em cada cartão, com um botão para o link de
// compra do atendimento. Não usa o catálogo da Meta. O template é aprovado uma vez para cada quantidade de cartões.

export const MIN_CARTOES = 2;
export const MAX_CARTOES = 10;
const TAMANHOS = Array.from({ length: MAX_CARTOES - MIN_CARTOES + 1 }, (_, i) => i + MIN_CARTOES);
const IDIOMA = 'pt_BR';
const NOME_MAX = 90; // o texto do cartão inteiro vai até 160 caracteres, contando os valores
const PAGINAS_MAX = 10;
const INTERVALO_MS = 60_000;
/** A Meta devolve este subcódigo quando já existe template com o nome e o idioma: para nós, é sucesso. */
const JA_EXISTE = 2388024;

const invalido = (mensagem: string) => new ErroApi(400, 'CARROSSEL_INVALIDO', mensagem);
export const nomeDoTemplate = (cartoes: number) => `kshop_carrossel_${cartoes}`;

export interface TemplateCarrossel {
  cartoes: number;
  nome: string;
  status: string;
  motivo?: string;
}

export interface PedidoDeCarrossel {
  chatId: string;
  telefone?: string;
  nome?: string;
  produtoIds: string[];
  atendente?: string;
  autor: 'atendente' | 'ia';
}

/** Número no formato da Meta: só dígitos, com o 55 quando veio só DDD e número. */
export function numeroWhatsapp(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, '');
  const numero = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  return numero.length >= 12 && numero.length <= 15 ? numero : null;
}

/** A Meta recusa parâmetro com quebra de linha, tabulação ou muitos espaços seguidos. */
const parametro = (texto: string) => texto.replace(/\s+/g, ' ').trim();

function nomeDoCartao(nome: string): string {
  const limpo = parametro(nome);
  return limpo.length > NOME_MAX ? `${limpo.slice(0, NOME_MAX - 1).trimEnd()}…` : limpo;
}

const disponivel = (v: { disponivel: boolean; estoque: number | null }) => v.disponivel && v.estoque !== 0;
const vendavel = (p: Produto) => (p.variacoes.length ? p.variacoes.some(disponivel) : disponivel(p));
const fotoDe = (p: Produto) => p.imagens[0] ?? p.variacoes.find((v) => v.imagem)?.imagem;

export function precoDoCartao(p: Produto, mostrarPrecos: boolean): string {
  if (!mostrarPrecos) return 'sob consulta';
  if (!p.variacoes.length) return p.precoDe && p.precoDe > p.preco ? `de ${moeda(p.precoDe)} por ${moeda(p.preco)}` : moeda(p.preco);
  const precos = p.variacoes.filter(disponivel).map((v) => v.preco);
  const menor = Math.min(...precos);
  return Math.max(...precos) > menor ? `a partir de ${moeda(menor)}` : moeda(menor);
}

@Injectable()
export class WhatsappMetaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    @Inject(CLIENTE_META) private readonly meta: ClienteMeta,
    private readonly catalogo: CatalogoService,
    private readonly configLoja: ConfigLojaService,
    private readonly sessoes: SessoesService,
  ) {}

  private async conta(lojaId: string): Promise<{ wabaId: string; telefoneId: string; token: string } | null> {
    const linha = await this.prisma.whatsappMeta.findUnique({ where: { lojaId } });
    if (!linha) return null;
    return {
      wabaId: linha.wabaId,
      telefoneId: linha.telefoneId,
      token: decifrar(Buffer.from(linha.tokenCifrado), Buffer.from(linha.iv), this.config.chaveMestra),
    };
  }

  private async contaObrigatoria(lojaId: string) {
    const conta = await this.conta(lojaId);
    if (!conta) throw invalido('O WhatsApp oficial ainda não foi ligado ao Kentro Shop. Configure na aba WhatsApp das Configurações ou use o link do catálogo.');
    return conta;
  }

  /** O que a tela mostra. O token nunca sai daqui. */
  async situacao(lojaId: string) {
    const linha = await this.prisma.whatsappMeta.findUnique({ where: { lojaId }, select: { wabaId: true, telefoneId: true } });
    return linha ? { configurado: true, ...linha } : { configurado: false };
  }

  async disponivel(lojaId: string): Promise<boolean> {
    return (await this.prisma.whatsappMeta.count({ where: { lojaId } })) > 0;
  }

  /** Só grava depois de a Meta confirmar o token, a conta e que o número é dessa conta. */
  async salvar(lojaId: string, dados: { wabaId: string; telefoneId: string; token?: string }) {
    const token = dados.token?.trim() || (await this.conta(lojaId))?.token;
    if (!token) throw invalido('Informe o token da Meta.');
    const conta = await this.meta.chamar(token, 'GET', `${dados.wabaId}?fields=id,name`);
    const numeros = await this.meta.chamar(token, 'GET', `${dados.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`);
    const numero = ((numeros.data ?? []) as RespostaMeta[]).find((n) => String(n.id) === dados.telefoneId);
    if (!numero) throw invalido('Este ID de telefone não pertence à conta do WhatsApp informada.');
    const { cifrado, iv } = cifrar(token, this.config.chaveMestra);
    const gravar = { wabaId: dados.wabaId, telefoneId: dados.telefoneId, tokenCifrado: new Uint8Array(cifrado), iv: new Uint8Array(iv) };
    await this.prisma.whatsappMeta.upsert({ where: { lojaId }, create: { lojaId, ...gravar }, update: gravar });
    return { configurado: true, wabaId: dados.wabaId, telefoneId: dados.telefoneId, conta: String(conta.name ?? ''), numero: String(numero.display_phone_number ?? '') };
  }

  async remover(lojaId: string): Promise<void> {
    await this.prisma.whatsappMeta.deleteMany({ where: { lojaId } });
  }

  async templates(lojaId: string): Promise<TemplateCarrossel[]> {
    const conta = await this.contaObrigatoria(lojaId);
    const achados = new Map<string, RespostaMeta>();
    let depois = '';
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
      const consulta = new URLSearchParams({ fields: 'name,status,language,rejected_reason', limit: '100', ...(depois ? { after: depois } : {}) });
      const r = await this.meta.chamar(conta.token, 'GET', `${conta.wabaId}/message_templates?${consulta}`);
      for (const t of (r.data ?? []) as RespostaMeta[]) if (t.language === IDIOMA) achados.set(String(t.name), t);
      depois = r.paging?.next ? String(r.paging?.cursors?.after ?? '') : '';
      if (!depois) break;
    }
    return TAMANHOS.map((cartoes) => {
      const nome = nomeDoTemplate(cartoes);
      const t = achados.get(nome);
      const motivo = t?.rejected_reason && t.rejected_reason !== 'NONE' ? { motivo: String(t.rejected_reason) } : {};
      return { cartoes, nome, status: t ? String(t.status) : 'NAO_CRIADO', ...motivo };
    });
  }

  /** Foto real da loja para a Meta avaliar o template. */
  private async fotoDeExemplo(lojaId: string): Promise<FotoMeta> {
    const { itens } = await this.catalogo.listarProdutos(lojaId, { pagina: 1 });
    for (const p of itens) {
      const url = fotoDe(p);
      const foto = url ? await this.meta.baixarFoto(url) : null;
      if (foto) return foto;
    }
    throw invalido('Não achei foto em JPG ou PNG no começo do catálogo para mandar de exemplo à Meta. Sincronize as fotos e tente de novo.');
  }

  private corpoDoTemplate(cartoes: number, handle: string): RespostaMeta {
    const cartao = {
      components: [
        { type: 'header', format: 'image', example: { header_handle: [handle] } },
        { type: 'body', text: 'Produto: {{1}}\nValor: {{2}}. Toque para ver.', example: { body_text: [['Produto de exemplo', 'R$ 19,90']] } },
        { type: 'buttons', buttons: [{ type: 'url', text: 'Ver produto', url: `${this.config.urlPublica}/c/{{1}}`, example: ['exemplo'] }] },
      ],
    };
    return {
      name: nomeDoTemplate(cartoes),
      language: IDIOMA,
      category: 'marketing',
      components: [
        { type: 'body', text: 'Separamos estas opções para você. Toque em um produto para ver os detalhes e comprar.' },
        { type: 'carousel', cards: Array.from({ length: cartoes }, () => cartao) },
      ],
    };
  }

  /** Envia para aprovação só os que ainda não existem na conta. */
  async criarTemplates(lojaId: string): Promise<TemplateCarrossel[]> {
    const conta = await this.contaObrigatoria(lojaId);
    const faltam = (await this.templates(lojaId)).filter((t) => t.status === 'NAO_CRIADO');
    if (faltam.length) {
      const depuracao = await this.meta.chamar(conta.token, 'GET', `debug_token?input_token=${encodeURIComponent(conta.token)}`);
      const appId = String(depuracao.data?.app_id ?? '');
      if (!appId) throw invalido('A Meta não informou o app deste token.');
      const handle = await this.meta.enviarExemplo(conta.token, appId, await this.fotoDeExemplo(lojaId));
      await Promise.all(
        faltam.map((t) =>
          this.meta.chamar(conta.token, 'POST', `${conta.wabaId}/message_templates`, this.corpoDoTemplate(t.cartoes, handle)).catch((e: unknown) => {
            if (e instanceof ErroMeta && e.subcodigoMeta === JA_EXISTE) return null;
            throw e;
          }),
        ),
      );
    }
    return this.templates(lojaId);
  }

  private async verificarIntervalo(lojaId: string, chatId: string): Promise<void> {
    const recente = await this.prisma.eventoSessao.count({
      where: { tipo: 'carrossel', em: { gt: new Date(Date.now() - INTERVALO_MS) }, sessao: { lojaId, chatId } },
    });
    if (recente) throw invalido('Um carrossel acabou de ser enviado neste atendimento. Aguarde um minuto antes de enviar outro.');
  }

  /** Produtos na ordem pedida; recusa dizendo quais não servem, para quem envia trocar. */
  private async produtosDoCarrossel(lojaId: string, ids: string[]): Promise<Produto[]> {
    const { categoriasOcultas } = await this.configLoja.obter(lojaId);
    const ocultas = new Set(categoriasOcultas);
    const mapa = await this.catalogo.obterVarios(lojaId, ids);
    const problemas: string[] = [];
    const produtos: Produto[] = [];
    for (const id of ids) {
      const p = mapa.get(id);
      if (!p || (p.categoriaIds.length && p.categoriaIds.every((c) => ocultas.has(c)))) problemas.push(`${id} (não encontrado)`);
      else if (!vendavel(p)) problemas.push(`${p.nome} (sem estoque)`);
      else if (!fotoDe(p)) problemas.push(`${p.nome} (sem foto)`);
      else produtos.push(p);
    }
    if (problemas.length) throw invalido(`Troque estes produtos para enviar o carrossel: ${problemas.join('; ')}.`);
    return produtos;
  }

  private async fotosParaEnvio(conta: { telefoneId: string; token: string }, produtos: Produto[]): Promise<string[]> {
    const fotos = await Promise.all(produtos.map((p) => this.meta.baixarFoto(fotoDe(p)!)));
    const ruins = produtos.filter((_, i) => !fotos[i]).map((p) => p.nome);
    if (ruins.length) throw invalido(`A foto destes produtos não abriu ou não é JPG/PNG, e a Meta só aceita esses formatos: ${ruins.join('; ')}.`);
    return Promise.all(fotos.map((f) => this.meta.enviarMidia(conta.token, conta.telefoneId, f!)));
  }

  async enviar(lojaId: string, pedido: PedidoDeCarrossel): Promise<{ quantidade: number; mensagemId: string; url: string; sessao: SessaoCompleta }> {
    const conta = await this.contaObrigatoria(lojaId);
    const ids = [...new Set(pedido.produtoIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length < MIN_CARTOES || ids.length > MAX_CARTOES) throw invalido(`O carrossel precisa de ${MIN_CARTOES} a ${MAX_CARTOES} produtos diferentes.`);
    const telefone = pedido.telefone?.trim() || (await this.sessoes.porChat(lojaId, pedido.chatId))?.cliente.telefone || '';
    const para = numeroWhatsapp(telefone);
    if (!para) throw invalido('Não achei um telefone válido do cliente para enviar o carrossel.');
    await this.verificarIntervalo(lojaId, pedido.chatId);

    const produtos = await this.produtosDoCarrossel(lojaId, ids);
    const midias = await this.fotosParaEnvio(conta, produtos);
    // O link vem depois das fotos: foto com problema não deixa link novo para trás.
    const { sessao } = await this.sessoes.criarOuReaproveitar(
      lojaId,
      { chatId: pedido.chatId, nome: pedido.nome ?? '', telefone },
      pedido.atendente ?? '',
      { filtro: { produtoIds: ids } },
      pedido.autor,
    );
    const token = sessao.url.split('/c/')[1];
    const { mostrarPrecos } = await this.configLoja.obter(lojaId);

    const resposta = await this.meta.chamar(conta.token, 'POST', `${conta.telefoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: para,
      type: 'template',
      template: {
        name: nomeDoTemplate(produtos.length),
        language: { code: IDIOMA },
        components: [
          {
            type: 'carousel',
            cards: produtos.map((p, i) => ({
              card_index: i,
              components: [
                { type: 'header', parameters: [{ type: 'image', image: { id: midias[i] } }] },
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: nomeDoCartao(p.nome) },
                    { type: 'text', text: parametro(precoDoCartao(p, mostrarPrecos)) },
                  ],
                },
                { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: token }] },
              ],
            })),
          },
        ],
      },
    });

    const por = pedido.autor === 'ia' ? 'pela IA' : pedido.atendente ? `por ${pedido.atendente}` : 'pelo atendente';
    await this.prisma.eventoSessao.create({
      data: { sessaoId: sessao.id, tipo: 'carrossel', texto: `Carrossel com ${produtos.length} produtos enviado ${por}`, autor: pedido.autor },
    });
    return {
      quantidade: produtos.length,
      mensagemId: String(resposta.messages?.[0]?.id ?? ''),
      url: sessao.url,
      sessao: (await this.sessoes.porChat(lojaId, pedido.chatId)) ?? sessao,
    };
  }
}

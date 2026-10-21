import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { NaoEncontrado } from '../conectores/nucleo/erros';
import { Produto } from '../contratos/modelo';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { CarrinhoService } from './carrinho.service';
import { ClientesService } from './clientes.service';
import { paginaSemPreco, precosVisiveis, produtoSemPreco, sessaoSemPreco } from './sem-preco';
import { FiltroLink } from './tipos';
import { FinalizarDto, FreteDto, SalvarCarrinhoDto } from './dto';
import { SessoesService } from './sessoes.service';
import { RequisicaoDoCliente, TokenSessaoGuard } from './token-sessao.guard';

// O filtro do link é a VITRINE INICIAL (ex.: só as bermudas): o cliente pode sair dele, ver a loja toda e comprar
// qualquer produto ("Compre também" e "Ver todos os produtos"). O antigo link restrito deixou de travar o catálogo.
const filtroDoLink = (req: RequisicaoDoCliente) => (req.sessao.filtro as unknown as FiltroLink | null) ?? null;
const MAX_SUGESTOES = 8;

/** Produto que só está em categorias ocultas fica de fora. */
const visivelNas = (ocultas: Set<string>) => (p: Produto) => !p.categoriaIds.length || p.categoriaIds.some((c) => !ocultas.has(c));
/** Dá para comprar agora: disponível, com estoque (ou com alguma variação assim). */
const vendavel = (p: Produto) =>
  p.variacoes.length ? p.variacoes.some((v) => v.disponivel && v.estoque !== 0) : p.disponivel && p.estoque !== 0;
const MAX_CATEGORIAS_SUGESTAO = 3;
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Rotas do catálogo do cliente. Autenticação = token do link. */
@Controller('v1/catalogo/:token')
@UseGuards(ThrottlerGuard, TokenSessaoGuard)
@Throttle({ publico: { limit: 120, ttl: 60_000 } })
@SkipThrottle({ registro: true })
@UseFilters(FiltroErrosConector)
export class CatalogoPublicoController {
  constructor(
    private readonly sessoes: SessoesService,
    private readonly carrinho: CarrinhoService,
    private readonly catalogo: CatalogoService,
    private readonly configLoja: ConfigLojaService,
    private readonly clientes: ClientesService,
    private readonly integracoes: IntegracoesService,
  ) {}

  @Get('abrir')
  async abrir(@Param('token') token: string, @Req() req: RequisicaoDoCliente) {
    const [sessao, config] = await Promise.all([this.sessoes.abrir(token), this.configLoja.obter(req.sessao.lojaId)]);
    const historico = await this.clientes.historico(req.sessao.lojaId, sessao.cliente);
    const mostrarPrecos = precosVisiveis(sessao, config.mostrarPrecos);
    // Pedido criado na loja: o checkout pede o e-mail e termina no link de pagamento da plataforma.
    const pedidoNaLoja = mostrarPrecos && (await this.integracoes.criaPedidoNaPlataforma(req.sessao.lojaId, config.modoPedido));
    return {
      pedidoNaLoja,
      sessao: mostrarPrecos ? sessao : sessaoSemPreco(sessao),
      historico: mostrarPrecos ? historico : { ...historico, pedidos: historico.pedidos.map((p) => ({ ...p, total: 0 })) },
      filtro: sessao.filtro,
      restrito: false,
      mostrarPrecos,
      tema: config.tema,
      entrega: config.entrega,
      retirada: { habilitada: config.retirada.habilitada, lojas: config.retirada.habilitada ? config.lojasRetirada : [] },
      frete: mostrarPrecos ? config.frete : { regra: 'a_combinar' },
    };
  }

  private async mostrar(req: RequisicaoDoCliente): Promise<boolean> {
    return precosVisiveis(req.sessao, (await this.configLoja.obter(req.sessao.lojaId)).mostrarPrecos);
  }

  @Get('categorias')
  async categorias(@Req() req: RequisicaoDoCliente) {
    const [categorias, config] = await Promise.all([this.catalogo.listarCategorias(req.sessao.lojaId), this.configLoja.obter(req.sessao.lojaId)]);
    const ocultas = new Set(config.categoriasOcultas);
    return categorias.filter((c) => !ocultas.has(c.id));
  }

  /** `selecao=1` aplica o filtro do link (vitrine inicial "Separados para você"); sem ele, o catálogo todo. */
  @Get('produtos')
  async produtos(
    @Req() req: RequisicaoDoCliente,
    @Query('busca') busca?: string,
    @Query('categoria') categoria?: string,
    @Query('pagina') pagina?: string,
    @Query('selecao') selecao?: string,
  ) {
    const lojaId = req.sessao.lojaId;
    const filtro = selecao === '1' ? filtroDoLink(req) : null;
    const termo = busca?.trim().slice(0, 100) || undefined;
    const numero = Math.max(1, Math.min(Number.parseInt(pagina ?? '1', 10) || 1, 500));
    const config = await this.configLoja.obter(lojaId);
    const ocultas = new Set(config.categoriasOcultas);
    const mostrar = precosVisiveis(req.sessao, config.mostrarPrecos);
    const visivel = visivelNas(ocultas);

    if (filtro?.produtoIds?.length) {
      // Seleção do atendente: os produtos na ordem em que ele escolheu, numa página só.
      const ids = filtro.produtoIds;
      const mapa = numero > 1 ? new Map<string, Produto | null>() : await this.catalogo.obterVarios(lojaId, ids).catch(() => new Map<string, Produto | null>());
      const achados = ids.map((id) => mapa.get(id) ?? null);
      const palavras = termo ? semAcento(termo).split(/\s+/) : [];
      const itens = achados.filter((p): p is Produto => !!p && visivel(p) && palavras.every((w) => semAcento(`${p.nome} ${p.sku}`).includes(w)));
      const pagina = { itens, pagina: numero, porPagina: Math.max(itens.length, 1), total: itens.length, temMais: false };
      return mostrar ? pagina : paginaSemPreco(pagina);
    }

    const lista = await this.catalogo.listarProdutos(lojaId, {
      busca: [filtro?.busca, termo].filter(Boolean).join(' ') || undefined,
      categoriaId: filtro?.categoriaId ?? (categoria?.trim().slice(0, 50) || undefined),
      pagina: numero,
    });
    const visiveis = ocultas.size ? { ...lista, itens: lista.itens.filter(visivel) } : lista;
    return mostrar ? visiveis : paginaSemPreco(visiveis);
  }

  @Get('produtos/:id')
  async produto(@Req() req: RequisicaoDoCliente, @Param('id') id: string) {
    const produto = await this.catalogo.obterProduto(req.sessao.lojaId, id.trim().slice(0, 100));
    const ocultas = new Set((await this.configLoja.obter(req.sessao.lojaId)).categoriasOcultas);
    if (!visivelNas(ocultas)(produto)) throw new NaoEncontrado('Produto não encontrado.');
    return (await this.mostrar(req)) ? produto : produtoSemPreco(produto);
  }

  /**
   * "Compre também", no fim da vitrine: produtos das mesmas categorias da seleção do link e do carrinho, que o
   * cliente ainda não tem na seleção nem no carrinho; completa com os primeiros da loja. Só produtos vendáveis.
   */
  @Get('sugestoes')
  async sugestoes(@Req() req: RequisicaoDoCliente) {
    const lojaId = req.sessao.lojaId;
    const config = await this.configLoja.obter(lojaId);
    const visivel = visivelNas(new Set(config.categoriasOcultas));
    const filtro = filtroDoLink(req);
    const noCarrinho = (await this.sessoes.publica(req.sessao.id, req.sessao)).itens.map((i) => i.produtoId);

    // Produtos de referência: a seleção do link e o carrinho.
    const base = new Map<string, Produto>();
    const ids = [...new Set([...(filtro?.produtoIds ?? []), ...noCarrinho])].slice(0, 30);
    if (ids.length) for (const p of (await this.catalogo.obterVarios(lojaId, ids).catch(() => new Map<string, Produto | null>())).values()) if (p) base.set(p.id, p);
    if (filtro?.busca && !filtro.categoriaId) {
      for (const p of (await this.catalogo.listarProdutos(lojaId, { busca: filtro.busca, pagina: 1 }).catch(() => ({ itens: [] as Produto[] }))).itens) base.set(p.id, p);
    }
    const ocultas = new Set(config.categoriasOcultas);
    const contagem = new Map<string, number>();
    if (filtro?.categoriaId) contagem.set(filtro.categoriaId, 1_000);
    for (const p of base.values()) for (const c of p.categoriaIds) if (!ocultas.has(c)) contagem.set(c, (contagem.get(c) ?? 0) + 1);
    const categorias = [...contagem].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIAS_SUGESTAO).map(([c]) => c);

    // Fora: o que o cliente já está vendo na seleção (produtos escolhidos) e o que já está no carrinho.
    const fora = new Set([...(filtro?.produtoIds ?? []), ...noCarrinho]);
    const escolhidos: Produto[] = [];
    const juntar = (lista: Produto[]) => {
      for (const p of lista) {
        if (escolhidos.length >= MAX_SUGESTOES) return;
        if (fora.has(p.id) || !visivel(p) || !vendavel(p)) continue;
        fora.add(p.id);
        escolhidos.push(p);
      }
    };
    for (const categoriaId of categorias) {
      if (escolhidos.length >= MAX_SUGESTOES) break;
      // A categoria do próprio link já aparece inteira na vitrine: dela, só as páginas seguintes valem como novidade.
      const pagina = categoriaId === filtro?.categoriaId ? 2 : 1;
      juntar((await this.catalogo.listarProdutos(lojaId, { categoriaId, pagina }).catch(() => ({ itens: [] as Produto[] }))).itens);
    }
    if (escolhidos.length < MAX_SUGESTOES) juntar((await this.catalogo.listarProdutos(lojaId, { pagina: 1 }).catch(() => ({ itens: [] as Produto[] }))).itens);

    const mostrar = precosVisiveis(req.sessao, config.mostrarPrecos);
    return mostrar ? escolhidos : escolhidos.map(produtoSemPreco);
  }

  @Put('carrinho')
  async salvarCarrinho(@Param('token') token: string, @Req() req: RequisicaoDoCliente, @Body() dto: SalvarCarrinhoDto) {
    const r = await this.carrinho.definir(token, dto.itens);
    return (await this.mostrar(req)) ? r : { ...r, sessao: sessaoSemPreco(r.sessao) };
  }

  @Post('frete')
  @HttpCode(200)
  async frete(@Param('token') token: string, @Req() req: RequisicaoDoCliente, @Body() dto: FreteDto) {
    const cotacao = await this.carrinho.cotarFrete(token, dto.cep);
    return (await this.mostrar(req)) ? cotacao : { titulo: 'Frete a combinar', valor: null };
  }

  @Post('finalizar')
  @HttpCode(200)
  async finalizar(@Param('token') token: string, @Req() req: RequisicaoDoCliente, @Body() dto: FinalizarDto) {
    const sessao = await this.carrinho.finalizar(token, dto);
    return (await this.mostrar(req)) ? sessao : sessaoSemPreco(sessao);
  }
}

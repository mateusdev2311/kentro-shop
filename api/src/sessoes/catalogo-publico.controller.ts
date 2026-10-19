import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ConfigLojaService } from '../config-loja/config-loja.service';
import { FiltroErrosConector } from '../conectores/nucleo/filtro';
import { NaoEncontrado } from '../conectores/nucleo/erros';
import { Produto } from '../contratos/modelo';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { CarrinhoService, permitidoPeloFiltro } from './carrinho.service';
import { ClientesService } from './clientes.service';
import { paginaSemPreco, precosVisiveis, produtoSemPreco, sessaoSemPreco } from './sem-preco';
import { FiltroLink } from './tipos';
import { FinalizarDto, FreteDto, SalvarCarrinhoDto } from './dto';
import { SessoesService } from './sessoes.service';
import { RequisicaoDoCliente, TokenSessaoGuard } from './token-sessao.guard';

const filtroDoLink = (req: RequisicaoDoCliente) => (req.sessao.filtro as unknown as FiltroLink | null) ?? null;
/** Filtro que o servidor impõe (link restrito); o cliente não consegue sair dele. */
const filtroRestrito = (req: RequisicaoDoCliente) => (req.sessao.restrito ? filtroDoLink(req) : null);
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
      restrito: sessao.restrito,
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
    const visiveis = categorias.filter((c) => !ocultas.has(c.id));
    // Link restrito: só a categoria do link (seleção de produtos ou busca: sem categorias).
    const filtro = filtroRestrito(req);
    if (!filtro) return visiveis;
    return filtro.categoriaId ? visiveis.filter((c) => c.id === filtro.categoriaId) : [];
  }

  /** `selecao=1` aplica o filtro do link mesmo quando ele não é restrito (vitrine inicial "Separados para você"). */
  @Get('produtos')
  async produtos(
    @Req() req: RequisicaoDoCliente,
    @Query('busca') busca?: string,
    @Query('categoria') categoria?: string,
    @Query('pagina') pagina?: string,
    @Query('selecao') selecao?: string,
  ) {
    const lojaId = req.sessao.lojaId;
    const filtro = filtroRestrito(req) ?? (selecao === '1' ? filtroDoLink(req) : null);
    const termo = busca?.trim().slice(0, 100) || undefined;
    const numero = Math.max(1, Math.min(Number.parseInt(pagina ?? '1', 10) || 1, 500));
    const config = await this.configLoja.obter(lojaId);
    const ocultas = new Set(config.categoriasOcultas);
    const mostrar = precosVisiveis(req.sessao, config.mostrarPrecos);
    // Produto que só está em categorias ocultas também fica de fora.
    const visivel = (p: Produto) => !p.categoriaIds.length || p.categoriaIds.some((c) => !ocultas.has(c));

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
    const filtro = filtroRestrito(req);
    if (filtro && !permitidoPeloFiltro(filtro, produto)) throw new NaoEncontrado('Produto não encontrado.');
    return (await this.mostrar(req)) ? produto : produtoSemPreco(produto);
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
